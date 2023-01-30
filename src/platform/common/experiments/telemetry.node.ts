// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExperimentationTelemetry } from 'vscode-tas-client';
import { sendTelemetryEvent, setSharedProperty } from '../../../telemetry';

/**
 * Used by the experimentation service to send extra properties
 */
export class ExperimentationTelemetry implements IExperimentationTelemetry {
    public setSharedProperty(name: string, value: string): void {
        // Add the shared property to all telemetry being sent, not just events being sent by the experimentation package.
        // We are not in control of these props, just cast to `any`, i.e. we cannot strongly type these external props.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setSharedProperty(name as any, value as any);
    }

    public postEvent(eventName: string, properties: Map<string, string>): void {
        const formattedProperties: { [key: string]: string } = {};
        properties.forEach((value, key) => {
            formattedProperties[key] = value;
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendTelemetryEvent(eventName as any, undefined, formattedProperties);
    }
}
