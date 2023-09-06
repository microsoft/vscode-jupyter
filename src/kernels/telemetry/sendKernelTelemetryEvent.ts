// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../../platform/common/types';
import { sendTelemetryEvent, IEventNamePropertyMapping, TelemetryEventInfo } from '../../telemetry';
import { getContextualPropsForTelemetry } from '../../platform/telemetry/telemetry';
import { ExcludeType, noop, PickType, UnionToIntersection } from '../../platform/common/utils/misc';

export function sendKernelTelemetryEvent<P extends IEventNamePropertyMapping, E extends keyof P>(
    resource: Resource,
    eventName: E,
    measures?:
        | (P[E] extends TelemetryEventInfo<infer R> ? Partial<PickType<UnionToIntersection<R>, number>> : undefined)
        | undefined,
    properties?: P[E] extends TelemetryEventInfo<infer R>
        ? ExcludeType<R, number> extends never | undefined
            ? undefined
            : Partial<ExcludeType<R, number>>
        : undefined | undefined,
    ex?: Error | undefined
) {
    getContextualPropsForTelemetry(resource)
        .then((props) => {
            Object.assign(props, properties || {});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sendTelemetryEvent(eventName as any, measures as any, props as any, ex);
        })
        .catch(noop);
}
