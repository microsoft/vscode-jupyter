// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, workspace, EventEmitter, CancellationToken } from 'vscode';
import { Kernel, Kernels } from '../../../api';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IKernel, IKernelProvider } from '../../../kernels/types';
import { createKernelApiForExtension as createKernelApiForExtension } from './kernel';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import {
    DATA_WRANGLER_EXTENSION_ID,
    JVSC_EXTENSION_ID,
    PROPOSED_API_ALLOWED_PUBLISHERS
} from '../../../platform/common/constants';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../../../kernels/telemetry/helper';
import { IDisposableRegistry } from '../../../platform/common/types';
import { createDeferredFromPromise } from '../../../platform/common/utils/async';
import { logger } from '../../../platform/logging';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import { sendKernelTelemetryEvent } from '../../../kernels/telemetry/sendKernelTelemetryEvent';
import { KernelExecutionProgressIndicator } from './kernelProgressIndicator';

const extensionAPICache = new Map<
    string,
    {
        onDidStart:
            | EventEmitter<{
                  uri: Uri;
                  kernel: Kernel;
                  token: CancellationToken;
                  waitUntil(thenable: Thenable<unknown>): void;
              }>
            | undefined;
        // Kernel cache needs to be scoped per extension to make sure that the progress messages
        // show accurately which extension is actually using it.
        kernels: WeakMap<IKernel, { api: Kernel; progress: KernelExecutionProgressIndicator }>;
    }
>();

function getOrCreateExtensionAPI(extensionId: string) {
    if (!extensionAPICache.has(extensionId)) {
        extensionAPICache.set(extensionId, {
            onDidStart: undefined,
            kernels: new WeakMap<IKernel, { api: Kernel; progress: KernelExecutionProgressIndicator }>()
        });
    }
    return extensionAPICache.get(extensionId)!;
}

function getWrappedKernel(kernel: IKernel, extensionId: string) {
    const extensionAPI = getOrCreateExtensionAPI(extensionId);
    let wrappedKernel = extensionAPI.kernels.get(kernel) || createKernelApiForExtension(extensionId, kernel);
    extensionAPI.kernels.set(kernel, wrappedKernel);
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
            const { api } = getWrappedKernel(kernel, extensionId);
            return api;
        },
        get onDidStart() {
            if (
                ![JVSC_EXTENSION_ID, DATA_WRANGLER_EXTENSION_ID].includes(extensionId) &&
                !PROPOSED_API_ALLOWED_PUBLISHERS.includes(extensionId.split('.')[0])
            ) {
                throw new Error(`Proposed API is not supported for extension ${extensionId}`);
            }

            // We can cache the event emitter for subsequent calls.
            const extensionAPI = getOrCreateExtensionAPI(extensionId);
            if (!extensionAPI.onDidStart) {
                const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
                const disposableRegistry = ServiceContainer.instance.get<IDisposableRegistry>(IDisposableRegistry);
                extensionAPI.onDidStart = new EventEmitter<{
                    uri: Uri;
                    kernel: Kernel;
                    token: CancellationToken;
                    waitUntil(thenable: Thenable<unknown>): void;
                }>();

                disposableRegistry.push(
                    extensionAPI.onDidStart,
                    kernelProvider.onDidPostInitializeKernel(({ kernel, token, waitUntil }) => {
                        const { api, progress } = getWrappedKernel(kernel, extensionId);
                        extensionAPI.onDidStart?.fire({
                            uri: kernel.uri,
                            kernel: api,
                            token,
                            waitUntil: (thenable) => {
                                // Wrap around the `waitUntil` method to inject telemetry and notifications.
                                // For notifications, we reuse the kernel execution progress indicator message
                                // regardless of whether something is actually running on the kernel, since
                                // it is effectively preventing access to it.
                                const deferrable = createDeferredFromPromise(Promise.resolve(thenable));
                                waitUntil(thenable);
                                const disposable = progress.show();
                                const stopWatch = new StopWatch();
                                void deferrable.promise.finally(() => {
                                    logger.trace(
                                        `${extensionId} took ${stopWatch.elapsedTime}ms during kernel startup`
                                    );
                                    sendKernelTelemetryEvent(
                                        kernel.resourceUri,
                                        Telemetry.NewJupyterKernelApiKernelStartupWaitUntil,
                                        { duration: stopWatch.elapsedTime },
                                        { extensionId }
                                    );
                                    disposable.dispose();
                                });
                            }
                        });
                    }),
                    extensionAPI.onDidStart
                );
            }

            return extensionAPI.onDidStart.event;
        }
    };
}
