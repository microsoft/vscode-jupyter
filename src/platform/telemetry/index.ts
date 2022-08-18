// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// eslint-disable-next-line
import TelemetryReporter from '@vscode/extension-telemetry/lib/telemetryReporter';
import { IWorkspaceService } from '../common/application/types';
import { AppinsightsKey, isTestExecution, isUnitTestExecution, JVSC_EXTENSION_ID } from '../common/constants';
import { traceError, traceEverything } from '../logging';
import { StopWatch } from '../common/utils/stopWatch';
import { noop } from '../common/utils/misc';
import { isPromise } from 'rxjs/internal-compatibility';
import { populateTelemetryWithErrorInfo } from '../errors';
import { IEventNamePropertyMapping } from '../../telemetry';

/**
 * TODO@rebornix
 * `../platform/common/constants/Telemetry` is a re-export from `webview`, it should be moved into `src/telemetry`
 */
export {
    JupyterCommands,
    NativeKeyboardCommandTelemetry,
    NativeMouseCommandTelemetry,
    Telemetry
} from '../common/constants';

export const waitBeforeSending = 'waitBeforeSending';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Checks whether telemetry is supported.
 * Its possible this function gets called within Debug Adapter, vscode isn't available in there.
 * Within DA, there's a completely different way to send telemetry.
 * @returns {boolean}
 */
function isTelemetrySupported(): boolean {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vsc = require('vscode');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const reporter = require('@vscode/extension-telemetry');
        return vsc !== undefined && reporter !== undefined;
    } catch {
        return false;
    }
}

/**
 * Checks if the telemetry is disabled in user settings
 * @returns {boolean}
 */
export function isTelemetryDisabled(workspaceService: IWorkspaceService): boolean {
    const settings = workspaceService.getConfiguration('telemetry').inspect<boolean>('enableTelemetry')!;
    return settings.globalValue === false ? true : false;
}

const sharedProperties: Partial<ISharedPropertyMapping> = {};
/**
 * Set shared properties for all telemetry events.
 */
export function setSharedProperty<P extends ISharedPropertyMapping, E extends keyof P>(name: E, value?: P[E]): void {
    const propertyName = name as string;
    // Ignore such shared telemetry during unit tests.
    if (isUnitTestExecution() && propertyName.startsWith('ds_')) {
        return;
    }
    if (value === undefined) {
        delete (sharedProperties as any)[propertyName];
    } else {
        (sharedProperties as any)[propertyName] = value;
    }
}

/**
 * Reset shared properties for testing purposes.
 */
export function _resetSharedProperties(): void {
    for (const key of Object.keys(sharedProperties)) {
        delete (sharedProperties as any)[key];
    }
}

let telemetryReporter: TelemetryReporter | undefined;
export function getTelemetryReporter() {
    if (telemetryReporter) {
        return telemetryReporter;
    }
    const extensionId = JVSC_EXTENSION_ID;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extensions = (require('vscode') as typeof import('vscode')).extensions;
    const extension = extensions.getExtension(extensionId)!;
    const extensionVersion = extension.packageJSON.version;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reporter = require('@vscode/extension-telemetry').default as typeof TelemetryReporter;
    return (telemetryReporter = new reporter(extensionId, extensionVersion, AppinsightsKey, true));
}

export function setTelemetryReporter(reporter: TelemetryReporter) {
    telemetryReporter = reporter;
}

export function clearTelemetryReporter() {
    telemetryReporter = undefined;
}

function sanitizeProperties(eventName: string, data: Record<string, any>) {
    let customProperties: Record<string, string> = {};
    Object.getOwnPropertyNames(data).forEach((prop) => {
        if (data[prop] === undefined || data[prop] === null) {
            return;
        }
        if (prop === waitBeforeSending) {
            return;
        }
        try {
            // If there are any errors in serializing one property, ignore that and move on.
            // Else nothing will be sent.
            customProperties[prop] =
                typeof data[prop] === 'string'
                    ? data[prop]
                    : typeof data[prop] === 'object'
                    ? 'object'
                    : data[prop].toString();
        } catch (ex) {
            traceError(`Failed to serialize ${prop} for ${eventName}`, ex);
        }
    });
    return customProperties;
}

const queuedTelemetry: {
    eventName: string;
    durationMs?: Record<string, number> | number;
    properties?: Record<string, any>;
    ex?: Error;
    sendOriginalEventWithErrors?: boolean;
    queueEverythingUntilCompleted?: Promise<any>;
}[] = [];

/**
 * Send this & subsequent telemetry only after this promise has been resolved.
 * We have a default timeout of 30s.
 * @param {P[E]} [properties]
 * Can optionally contain a property `waitBeforeSending` referencing a promise.
 * Which must be awaited before sending the telemetry.
 */
export function sendTelemetryEvent<P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    durationMs?: Record<string, number> | number,
    properties?: P[E] & { [waitBeforeSending]?: Promise<void> },
    ex?: Error,
    sendOriginalEventWithErrors?: boolean
) {
    if (!isTelemetrySupported() || isTestExecution()) {
        return;
    }
    // If stuff is already queued, then queue the rest.
    // Queue telemetry for now only in insiders.
    if (isPromise(properties?.waitBeforeSending) || queuedTelemetry.length) {
        queuedTelemetry.push({
            eventName: eventName as string,
            durationMs,
            properties,
            ex,
            sendOriginalEventWithErrors,
            queueEverythingUntilCompleted: properties?.waitBeforeSending
        });
        sendNextTelemetryItem();
    } else {
        sendTelemetryEventInternal(eventName as any, durationMs, properties, ex, sendOriginalEventWithErrors);
    }
}

function sendNextTelemetryItem(): void {
    if (queuedTelemetry.length === 0) {
        return;
    }
    // Take the first item to be sent.
    const nextItem = queuedTelemetry[0];
    let timer: NodeJS.Timeout | undefined | number;
    function sendThisTelemetryItem() {
        if (timer) {
            clearTimeout(timer as any);
        }
        // Possible already sent out by another event handler.
        if (queuedTelemetry.length === 0 || queuedTelemetry[0] !== nextItem) {
            return;
        }
        queuedTelemetry.shift();
        sendTelemetryEventInternal(
            nextItem.eventName as any,
            nextItem.durationMs,
            nextItem.properties,
            nextItem.ex,
            nextItem.sendOriginalEventWithErrors
        );
        sendNextTelemetryItem();
    }

    if (nextItem.queueEverythingUntilCompleted) {
        timer = setTimeout(() => sendThisTelemetryItem(), 30_000);
        // Wait for the promise & then send it.
        nextItem.queueEverythingUntilCompleted.finally(() => sendThisTelemetryItem()).catch(noop);
    } else {
        return sendThisTelemetryItem();
    }
}

function sendTelemetryEventInternal<P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    durationMs?: Record<string, number> | number,
    properties?: P[E],
    ex?: Error,
    sendOriginalEventWithErrors?: boolean
) {
    const reporter = getTelemetryReporter();
    const measures = typeof durationMs === 'number' ? { duration: durationMs } : durationMs ? durationMs : undefined;
    let customProperties: Record<string, string> = {};
    let eventNameSent = eventName as string;

    if (ex) {
        if (!sendOriginalEventWithErrors) {
            // When sending telemetry events for exceptions no need to send custom properties.
            // Else we have to review all properties every time as part of GDPR.
            // Assume we have 10 events all with their own properties.
            // As we have errors for each event, those properties are treated as new data items.
            // Hence they need to be classified as part of the GDPR process, and thats unnecessary and onerous.
            eventNameSent = 'ERROR';
            customProperties = {
                originalEventName: eventName as string
            };
            // Add shared properties to telemetry props (we may overwrite existing ones).
            Object.assign(customProperties, sharedProperties);
            populateTelemetryWithErrorInfo(customProperties, ex);
            customProperties = sanitizeProperties(eventNameSent, customProperties);
            reporter.sendTelemetryErrorEvent(eventNameSent, customProperties, measures);
        } else {
            // Include a property failed, to indicate there are errors.
            // Lets pay the price for better data.
            customProperties = {};
            // Add shared properties to telemetry props (we may overwrite existing ones).
            Object.assign(customProperties, sharedProperties);
            Object.assign(customProperties, properties || {});
            populateTelemetryWithErrorInfo(customProperties, ex);
            customProperties = sanitizeProperties(eventNameSent, customProperties);
            reporter.sendTelemetryEvent(eventNameSent, customProperties, measures);
        }
    } else {
        if (properties) {
            customProperties = sanitizeProperties(eventNameSent, properties);
        }

        // Add shared properties to telemetry props (we may overwrite existing ones).
        Object.assign(customProperties, sharedProperties);

        reporter.sendTelemetryEvent(eventNameSent, customProperties, measures);
    }
    traceEverything(
        `Telemetry Event : ${eventNameSent} Measures: ${JSON.stringify(measures)} Props: ${JSON.stringify(
            customProperties
        )} `
    );
}

// Type-parameterized form of MethodDecorator in lib.es5.d.ts.
type TypedMethodDescriptor<T> = (
    target: Object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
) => TypedPropertyDescriptor<T> | void;
const timesSeenThisEventWithSameProperties = new Set<string>();
/**
 * Decorates a method, sending a telemetry event with the given properties.
 * @param eventName The event name to send.
 * @param properties Properties to send with the event; must be valid for the event.
 * @param captureDuration True if the method's execution duration should be captured.
 * @param failureEventName If the decorated method returns a Promise and fails, send this event instead of eventName.
 * @param lazyProperties A static function on the decorated class which returns extra properties to add to the event.
 * This can be used to provide properties which are only known at runtime (after the decorator has executed).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any,
export function captureTelemetry<This, P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    properties?: P[E],
    captureDuration: boolean = true,
    failureEventName?: E,
    lazyProperties?: (obj: This) => P[E]
): TypedMethodDescriptor<(this: This, ...args: any[]) => any> {
    // eslint-disable-next-line , @typescript-eslint/no-explicit-any
    return function (
        _target: Object,
        _propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(this: This, ...args: any[]) => any>
    ) {
        const originalMethod = descriptor.value!;
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        descriptor.value = function (this: This, ...args: any[]) {
            // Legacy case; fast path that sends event before method executes.
            // Does not set "failed" if the result is a Promise and throws an exception.
            if (!captureDuration && !lazyProperties) {
                sendTelemetryEvent(eventName, undefined, properties);
                // eslint-disable-next-line no-invalid-this
                return originalMethod.apply(this, args);
            }

            const props = () => {
                if (lazyProperties) {
                    return { ...properties, ...lazyProperties(this) };
                }
                return properties;
            };

            // Determine if this is the first time we're sending this telemetry event for this same (class/method).
            const stopWatch = captureDuration ? new StopWatch() : undefined;
            const key = `${eventName.toString()}${JSON.stringify(props() || {})}`;
            const firstTime = !timesSeenThisEventWithSameProperties.has(key);
            timesSeenThisEventWithSameProperties.add(key);

            // eslint-disable-next-line no-invalid-this, @typescript-eslint/no-use-before-define,
            const result = originalMethod.apply(this, args);

            // If method being wrapped returns a promise then wait for it.
            // eslint-disable-next-line
            if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
                // eslint-disable-next-line
                (result as Promise<void>)
                    .then((data) => {
                        const propsToSend = { ...(props() || {}) };
                        if (firstTime) {
                            (propsToSend as any)['firstTime'] = firstTime;
                        }
                        sendTelemetryEvent(eventName, stopWatch?.elapsedTime, propsToSend as typeof properties);
                        return data;
                    })
                    // eslint-disable-next-line @typescript-eslint/promise-function-async
                    .catch((ex) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const failedProps: P[E] = { ...(props() || ({} as any)) };
                        (failedProps as any).failed = true;
                        sendTelemetryEvent(
                            failureEventName ? failureEventName : eventName,
                            stopWatch?.elapsedTime,
                            failedProps,
                            ex
                        );
                    });
            } else {
                sendTelemetryEvent(eventName, stopWatch?.elapsedTime, props());
            }

            return result;
        };

        return descriptor;
    };
}

// function sendTelemetryWhenDone<T extends IDSMappings, K extends keyof T>(eventName: K, properties?: T[K]);
export function sendTelemetryWhenDone<P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    promise: Promise<any> | Thenable<any>,
    stopWatch?: StopWatch,
    properties?: P[E],
    sendOriginalEventWithErrors?: boolean
) {
    stopWatch = stopWatch ? stopWatch : new StopWatch();
    if (typeof promise.then === 'function') {
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        (promise as Promise<any>).then(
            (data) => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                sendTelemetryEvent(eventName, stopWatch!.elapsedTime, properties);
                return data;
                // eslint-disable-next-line @typescript-eslint/promise-function-async
            },
            (ex) => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                sendTelemetryEvent(eventName, stopWatch!.elapsedTime, properties, ex, sendOriginalEventWithErrors);
                return Promise.reject(ex);
            }
        );
    } else {
        throw new Error('Method is neither a Promise nor a Theneable');
    }
}

/**
 * Map all shared properties to their data types.
 */
export interface ISharedPropertyMapping {
    /**
     * For every DS telemetry we would like to know the type of Notebook Editor used when doing something.
     */
    ['ds_notebookeditor']: undefined | 'old' | 'custom' | 'native';
    /**
     * Whether this is the Insider version of the Jupyter extension or not.
     */
    ['isInsiderExtension']: 'true' | 'false';

    /**
     * For every DS telemetry we would like to know whether the this is from AML compute or not.
     * If not in AML compute, then do not send this telemetry.
     */
    ['isamlcompute']: 'true' | 'false';

    /**
     * For every telemetry event from the extension we want to make sure we can associate it with install
     * source. We took this approach to work around very limiting query performance issues.
     */
    ['installSource']: undefined | 'marketPlace' | 'pythonCodingPack';

    /**
     * Whether raw kernel is supported or not.
     */
    ['rawKernelSupported']: 'true' | 'false';

    /**
     * Whether using local or remote connection.
     */
    ['isPythonExtensionInstalled']: 'true' | 'false';
}

// Map all events to their properties
