// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { getOSType } from '../../common/utils/platform';
import { getKernelConnectionId, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { Resource } from '../../common/types';
import { IEventNamePropertyMapping, sendTelemetryEvent, setSharedProperty } from '../../telemetry';
import { StopWatch } from '../../common/utils/stopWatch';
import { ResourceSpecificTelemetryProperties } from './types';
import { Telemetry } from '../constants';
import { WorkspaceInterpreterTracker } from './workspaceInterpreterTracker';
import { InterruptResult } from '../types';
import { getResourceType } from '../common';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { InterpreterCountTracker } from './interpreterCountTracker';
import { getTelemetrySafeHashedString, getTelemetrySafeLanguage } from '../../telemetry/helpers';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { InterpreterPackages } from './interpreterPackages';
import { populateTelemetryWithErrorInfo } from '../../common/errors';

type ContextualTelemetryProps = {
    kernelConnection: KernelConnectionMetadata;
    /**
     * Used by WebViews & Interactive window.
     * In those cases we know for a fact that the user changes the kernel.
     * In Native Notebooks, we don't know whether the user changed the kernel or VS Code is just asking for default kernel.
     * In Native Notebooks we track changes to selection by checking if previously selected kernel is the same as the new one.
     */
    kernelConnectionChanged: boolean;
    startFailed: boolean;
    kernelDied: boolean;
    interruptKernel: boolean;
    restartKernel: boolean;
    kernelSpecCount: number; // Total number of kernel specs in list of kernels.
    kernelInterpreterCount: number; // Total number of interpreters in list of kernels
    kernelLiveCount: number; // Total number of live kernels in list of kernels.
};

type Context = {
    previouslySelectedKernelConnectionId: string;
};
const trackedInfo = new Map<string, [ResourceSpecificTelemetryProperties, Context]>();
const currentOSType = getOSType();
const pythonEnvironmentsByHash = new Map<string, PythonEnvironment>();

export function sendKernelTelemetryEvent<P extends IEventNamePropertyMapping, E extends keyof P>(
    resource: Resource,
    eventName: E,
    durationMs?: Record<string, number> | number,
    properties?: P[E],
    ex?: Error
) {
    if (eventName === Telemetry.ExecuteCell) {
        setSharedProperty('userExecutedCell', 'true');
    }

    const addOnTelemetry = getContextualPropsForTelemetry(resource);
    const props = properties || {};
    Object.assign(props, addOnTelemetry || {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendTelemetryEvent(eventName as any, durationMs, props, ex);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resetData(resource, eventName as any, props);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    incrementStartFailureCount(resource, eventName as any, props);
}

export function sendKernelTelemetryWhenDone<P extends IEventNamePropertyMapping, E extends keyof P>(
    resource: Resource,
    eventName: E,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    promise: Promise<any> | Thenable<any>,
    stopWatch?: StopWatch,
    properties?: P[E]
) {
    if (eventName === Telemetry.ExecuteCell) {
        setSharedProperty('userExecutedCell', 'true');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = properties || {};
    stopWatch = stopWatch ? stopWatch : new StopWatch();
    if (typeof promise.then === 'function') {
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        (promise as Promise<any>)
            .then(
                (data) => {
                    const addOnTelemetry = getContextualPropsForTelemetry(resource);
                    Object.assign(props, addOnTelemetry);
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any
                    sendTelemetryEvent(eventName as any, stopWatch!.elapsedTime, props as any);
                    return data;
                    // eslint-disable-next-line @typescript-eslint/promise-function-async
                },
                (ex) => {
                    const addOnTelemetry = getContextualPropsForTelemetry(resource);
                    Object.assign(props, addOnTelemetry);
                    populateTelemetryWithErrorInfo(props, ex);
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any
                    sendTelemetryEvent(eventName as any, stopWatch!.elapsedTime, props as any, ex, true);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    incrementStartFailureCount(resource, eventName as any, props);
                    return Promise.reject(ex);
                }
            )
            .finally(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                resetData(resource, eventName as any, props);
            });
    }
}
export function trackKernelResourceInformation(resource: Resource, information: Partial<ContextualTelemetryProps>) {
    if (!resource) {
        return;
    }
    const key = getUriKey(resource);
    const [currentData, context] = trackedInfo.get(key) || [
        {
            resourceType: getResourceType(resource)
        },
        { previouslySelectedKernelConnectionId: '' }
    ];

    if (information.restartKernel) {
        currentData.interruptCount = 0;
        currentData.restartCount = (currentData.restartCount || 0) + 1;
    }
    if (information.interruptKernel) {
        currentData.interruptCount = (currentData.interruptCount || 0) + 1;
    }
    if (information.startFailed) {
        currentData.startFailureCount = (currentData.startFailureCount || 0) + 1;
    }
    currentData.kernelSpecCount = information.kernelSpecCount || currentData.kernelSpecCount || 0;
    currentData.kernelLiveCount = information.kernelLiveCount || currentData.kernelLiveCount || 0;
    currentData.kernelInterpreterCount = information.kernelInterpreterCount || currentData.kernelInterpreterCount || 0;
    currentData.pythonEnvironmentCount = InterpreterCountTracker.totalNumberOfInterpreters;

    const kernelConnection = information.kernelConnection;
    if (kernelConnection) {
        const newKernelConnectionId = getKernelConnectionId(kernelConnection);
        // If we have selected a whole new kernel connection for this,
        // Then reset some of the data
        if (context.previouslySelectedKernelConnectionId !== newKernelConnectionId) {
            clearInterruptCounter(resource);
            clearRestartCounter(resource);
        }
        if (
            context.previouslySelectedKernelConnectionId &&
            context.previouslySelectedKernelConnectionId !== newKernelConnectionId
        ) {
            currentData.switchKernelCount = (currentData.switchKernelCount || 0) + 1;
        }
        if (information.kernelConnectionChanged) {
            currentData.switchKernelCount = (currentData.switchKernelCount || 0) + 1;
        }
        let language: string | undefined;
        switch (kernelConnection.kind) {
            case 'connectToLiveKernel':
                language = kernelConnection.kernelModel.language;
                break;
            case 'startUsingKernelSpec':
                language = kernelConnection.kernelSpec.language;
                break;
            case 'startUsingPythonInterpreter':
                language = PYTHON_LANGUAGE;
                break;
            default:
                break;
        }
        currentData.kernelLanguage = getTelemetrySafeLanguage(language);
        // Keep track of the kernel that was last selected.
        context.previouslySelectedKernelConnectionId = getKernelConnectionId(kernelConnection);

        const interpreter = kernelConnection.interpreter;
        if (interpreter) {
            currentData.isUsingActiveInterpreter = WorkspaceInterpreterTracker.isActiveWorkspaceInterpreter(
                resource,
                interpreter
            );
            currentData.pythonEnvironmentType = interpreter.envType;
            currentData.pythonEnvironmentPath = getTelemetrySafeHashedString(interpreter.path);
            pythonEnvironmentsByHash.set(currentData.pythonEnvironmentPath, interpreter);
            if (interpreter.version) {
                const { major, minor, patch } = interpreter.version;
                currentData.pythonEnvironmentVersion = `${major}.${minor}.${patch}`;
            } else {
                currentData.pythonEnvironmentVersion = undefined;
            }

            currentData.pythonEnvironmentPackages = getPythonEnvironmentPackages({ interpreter });
        }

        currentData.kernelConnectionType = currentData.kernelConnectionType || kernelConnection?.kind;
    } else {
        context.previouslySelectedKernelConnectionId = '';
    }

    trackedInfo.set(key, [currentData, context]);
}

/**
 * The python package information is fetch asynchronously.
 * Its possible the information is available at a later time.
 * Use this to update with the latest information (if available)
 */
function updatePythonPackages(currentData: ResourceSpecificTelemetryProperties) {
    // Possible the Python package information is now available, update the properties accordingly.
    if (currentData.pythonEnvironmentPath) {
        currentData.pythonEnvironmentPackages =
            getPythonEnvironmentPackages({ interpreterHash: currentData.pythonEnvironmentPath }) ||
            currentData.pythonEnvironmentPackages;
    }
}
/**
 * Gets a JSON with hashed keys of some python packages along with their versions.
 */
function getPythonEnvironmentPackages(options: { interpreter: PythonEnvironment } | { interpreterHash: string }) {
    let interpreter: PythonEnvironment | undefined;
    if ('interpreter' in options) {
        interpreter = options.interpreter;
    } else {
        interpreter = pythonEnvironmentsByHash.get(options.interpreterHash);
    }
    if (!interpreter) {
        return '{}';
    }
    const packages = InterpreterPackages.getPackageVersions(interpreter);
    if (!packages || packages.size === 0) {
        return '{}';
    }
    return JSON.stringify(Object.fromEntries(packages));
}
export function deleteTrackedInformation(resource: Uri) {
    trackedInfo.delete(getUriKey(resource));
}

function getUriKey(uri: Uri) {
    return currentOSType ? uri.fsPath.toLowerCase() : uri.fsPath;
}

function getContextualPropsForTelemetry(resource: Resource): ResourceSpecificTelemetryProperties | undefined {
    if (!resource) {
        return;
    }
    const data = trackedInfo.get(getUriKey(resource));
    const resourceType = getResourceType(resource);
    if (!data && resourceType) {
        return {
            resourceType
        };
    }
    if (data) {
        // Possible the Python package information is now available, update the properties accordingly.
        updatePythonPackages(data[0]);
    }
    return data ? data[0] : undefined;
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
function clearInterruptCounter(resource: Resource) {
    if (!resource) {
        return;
    }
    const key = getUriKey(resource);
    const currentData = trackedInfo.get(key);
    if (currentData) {
        currentData[0].interruptCount = 0;
    }
}
function clearRestartCounter(resource: Resource) {
    if (!resource) {
        return;
    }
    const key = getUriKey(resource);
    const currentData = trackedInfo.get(key);
    if (currentData) {
        currentData[0].restartCount = 0;
        currentData[0].startFailureCount = 0;
    }
}
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
