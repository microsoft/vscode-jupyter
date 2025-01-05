// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, workspace, EventEmitter } from 'vscode';
import { Kernel, Kernels } from '../../../api';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IKernel, IKernelProvider } from '../../../kernels/types';
import { createKernelApiForExtension as createKernelApiForExtension } from './kernel';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { DATA_WRANGLER_EXTENSION_ID, JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../../../kernels/telemetry/helper';
import { IDisposableRegistry } from '../../../platform/common/types';

const kernelCache = new WeakMap<IKernel, Kernel>();
let _onDidStart: EventEmitter<{ uri: Uri; kernel: Kernel }> | undefined = undefined;

function getWrappedKernel(kernel: IKernel, extensionId: string) {
    let wrappedKernel = kernelCache.get(kernel) || createKernelApiForExtension(extensionId, kernel);
    kernelCache.set(kernel, wrappedKernel);
    return wrappedKernel;
}

export function getKernelsApi(extensionId: string): Kernels {
    return {
        async getKernel(uri: Uri) {
            let accessAllowed: boolean | undefined = undefined;

            const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
            const notebook = workspace.notebookDocuments.find((item) => item.uri.toString() === uri.toString());
            const kernel = kernelProvider.get(notebook || uri);
            // We are only interested in returning kernels that have been started by the user.
            // Returning started kernels is not sufficient as we also pre-warm kernels (i.e. we start kernels even though the user may not have executed any code).
            if (!kernel || !kernel.startedAtLeastOnce || !kernel.userStartedKernel) {
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
            return getWrappedKernel(kernel, extensionId);
        },
        get onDidStart() {
            if (![JVSC_EXTENSION_ID, DATA_WRANGLER_EXTENSION_ID].includes(extensionId)) {
                throw new Error(`Proposed API is not supported for extension ${extensionId}`);
            }

            // We can cache the event emitter for subsequent calls.
            if (!_onDidStart) {
                const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
                const disposableRegistry = ServiceContainer.instance.get<IDisposableRegistry>(IDisposableRegistry);
                _onDidStart = new EventEmitter<{ uri: Uri; kernel: Kernel }>();

                disposableRegistry.push(
                    kernelProvider.onDidPostInitializeKernel((kernel) => {
                        _onDidStart?.fire({ uri: kernel.uri, kernel: getWrappedKernel(kernel, extensionId) });
                    }),
                    _onDidStart,
                    { dispose: () => (_onDidStart = undefined) }
                );
            }

            return _onDidStart.event;
        }
    };
}
