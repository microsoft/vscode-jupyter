// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { getOSType } from '../../common/utils/platform';
import { EnvironmentType } from '../../pythonEnvironments/info';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import * as hashjs from 'hash.js';
import { Resource } from '../../common/types';
import { IEventNamePropertyMapping, sendTelemetryEvent, sendTelemetryWhenDone } from '../../telemetry';
import { StopWatch } from '../../common/utils/stopWatch';

let connection: KernelConnectionMetadata;
export type ResourceSpecificTelemetryProperties = {
    resourceType: 'notebook' | 'interactive';
    pythonEnvironmentType?: EnvironmentType;
    pythonEnvironmentPath?: string;
    pythonEnvironmentVersion?: string;
    kernelWasAutoStarted?: boolean;
    kernelConnectionType?: typeof connection.kind;
    kernelStartedSuccessfully?: boolean;
};

type ContextualTelemetryProps = {
    kernelConnection: KernelConnectionMetadata;
    wasJupyterAutoStarted: boolean;
};

const trackedInfo = new Map<string, ResourceSpecificTelemetryProperties>();
const currentOSType = getOSType();

export function sendKernelTelemetryEvent<P extends IEventNamePropertyMapping, E extends keyof P>(
    resource: Resource,
    eventName: E,
    durationMs?: Record<string, number> | number,
    properties?: P[E],
    ex?: Error
) {
    const addOnTelemetry = getContextualPropsForTelemetry(resource);
    if (addOnTelemetry) {
        const props = properties || {};
        sendTelemetryEvent(eventName as any, durationMs, Object.assign(props, addOnTelemetry), ex);
    } else {
        sendTelemetryEvent(eventName as any, durationMs, properties, ex);
    }
}
export function sendKernelTelemetryWhenDone<P extends IEventNamePropertyMapping, E extends keyof P>(
    resource: Resource,
    eventName: E,
    promise: Promise<any> | Thenable<any>,
    stopWatch?: StopWatch,
    properties?: P[E]
) {
    const addOnTelemetry = getContextualPropsForTelemetry(resource);
    if (addOnTelemetry) {
        const props = properties || {};
        sendTelemetryWhenDone(eventName as any, promise, stopWatch, Object.assign(props, addOnTelemetry));
    } else {
        sendTelemetryWhenDone(eventName as any, promise, stopWatch, properties);
    }
}
export function trackResourceInformation(resource: Resource, information: Partial<ContextualTelemetryProps>) {
    if (!resource) {
        return;
    }
    const key = getUriKey(resource);
    const currentData: ResourceSpecificTelemetryProperties = trackedInfo.get(key) || {
        resourceType: getResourceType(resource)
    };
    if (information.kernelConnection) {
        const interpreter = information.kernelConnection.interpreter;
        if (interpreter) {
            currentData.pythonEnvironmentType = interpreter.envType;
            currentData.pythonEnvironmentPath = hashjs.sha256().update(interpreter.path).digest('hex');
            if (interpreter.version) {
                const { major, minor, patch } = interpreter.version;
                currentData.pythonEnvironmentVersion = `${major}${minor}${patch}`;
            } else {
                currentData.pythonEnvironmentVersion = undefined;
            }
        }
        currentData.kernelConnectionType = currentData.kernelConnectionType || information.kernelConnection?.kind;
    }

    trackedInfo.set(key, currentData);
}
export function deleteTrackedInformation(resource: Uri) {
    trackedInfo.delete(getUriKey(resource));
}

function getResourceType(uri: Uri) {
    return uri.fsPath.toLowerCase().endsWith('ipynb') ? 'notebook' : 'interactive';
}
function getUriKey(uri: Uri) {
    return currentOSType ? uri.fsPath.toLowerCase() : uri.fsPath;
}

function getContextualPropsForTelemetry(resource: Resource): ResourceSpecificTelemetryProperties | undefined {
    if (!resource) {
        return;
    }
    return trackedInfo.get(getUriKey(resource));
}
