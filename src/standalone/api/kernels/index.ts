// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, workspace, EventEmitter } from 'vscode';
import { Kernel, Kernels } from '../../../api';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IKernel, IKernelProvider } from '../../../kernels/types';
import { createKernelApiForExtension as createKernelApiForExtension } from './kernel';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../../../kernels/telemetry/helper';
import { IDisposableRegistry } from '../../../platform/common/types';

const kernelCache = new WeakMap<IKernel, Kernel>();
const _onDidInitialize = new EventEmitter<{ uri: Uri }>();
let isKernelProviderHookRegistered = false;

export function getKernelsApi(extensionId: string): Kernels {
    return {
        get onDidInitialize() {
            let accessAllowed: boolean | undefined = undefined;

            if (!isKernelProviderHookRegistered) {
                const disposableRegistry = ServiceContainer.instance.get<IDisposableRegistry>(IDisposableRegistry);
                const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
                disposableRegistry.push(
                    kernelProvider.onDidPostInitializeKernel((e) => {
                        _onDidInitialize.fire({
                            uri: e.uri
                        });
                    })
                );
                isKernelProviderHookRegistered = true;
            }

            sendTelemetryEvent(Telemetry.NewJupyterKernelsApiUsage, undefined, {
                extensionId,
                pemUsed: 'onDidInitialize',
                accessAllowed
            });

            return _onDidInitialize.event;
        },
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
