// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { Uri } from 'vscode';
import { getOSType } from '../../common/utils/platform';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { Resource } from '../../common/types';
import { IEventNamePropertyMapping, sendTelemetryEvent, setSharedProperty, waitBeforeSending } from '../../telemetry';
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
import { createDeferred } from '../../common/utils/async';

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
    if (eventName === Telemetry.ExecuteCell || eventName === Telemetry.ExecuteNativeCell) {
        setSharedProperty('userExecutedCell', 'true');
    }

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
    stopWatch?: StopWatch,
    properties?: P[E] & { [waitBeforeSending]?: Promise<void> }
) {
    if (eventName === Telemetry.ExecuteCell || eventName === Telemetry.ExecuteNativeCell) {
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
                    const props = getContextualPropsForTelemetry(resource);
                    Object.assign(props, properties || {});
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    populateTelemetryWithErrorInfo(props as any, ex);
                    sendTelemetryEvent(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        eventName as any,
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        stopWatch!.elapsedTime,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        props as any,
                        ex,
                        true
                    );
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
        const newKernelConnectionId = kernelConnection.id;
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
        context.previouslySelectedKernelConnectionId = kernelConnection.id;

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

            updatePythonPackages(currentData);
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
function updatePythonPackages(
    currentData: ResourceSpecificTelemetryProperties & { waitBeforeSending?: Promise<void> },
    clonedCurrentData?: ResourceSpecificTelemetryProperties & {
        waitBeforeSending?: Promise<void>;
    }
) {
    if (!currentData.pythonEnvironmentPath) {
        return;
    }
    // Getting package information is async, hence update property to indicate that a promise is pending.
    const deferred = createDeferred<void>();
    // Hold sending of telemetry until we have updated the props with package information.
    currentData.waitBeforeSending = deferred.promise;
    if (clonedCurrentData) {
        clonedCurrentData.waitBeforeSending = deferred.promise;
    }
    getPythonEnvironmentPackages({
        interpreterHash: currentData.pythonEnvironmentPath
    })
        .then((packages) => {
            currentData.pythonEnvironmentPackages = packages || currentData.pythonEnvironmentPackages;
            if (clonedCurrentData) {
                clonedCurrentData.pythonEnvironmentPackages = packages || clonedCurrentData.pythonEnvironmentPackages;
            }
        })
        .catch(() => undefined)
        .finally(() => {
            deferred.resolve();
            currentData.waitBeforeSending = undefined;
            if (clonedCurrentData) {
                clonedCurrentData.waitBeforeSending = undefined;
            }
        });
}
/**
 * Gets a JSON with hashed keys of some python packages along with their versions.
 */
async function getPythonEnvironmentPackages(options: { interpreter: PythonEnvironment } | { interpreterHash: string }) {
    let interpreter: PythonEnvironment | undefined;
    if ('interpreter' in options) {
        interpreter = options.interpreter;
    } else {
        interpreter = pythonEnvironmentsByHash.get(options.interpreterHash);
    }
    if (!interpreter) {
        return '{}';
    }
    const packages = await InterpreterPackages.getPackageVersions(interpreter).catch(() => new Map<string, string>());
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

/**
 * Always return a clone of the properties.
 * We will be using a reference of this object elsewhere & adding properties to the object.
 */
function getContextualPropsForTelemetry(
    resource: Resource
): ResourceSpecificTelemetryProperties & { waitBeforeSendingTelemetry?: Promise<void> } {
    if (!resource) {
        return {};
    }
    const data = trackedInfo.get(getUriKey(resource));
    const resourceType = getResourceType(resource);
    if (!data && resourceType) {
        return {
            resourceType
        };
    }
    if (!data) {
        return {};
    }
    // Create a copy of this data as it gets updated later asynchronously for other events.
    // At the point of sending this telemetry we don't want it to change again.
    const clonedData = cloneDeep(data[0]);
    // Possible the Python package information is now available, update the properties accordingly.
    // We want to update both the data items with package information
    // 1. Data we track against the Uri.
    // 2. Data that is returned & sent via telemetry now
    updatePythonPackages(data[0], clonedData);
    return clonedData;
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
