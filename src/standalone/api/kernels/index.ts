// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, workspace } from 'vscode';
import { Kernel, Kernels } from '../../../api';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IKernel, IKernelProvider, isRemoteConnection } from '../../../kernels/types';
import { createKernelApiForExtension as createKernelApiForExtension } from './kernel';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../../../kernels/telemetry/helper';

const kernelCache = new WeakMap<IKernel, Kernel>();

export function getKernelsApi(extensionId: string): Kernels {
    return {
        async getKernel(uri: Uri) {
            let accessAllowed: boolean | undefined = undefined;

            const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
            const notebook = workspace.notebookDocuments.find((item) => item.uri.toString() === uri.toString());
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
            if (extensionId !== JVSC_EXTENSION_ID) {
                void initializeInteractiveOrNotebookTelemetryBasedOnUserAction(
                    kernel.resourceUri,
                    kernel.kernelConnectionMetadata
                );
            }
            let wrappedKernel = kernelCache.get(kernel) || createKernelApiForExtension(extensionId, kernel);
            kernelCache.set(kernel, wrappedKernel);
            return wrappedKernel;
        }
    };
}
