// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../../platform/common/types';
import { WorkspaceInterpreterTracker } from '../../platform/interpreter/workspaceInterpreterTracker';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { getNormalizedInterpreterPath } from '../../platform/pythonEnvironments/info/interpreter';
import { getResourceType } from '../../platform/common/utils';
import { getComparisonKey } from '../../platform/vscode-path/resources';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { trackedInfo, pythonEnvironmentsByHash, updatePythonPackages } from '../../platform/telemetry/telemetry';
import { KernelActionSource, KernelConnectionMetadata } from '../types';
import { getEnvironmentType, getVersion } from '../../platform/interpreter/helpers';

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
    /**
     * Whether we managed to capture the environment variables or not.
     * In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.
     */
    capturedEnvVars?: boolean;
};

export async function trackKernelResourceInformation(
    resource: Resource,
    information: Partial<ContextualTelemetryProps>
) {
    if (!resource) {
        return;
    }
    const key = getComparisonKey(resource);
    const [currentData, context] = trackedInfo.get(key) || [
        {
            resourceType: getResourceType(resource),
            resourceHash: resource ? await getTelemetrySafeHashedString(resource.toString()) : undefined,
            kernelSessionId: await getTelemetrySafeHashedString(Date.now().toString()),
            capturedEnvVars: undefined,
            userExecutedCell: undefined,
            disableUI: undefined,
            kernelLanguage: undefined,
            kernelId: undefined,
            kernelSpecHash: undefined,
            isUsingActiveInterpreter: undefined,
            pythonEnvironmentType: undefined,
            pythonEnvironmentPath: undefined,
            pythonEnvironmentVersion: undefined,
            kernelConnectionType: undefined
        },
        { previouslySelectedKernelConnectionId: '' }
    ];
    if (typeof information.capturedEnvVars === 'boolean') {
        currentData.capturedEnvVars = information.capturedEnvVars;
    }
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
            currentData.userExecutedCell = information.userExecutedCell;
            currentData.disableUI = information.disableUI;
        }
        if (
            context.previouslySelectedKernelConnectionId &&
            context.previouslySelectedKernelConnectionId !== newKernelConnectionId
        ) {
            currentData.kernelSessionId = await getTelemetrySafeHashedString(Date.now().toString());
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
        const kernelSpecHash =
            'kernelSpec' in kernelConnection && kernelConnection.kernelSpec.specFile
                ? getTelemetrySafeHashedString(kernelConnection.kernelSpec.specFile)
                : Promise.resolve('');
        currentData.kernelLanguage = language;
        [currentData.kernelId, currentData.kernelSpecHash] = await Promise.all([
            getTelemetrySafeHashedString(kernelConnection.id),
            kernelSpecHash
        ]);

        // Keep track of the kernel that was last selected.
        context.previouslySelectedKernelConnectionId = kernelConnection.id;

        const interpreter = kernelConnection.interpreter;
        if (interpreter) {
            currentData.isUsingActiveInterpreter = WorkspaceInterpreterTracker.isActiveWorkspaceInterpreter(
                resource,
                interpreter
            );
            currentData.pythonEnvironmentType = getEnvironmentType(interpreter);
            const [pythonEnvironmentPath, version] = await Promise.all([
                getTelemetrySafeHashedString(getFilePath(getNormalizedInterpreterPath(interpreter.uri))),
                getVersion(interpreter)
            ]);
            currentData.pythonEnvironmentPath = pythonEnvironmentPath;
            pythonEnvironmentsByHash.set(currentData.pythonEnvironmentPath, interpreter);
            if (version) {
                currentData.pythonEnvironmentVersion = `${version.major}.${version.minor}.${version.micro}`;
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
export async function initializeInteractiveOrNotebookTelemetryBasedOnUserAction(
    resourceUri: Resource,
    kernelConnection: KernelConnectionMetadata
) {
    await trackKernelResourceInformation(resourceUri, { kernelConnection, userExecutedCell: true });
}
