// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type TelemetryReporter from '@vscode/extension-telemetry/lib/telemetryReporter';
import { IWorkspaceService } from '../common/application/types';
import { AppinsightsKey, isTestExecution, isUnitTestExecution, JVSC_EXTENSION_ID } from '../common/constants';
import { traceError, traceEverything } from '../logging';
import { StopWatch } from '../common/utils/stopWatch';
import { ExcludeType, noop, PickType, UnionToIntersection } from '../common/utils/misc';
import { isPromise } from 'rxjs/internal-compatibility';
import { populateTelemetryWithErrorInfo } from '../errors';
import { TelemetryEventInfo, IEventNamePropertyMapping } from '../../telemetry';

/**
 * TODO@rebornix
 * `../platform/common/constants/Telemetry` is a re-export from `webview`, it should be moved into `src/telemetry`
 */
export { JupyterCommands, Telemetry } from '../common/constants';

export const waitBeforeSending = 'waitBeforeSending';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Checks whether telemetry is supported.
 * Its possible this function gets called within Debug Adapter, vscode isn't available in there.
 * Within DA, there's a completely different way to send telemetry.
 */
async function isTelemetrySupported(): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vsc = require('vscode');
        if (vsc === undefined) {
            return false;
        }
        return (await getTelemetryReporter()) !== undefined;
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

const sharedProperties: Partial<SharedPropertyMapping> = {};
/**
 * Set shared properties for all telemetry events.
 */
export function setSharedProperty<P extends SharedPropertyMapping, E extends keyof P>(name: E, value?: P[E]): void {
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
export async function getTelemetryReporter(): Promise<TelemetryReporter> {
    if (telemetryReporter) {
        return telemetryReporter;
    }
    const extensionId = JVSC_EXTENSION_ID;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extensions = (require('vscode') as typeof import('vscode')).extensions;
    const extension = extensions.getExtension(extensionId)!;
    const extensionVersion = extension.packageJSON.version;

    const reporterCtor = (await import('@vscode/extension-telemetry')).default;
    return (telemetryReporter = new reporterCtor(extensionId, extensionVersion, AppinsightsKey, true));
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
    measures?: Record<string, number> | undefined;
    properties?: Record<string, any> | undefined;
    ex?: Error | undefined;
    queueEverythingUntilCompleted?: Promise<any> | undefined;
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
    measures?:
        | (P[E] extends TelemetryEventInfo<infer R> ? PickType<UnionToIntersection<R>, number> : undefined)
        | undefined,
    properties?: P[E] extends TelemetryEventInfo<infer R>
        ? ExcludeType<R, number> extends never | undefined
            ? undefined | { [waitBeforeSending]?: Promise<void> }
            : ExcludeType<R, number> & { [waitBeforeSending]?: Promise<void> }
        : undefined | { [waitBeforeSending]?: Promise<void> } | (undefined | { [waitBeforeSending]?: Promise<void> }),
    ex?: Error
) {
    if (isTestExecution()) {
        return;
    }
    isTelemetrySupported()
        .then((isSupported) => {
            if (!isSupported) {
                return;
            }
            // If stuff is already queued, then queue the rest.
            // Queue telemetry for now only in insiders.
            if (isPromise(properties?.waitBeforeSending) || queuedTelemetry.length) {
                queuedTelemetry.push({
                    eventName: eventName as string,
                    measures: measures as unknown as Record<string, number> | undefined,
                    properties,
                    ex,
                    queueEverythingUntilCompleted: properties?.waitBeforeSending
                });
                sendNextTelemetryItem();
            } else {
                sendTelemetryEventInternal(
                    eventName as any,
                    // Because of exactOptionalPropertyTypes we have to cast.
                    measures as unknown as Record<string, number> | undefined,
                    properties,
                    ex
                );
            }
        })
        .catch(noop);
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
        sendTelemetryEventInternal(nextItem.eventName as any, nextItem.measures, nextItem.properties, nextItem.ex);
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
    measures?: Record<string, number>,
    properties?: P[E],
    ex?: Error
) {
    const reporter = getTelemetryReporter();
    let customProperties: Record<string, string> = {};
    let eventNameSent = eventName as string;

    if (ex) {
        // Include a property failed, to indicate there are errors.
        // Lets pay the price for better data.
        customProperties = {};
        // Add shared properties to telemetry props (we may overwrite existing ones).
        Object.assign(customProperties, sharedProperties);
        Object.assign(customProperties, properties || {});
        populateTelemetryWithErrorInfo(customProperties, ex)
            .then(() => {
                customProperties = sanitizeProperties(eventNameSent, customProperties);
                reporter.then((e) => e.sendTelemetryEvent(eventNameSent, customProperties, measures)).catch(noop);
            })
            .catch(noop);
    } else {
        if (properties) {
            customProperties = sanitizeProperties(eventNameSent, properties);
        }

        // Add shared properties to telemetry props (we may overwrite existing ones).
        Object.assign(customProperties, sharedProperties);

        reporter.then((r) => r.sendTelemetryEvent(eventNameSent, customProperties, measures)).catch(noop);
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
export type PickTypeNumberProps<T, Value> = {
    [P in keyof T as T[P] extends Value ? P : never]: T[P];
};
export type PickPropertiesOnly<T> = {
    [P in keyof T as T[P] extends TelemetryEventInfo<infer R>
        ? keyof PickType<R, number> extends never
            ? never
            : P
        : never]: T[P];
};

/**
 * Decorates a method, sending a telemetry event with the given properties.
 * @param eventName The event name to send.
 * @param properties Properties to send with the event; must be valid for the event.
 */
export function capturePerfTelemetry<This, P extends IEventNamePropertyMapping, E extends keyof PickPropertiesOnly<P>>(
    eventName: E,
    properties?: P[E] extends TelemetryEventInfo<infer R>
        ? ExcludeType<R, number> extends never | undefined
            ? undefined
            : ExcludeType<R, number>
        : undefined
): TypedMethodDescriptor<(this: This, ...args: any[]) => any> {
    return function (
        _target: Object,
        _propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(this: This, ...args: any[]) => any>
    ) {
        const originalMethod = descriptor.value!;
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        descriptor.value = function (this: This, ...args: any[]) {
            const props = properties || {};

            // Determine if this is the first time we're sending this telemetry event for this same (class/method).
            const stopWatch = new StopWatch();
            const key = `${eventName.toString()}${JSON.stringify(props)}`;
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
                        const propsToSend = { ...props };
                        if (firstTime) {
                            (propsToSend as any)['firstTime'] = firstTime;
                        }
                        sendTelemetryEvent(
                            eventName,
                            stopWatch ? ({ duration: stopWatch?.elapsedTime } as any) : undefined,
                            propsToSend as typeof properties
                        );
                        return data;
                    })
                    // eslint-disable-next-line @typescript-eslint/promise-function-async
                    .catch((ex) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const failedProps: P[E] = { ...props } as any;
                        (failedProps as any).failed = true;
                        sendTelemetryEvent(
                            eventName as any,
                            stopWatch ? { duration: stopWatch?.elapsedTime } : {},
                            failedProps as any,
                            ex
                        );
                    });
            } else {
                sendTelemetryEvent(
                    eventName,
                    stopWatch ? ({ duration: stopWatch?.elapsedTime } as any) : undefined,
                    props as typeof properties
                );
            }

            return result;
        };

        return descriptor;
    };
}

/**
 * Decorates a method, sending a telemetry event with the given properties.
 * @param eventName The event name to send.
 * @param properties Properties to send with the event; must be valid for the event.
 */
export function captureUsageTelemetry<This, P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    properties?: P[E] extends TelemetryEventInfo<infer R>
        ? ExcludeType<R, number> extends never | undefined
            ? undefined
            : ExcludeType<R, number>
        : undefined
): TypedMethodDescriptor<(this: This, ...args: any[]) => any> {
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
            sendTelemetryEvent(eventName, undefined, properties);
            // eslint-disable-next-line no-invalid-this
            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}

/**
 * Map all shared properties to their data types.
 */
export class SharedPropertyMapping {
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
     * Whether raw kernel is supported or not.
     */
    ['rawKernelSupported']: 'true' | 'false';

    /**
     * Whether using local or remote connection.
     */
    ['isPythonExtensionInstalled']: 'true' | 'false';
}

// Map all events to their properties
