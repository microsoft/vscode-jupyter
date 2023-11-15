// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, extensions, window } from 'vscode';
import { Kernel, Kernels } from '../../api';
import { ServiceContainer } from '../../platform/ioc/container';
import { IKernel, IKernelProvider, isRemoteConnection } from '../types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { createKernelApiForExetnsion as createKernelApiForExtension } from './kernel';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../../test/constants';
import { Telemetry, sendTelemetryEvent } from '../../telemetry';

// Each extension gets its own instance of the API.
const apiCache = new Map<string, Promise<boolean>>();
const kernelCache = new WeakMap<IKernel, Kernel>();
const mappedKernelId = new WeakMap<Kernel, string>();

// This is only temporary for testing purposes. Even with the prompt other extensions will not be allowed to use this API.
// By the end of the iteartion we will have a proposed API and this will be removed.
const allowedAccessToProposedApi = new Set(['ms-toolsai.datawrangler', 'donjayamanne.python-environment-manager']);

export function getKernelsApi(extensionId: string): Kernels {
    return {
        async getKernel(uri: Uri) {
            let accessAllowed: boolean | undefined = undefined;

            const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
            const notebooks = ServiceContainer.instance.get<IVSCodeNotebook>(IVSCodeNotebook);
            const notebook = notebooks.notebookDocuments.find((item) => item.uri.toString() === uri.toString());
            const kernel = kernelProvider.get(notebook || uri);
            // We are only interested in returning kernels that have been started by the user.
            if (!kernel || !kernel.startedAtLeastOnce) {
                sendTelemetryEvent(Telemetry.NewJupyterKernelsApiUsage, undefined, {
                    extensionId,
                    pemUsed: 'getKernel',
                    accessAllowed
                });
                return;
            }
            const execution = kernelProvider.getKernelExecution(kernel);
            if (!isRemoteConnection(kernel.kernelConnectionMetadata) && execution.executionCount === 0) {
                // For local kernels, execution count must be greater than 0,
                // As we pre-warms kernels (i.e. we start kernels even though the user may not have executed any code).
                // The only way to determine whether users executed code is to look at the execution count
                sendTelemetryEvent(Telemetry.NewJupyterKernelsApiUsage, undefined, {
                    extensionId,
                    pemUsed: 'getKernel',
                    accessAllowed
                });
                return;
            }
            accessAllowed = await requestKernelAccess(extensionId);
            sendTelemetryEvent(Telemetry.NewJupyterKernelsApiUsage, undefined, {
                extensionId,
                pemUsed: 'getKernel',
                accessAllowed
            });
            if (!accessAllowed) {
                return;
            }

            let wrappedKernel = kernelCache.get(kernel) || createKernelApiForExtension(extensionId, kernel);
            kernelCache.set(kernel, wrappedKernel);
            mappedKernelId.set(wrappedKernel, kernel.id);
            return wrappedKernel;
        }
    };
}

export function getKernelId(kernel: Kernel) {
    return mappedKernelId.get(kernel);
}

async function requestKernelAccess(extensionId: string): Promise<boolean> {
    if (extensionId === JVSC_EXTENSION_ID_FOR_TESTS) {
        // Our own extension can use this API (used in tests)
        return true;
    }
    const promise = apiCache.get(extensionId) || requestKernelAccessImpl(extensionId);
    apiCache.set(extensionId, promise);
    return promise;
}

async function requestKernelAccessImpl(extensionId: string) {
    if (!allowedAccessToProposedApi.has(extensionId)) {
        throw new Error(`Extension ${extensionId} does not have access to proposed API`);
    }
    const displayName = extensions.getExtension(extensionId)?.packageJSON?.displayName || extensionId;
    // Not localized for now, as no one can use this except us (& DW).
    // Will work on a formal API access separately.
    const result = await window.showInformationMessage(
        `Grant extension ${displayName} (${extensionId}) access to kernels?`,
        {
            modal: true,
            detail: 'This allows the extension to execute arbitrary code against both local and remote kernels.'
        },
        'Yes',
        'No'
    );
    return result === 'Yes';
}
