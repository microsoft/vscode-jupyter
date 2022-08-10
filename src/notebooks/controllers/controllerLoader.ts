// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { isPythonNotebook } from '../../kernels/helpers';
import { IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { IKernelFinder, IKernelProvider, isRemoteConnection, KernelConnectionMetadata } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { isCancellationError } from '../../platform/common/cancellation';
import { InteractiveWindowView, JupyterNotebookView } from '../../platform/common/constants';
import { IDisposableRegistry, IExtensions } from '../../platform/common/types';
import { getNotebookMetadata } from '../../platform/common/utils';
import { noop } from '../../platform/common/utils/misc';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { traceError, traceInfoIfCI, traceVerbose } from '../../platform/logging';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { createActiveInterpreterController } from './helpers';
import { IControllerLoader, IControllerRegistration } from './types';

// Even after shutting down a kernel, the server API still returns the old information.
// Re-query after 2 seconds to ensure we don't get stale information.
const REMOTE_KERNEL_REFRESH_INTERVAL = 2_000;

/**
 * This class finds and creates notebook controllers.
 */
@injectable()
export class ControllerLoader implements IControllerLoader, IExtensionSyncActivationService {
    private wasPythonInstalledWhenFetchingControllers?: boolean;
    private refreshedEmitter = new vscode.EventEmitter<void>();
    // Promise to resolve when we have loaded our controllers
    private controllersPromise: Promise<void>;
    private loadCancellationToken: vscode.CancellationTokenSource | undefined;
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IControllerRegistration) private readonly registration: IControllerRegistration
    ) {
        this.loadControllers(true).ignoreErrors();
    }

    public activate(): void {
        this.interpreters.onDidChangeInterpreters(
            async () => {
                // Don't do anything if the interpreter list is still being refreshed
                if (!this.interpreters.refreshing) {
                    await this.loadControllers(true);
                }
            },
            this,
            this.disposables
        );

        // Make sure to reload whenever we do something that changes state
        const forceLoad = () => {
            this.loadControllers(true)
                .then(noop)
                .catch((ex) => traceError('Error reloading notebook controllers', ex));
        };
        this.serverUriStorage.onDidChangeUri(forceLoad, this, this.disposables);

        // If we create a new kernel, we need to refresh if the kernel is remote (because
        // we have live sessions possible)
        // Note, this is a perf optimization for right now. We should not need
        // to check for remote if the future when we support live sessions on local
        this.kernelProvider.onDidStartKernel((k) => {
            if (isRemoteConnection(k.kernelConnectionMetadata)) {
                forceLoad();
            }
        });

        // For kernel dispose we need to wait a bit, otherwise the list comes back the
        // same
        this.kernelProvider.onDidDisposeKernel(
            (k) => {
                if (k && isRemoteConnection(k.kernelConnectionMetadata)) {
                    setTimeout(forceLoad, REMOTE_KERNEL_REFRESH_INTERVAL);
                }
            },
            this,
            this.disposables
        );

        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        // If the extension activates after installing Jupyter extension, then ensure we load controllers right now.
        this.notebook.notebookDocuments.forEach((notebook) => this.onDidOpenNotebookDocument(notebook).catch(noop));
        // Be aware of if we need to re-look for kernels on extension change
        this.extensions.onDidChange(this.onDidChangeExtensions, this, this.disposables);
    }
    public loadControllers(refresh?: boolean | undefined): Promise<void> {
        if (!this.controllersPromise || refresh) {
            const stopWatch = new StopWatch();
            // Cancel previous load
            if (this.loadCancellationToken) {
                this.loadCancellationToken.cancel();
            }
            this.loadCancellationToken = new vscode.CancellationTokenSource();
            this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
            this.controllersPromise = this.loadControllersImpl(this.loadCancellationToken.token)
                .catch((e) => {
                    traceError('Error loading notebook controllers', e);
                    if (!isCancellationError(e, true)) {
                        // This can happen in the tests, and these get bubbled upto VSC and are logged as unhandled exceptions.
                        // Hence swallow cancellation errors.
                        throw e;
                    }
                })
                .finally(() => {
                    // Send telemetry related to fetching the kernel connections. Do it here
                    // because it's the combined result of cached and non cached.
                    sendKernelListTelemetry(
                        vscode.Uri.file('test.ipynb'), // Give a dummy ipynb value, we need this as its used in telemetry to determine the resource.
                        this.registration.registered.map((v) => v.connection),
                        stopWatch
                    );

                    traceInfoIfCI(`Providing notebook controllers with length ${this.registration.registered.length}.`);
                });
        }
        return this.controllersPromise;
    }
    public get refreshed(): vscode.Event<void> {
        return this.refreshedEmitter.event;
    }

    public get loaded() {
        return this.controllersPromise;
    }
    private async onDidOpenNotebookDocument(document: vscode.NotebookDocument) {
        // Restrict to only our notebook documents
        if (
            (document.notebookType !== JupyterNotebookView && document.notebookType !== InteractiveWindowView) ||
            !vscode.workspace.isTrusted
        ) {
            return;
        }

        if (isPythonNotebook(getNotebookMetadata(document)) && this.extensionChecker.isPythonExtensionInstalled) {
            // If we know we're dealing with a Python notebook, load the active interpreter as a kernel asap.
            createActiveInterpreterController(
                JupyterNotebookView,
                document.uri,
                this.interpreters,
                this.registration
            ).catch(noop);
        }
    }

    private async onDidChangeExtensions() {
        // If we just installed the Python extension and we fetched the controllers, then fetch it again.
        if (!this.wasPythonInstalledWhenFetchingControllers && this.extensionChecker.isPythonExtensionInstalled) {
            await this.loadControllers(true);
        }
    }

    private async loadControllersImpl(cancelToken: vscode.CancellationToken) {
        let cachedConnections = await this.listKernels(cancelToken, 'useCache');
        const nonCachedConnectionsPromise = this.listKernels(cancelToken, 'ignoreCache');

        traceVerbose(`Found ${cachedConnections.length} cached controllers`);
        // Now create or update the actual controllers from our connections. Do this for the cached connections
        // so they show up quicker.
        this.createNotebookControllers(cachedConnections);

        // Do the same thing again but with non cached
        const nonCachedConnections = await nonCachedConnectionsPromise;
        traceVerbose(`Found ${cachedConnections.length} non-cached controllers`);
        this.createNotebookControllers(nonCachedConnections);

        // Look for any controllers that we have disposed (no longer found when fetching)
        const disposedControllers = Array.from(this.registration.registered).filter((controller) => {
            const connectionIsNoLongerValid = !nonCachedConnections.some((connection) => {
                return connection.id === controller.connection.id;
            });

            // Never remove remote kernels that don't exist.
            // Always leave them there for user to select, and if the connection is not available/not valid,
            // then notify the user and remove them.
            if (connectionIsNoLongerValid && controller.connection.kind === 'connectToLiveRemoteKernel') {
                return true;
            }
            return connectionIsNoLongerValid;
        });

        // If we have any out of date connections, dispose of them
        disposedControllers.forEach((controller) => {
            traceInfoIfCI(`Disposing controller ${controller.id}`);
            controller.dispose(); // This should remove it from the registered list
        });

        // Indicate a refresh
        this.refreshedEmitter.fire();
    }

    private listKernels(
        cancelToken: vscode.CancellationToken,
        useCache: 'ignoreCache' | 'useCache'
    ): Promise<KernelConnectionMetadata[]> {
        // Filtering is done in the registration layer
        return this.kernelFinder.listKernels(undefined, cancelToken, useCache);
    }

    private createNotebookControllers(
        kernelConnections: KernelConnectionMetadata[],
        viewTypes: (typeof InteractiveWindowView | typeof JupyterNotebookView)[] = [
            JupyterNotebookView,
            InteractiveWindowView
        ]
    ) {
        traceVerbose(`Creating ${kernelConnections?.length} controllers`);

        try {
            kernelConnections.forEach((value) => {
                this.registration.add(value, viewTypes);
            });
        } catch (ex) {
            if (!isCancellationError(ex, true)) {
                // This can happen in the tests, and these get bubbled upto VSC and are logged as unhandled exceptions.
                // Hence swallow cancellation errors.
                throw ex;
            }
        }
    }
}
