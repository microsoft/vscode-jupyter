// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../../platform/common/types';
import { Telemetry } from '../../platform/common/constants';
import { sendTelemetryEvent, waitBeforeSending, IEventNamePropertyMapping } from '../../telemetry';
import { getContextualPropsForTelemetry } from '../../platform/telemetry/telemetry';
import { clearInterruptCounter, trackKernelResourceInformation } from './helper';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { populateTelemetryWithErrorInfo } from '../../platform/errors';
import { InterruptResult } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function incrementStartFailureCount(resource: Resource, eventName: any, properties: any) {
    if (eventName === Telemetry.NotebookStart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookStart>;
        const data: undefined | typeof kv[Telemetry.NotebookStart] = properties;
        // Check start failed.
        if (data && 'failed' in data && data.failed) {
            trackKernelResourceInformation(resource, { startFailed: true });
        }
    }
}

/**
 * @param {(P[E] & { waitBeforeSending: Promise<void> })} [properties]
 * Can optionally contain a property `waitBeforeSending` referencing a promise.
 * Which must be awaited before sending the telemetry.
 */

export function sendKernelTelemetryEvent<P extends IEventNamePropertyMapping, E extends keyof P>(
    resource: Resource,
    eventName: E,
    durationMs?: Record<string, number> | number,
    properties?: P[E] & { waitBeforeSending?: Promise<void> },
    ex?: Error
) {
    const props = getContextualPropsForTelemetry(resource);
    Object.assign(props, properties || {});
    sendTelemetryEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eventName as any,
        durationMs,
        props,
        ex,
        true
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resetData(resource, eventName as any, props);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    incrementStartFailureCount(resource, eventName as any, props);
}

/**
 * Send this & subsequent telemetry only after this promise has been resolved.
 * We have a default timeout of 30s.
 * @param {P[E]} [properties]
 * Can optionally contain a property `waitBeforeSending` referencing a promise.
 * Which must be awaited before sending the telemetry.
 */
export function sendKernelTelemetryWhenDone<P extends IEventNamePropertyMapping, E extends keyof P>(
    resource: Resource,
    eventName: E,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    promise: Promise<any> | Thenable<any>,
    handleError: boolean,
    properties?: P[E] & { [waitBeforeSending]?: Promise<void> }
) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = properties || {};
    const stopWatch = new StopWatch();
    if (typeof promise.then === 'function') {
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        (promise as Promise<any>)
            .then(
                (data) => {
                    const props = getContextualPropsForTelemetry(resource);
                    Object.assign(props, properties || {});
                    sendTelemetryEvent(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        eventName as any,
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        stopWatch!.elapsedTime,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        props as any
                    );
                    return data;
                    // eslint-disable-next-line @typescript-eslint/promise-function-async
                },
                (ex) => {
                    if (!handleError) {
                        return;
                    }
                    const props = getContextualPropsForTelemetry(resource);
                    Object.assign(props, properties || {});
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    populateTelemetryWithErrorInfo(props as any, ex);
                    sendTelemetryEvent(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        eventName as any,
                        stopWatch.elapsedTime,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        props as any,
                        ex,
                        true
                    );
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    incrementStartFailureCount(resource, eventName as any, props);
                }
            )
            .finally(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                resetData(resource, eventName as any, props);
            });
    }
}

/**
 * Some information such as interrupt counters & restart counters need to be reset
 * after we have successfully interrupted or restarted a kernel.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resetData(resource: Resource, eventName: string, properties: any) {
    // Once we have successfully interrupted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookInterrupt) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookInterrupt>;
        const data: undefined | typeof kv[Telemetry.NotebookInterrupt] = properties;
        // Check result to determine if success.
        if (data && 'result' in data && data.result === InterruptResult.Success) {
            clearInterruptCounter(resource);
        }
    }
    // Once we have successfully restarted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookRestart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookRestart>;
        const data: undefined | typeof kv[Telemetry.NotebookRestart] = properties;
        // For restart to be successful, we should not have `failed`
        const failed = data && 'failed' in data ? data.failed : false;
        if (!failed) {
            clearInterruptCounter(resource);
        }
    }
}
