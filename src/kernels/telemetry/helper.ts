// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../../platform/common/types';
import { WorkspaceInterpreterTracker } from '../../platform/interpreter/workspaceInterpreterTracker';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { InterpreterCountTracker } from '../../platform/interpreter/interpreterCountTracker';
import { getTelemetrySafeHashedString, getTelemetrySafeLanguage } from '../../platform/telemetry/helpers';
import { getNormalizedInterpreterPath } from '../../platform/pythonEnvironments/info/interpreter';
import { getResourceType } from '../../platform/common/utils';
import { getComparisonKey } from '../../platform/vscode-path/resources';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { trackedInfo, pythonEnvironmentsByHash, updatePythonPackages } from '../../platform/telemetry/telemetry';
import { KernelActionSource, KernelConnectionMetadata } from '../types';

/**
 * This information is sent with each telemetry event.
 */
export type ContextualTelemetryProps = {
    /**
     * Whether we're starting the preferred kernel or not.
     * If false, then the user chose a different kernel when starting the notebook.
     * Doesn't really apply to Interactive Window, as we always pick the current interpreter.
     */
    isPreferredKernel?: boolean;
    kernelConnection: KernelConnectionMetadata;
    startFailed: boolean;
    kernelDied: boolean;
    interruptKernel: boolean;
    restartKernel: boolean;
    kernelSpecCount: number; // Total number of kernel specs in list of kernels.
    kernelInterpreterCount: number; // Total number of interpreters in list of kernels
    kernelLiveCount: number; // Total number of live kernels in list of kernels.
    /**
     * When we start local Python kernels, this property indicates whether the interpreter matches the kernel. If not this means we've started the wrong interpreter or the mapping is wrong.
     */
    interpreterMatchesKernel: boolean;
    actionSource: KernelActionSource;
    /**
     * Whether the user executed a cell.
     */
    userExecutedCell?: boolean;
    /**
     * Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.
     * If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)
     */
    disableUI?: boolean;
};

export function trackKernelResourceInformation(resource: Resource, information: Partial<ContextualTelemetryProps>) {
    if (!resource) {
        return;
    }
    const key = getComparisonKey(resource);
    const [currentData, context] = trackedInfo.get(key) || [
        {
            resourceType: getResourceType(resource),
            resourceHash: resource ? getTelemetrySafeHashedString(resource.toString()) : undefined,
            kernelSessionId: getTelemetrySafeHashedString(Date.now().toString())
        },
        { previouslySelectedKernelConnectionId: '' }
    ];

    if (information.restartKernel) {
        currentData.kernelSessionId = getTelemetrySafeHashedString(Date.now().toString());
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
    if (information.userExecutedCell) {
        currentData.userExecutedCell = true;
    }
    if (typeof information.disableUI === 'boolean') {
        currentData.disableUI = information.disableUI;
    }
    const kernelConnection = information.kernelConnection;
    if (kernelConnection) {
        const newKernelConnectionId = kernelConnection.id;
        // If we have selected a whole new kernel connection for this,
        // Then reset some of the data
        if (context.previouslySelectedKernelConnectionId !== newKernelConnectionId) {
            clearInterruptCounter(resource);
            clearRestartCounter(resource);
            currentData.userExecutedCell = information.userExecutedCell;
            currentData.disableUI = information.disableUI;
        }
        if (
            context.previouslySelectedKernelConnectionId &&
            context.previouslySelectedKernelConnectionId !== newKernelConnectionId
        ) {
            currentData.kernelSessionId = getTelemetrySafeHashedString(Date.now().toString());
            currentData.switchKernelCount = (currentData.switchKernelCount || 0) + 1;
        }
        let language: string | undefined;
        switch (kernelConnection.kind) {
            case 'connectToLiveRemoteKernel':
                language = kernelConnection.kernelModel.language;
                break;
            case 'startUsingRemoteKernelSpec':
            case 'startUsingLocalKernelSpec':
                language = kernelConnection.kernelSpec.language;
                break;
            case 'startUsingPythonInterpreter':
                language = PYTHON_LANGUAGE;
                break;
            default:
                break;
        }
        currentData.kernelLanguage = getTelemetrySafeLanguage(language);
        currentData.kernelId = getTelemetrySafeHashedString(kernelConnection.id);
        // Keep track of the kernel that was last selected.
        context.previouslySelectedKernelConnectionId = kernelConnection.id;

        const interpreter = kernelConnection.interpreter;
        if (interpreter) {
            currentData.isUsingActiveInterpreter = WorkspaceInterpreterTracker.isActiveWorkspaceInterpreter(
                resource,
                interpreter
            );
            currentData.pythonEnvironmentType = interpreter.envType;
            currentData.pythonEnvironmentPath = getTelemetrySafeHashedString(
                getFilePath(getNormalizedInterpreterPath(interpreter.uri))
            );
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
 * Initializes the Interactive/Notebook telemetry as a result of user action.
 */
export function initializeInteractiveOrNotebookTelemetryBasedOnUserAction(
    resourceUri: Resource,
    kernelConnection: KernelConnectionMetadata
) {
    trackKernelResourceInformation(resourceUri, { kernelConnection, userExecutedCell: true });
}

export function clearInterruptCounter(resource: Resource) {
    if (!resource) {
        return;
    }
    const key = getComparisonKey(resource);
    const currentData = trackedInfo.get(key);
    if (currentData) {
        currentData[0].interruptCount = 0;
    }
}
export function clearRestartCounter(resource: Resource) {
    if (!resource) {
        return;
    }
    const key = getComparisonKey(resource);
    const currentData = trackedInfo.get(key);
    if (currentData) {
        currentData[0].restartCount = 0;
        currentData[0].startFailureCount = 0;
    }
}
