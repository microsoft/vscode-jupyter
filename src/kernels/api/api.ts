// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { Kernel, Kernels } from '../../api';
import { ServiceContainer } from '../../platform/ioc/container';
import { IKernel, IKernelProvider, isRemoteConnection } from '../types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { createKernelApiForExetnsion } from './kernel';

// Each extension gets its own instance of the API.
const apiCache = new Map<string, Kernels>();
const kernelCache = new WeakMap<IKernel, Kernel>();

export function getKernelsApi(extensionId: string): Kernels {
    // Each extension gets its own instance of the API.
    let api = apiCache.get(extensionId);
    if (api) {
        return api;
    }

    api = {
        isRevoked: false,
        findKernel(query: { uri: Uri }) {
            const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
            const notebooks = ServiceContainer.instance.get<IVSCodeNotebook>(IVSCodeNotebook);
            const notebook = notebooks.notebookDocuments.find((item) => item.uri.toString() === query.uri.toString());
            const kernel = kernelProvider.get(notebook || query.uri);
            // We are only interested in returning kernels that have been started by the user.
            if (!kernel || !kernel.startedAtLeastOnce) {
                return;
            }
            const execution = kernelProvider.getKernelExecution(kernel);
            if (!isRemoteConnection(kernel.kernelConnectionMetadata) && execution.executionCount === 0) {
                // For local kernels, execution count must be greater than 0,
                // As we pre-warms kernels (i.e. we start kernels even though the user may not have executed any code).
                // The only way to determine whether users executed code is to look at the execution count
                return;
            }
            let wrappedKernel = kernelCache.get(kernel) || createKernelApiForExetnsion(extensionId, kernel);
            kernelCache.set(kernel, wrappedKernel);
            return wrappedKernel;
        }
    };
    apiCache.set(extensionId, api);
    return api;
}
