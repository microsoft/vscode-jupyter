// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { Kernel, Kernels } from '../../api';
import { ServiceContainer } from '../../platform/ioc/container';
import { IKernel, IKernelProvider, isRemoteConnection } from '../types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { createKernelApiForExtension as createKernelApiForExtension } from './kernel';
import { Telemetry, sendTelemetryEvent } from '../../telemetry';
import { requestApiAccess } from './apiAccess';

const kernelCache = new WeakMap<IKernel, Kernel>();

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
            // Check and prompt for access only if we know we have a kernel.
            const access = await requestApiAccess(extensionId);
            accessAllowed = access.accessAllowed;
            sendTelemetryEvent(Telemetry.NewJupyterKernelsApiUsage, undefined, {
                extensionId,
                pemUsed: 'getKernel',
                accessAllowed
            });
            if (!accessAllowed) {
                return;
            }

            let wrappedKernel = kernelCache.get(kernel) || createKernelApiForExtension(extensionId, kernel, access);
            kernelCache.set(kernel, wrappedKernel);
            return wrappedKernel;
        }
    };
}
