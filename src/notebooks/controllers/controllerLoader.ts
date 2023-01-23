// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { isPythonNotebook } from '../../kernels/helpers';
import { IKernelFinder, KernelConnectionMetadata } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { ICommandManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { isCancellationError } from '../../platform/common/cancellation';
import { InteractiveWindowView, JupyterNotebookView } from '../../platform/common/constants';
import { ContextKey } from '../../platform/common/contextKey';
import { IDisposableRegistry } from '../../platform/common/types';
import { getNotebookMetadata } from '../../platform/common/utils';
import { noop } from '../../platform/common/utils/misc';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { traceError, traceInfoIfCI, traceVerbose } from '../../platform/logging';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { createActiveInterpreterController } from './helpers';
import { IControllerLoader, IControllerRegistration } from './types';

/**
 * This class finds and creates notebook controllers.
 */
@injectable()
export class ControllerLoader implements IControllerLoader, IExtensionSyncActivationService {
    private refreshedEmitter = new vscode.EventEmitter<void>();
    // Promise to resolve when we have loaded our controllers
    private controllersPromise: Promise<void>;
    private loadCancellationToken: vscode.CancellationTokenSource | undefined;
    private controllersLoadedContext: ContextKey;
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IControllerRegistration) private readonly registration: IControllerRegistration,
        @inject(ICommandManager) private readonly commandManager: ICommandManager
    ) {
        // This context key is set to true when controllers have completed their intitial load or are done loading after a refresh
        // It's set to false on activation and when a refresh is requested.
        this.controllersLoadedContext = new ContextKey('jupyter.controllersLoaded', this.commandManager);
    }

    public activate(): void {
        // Make sure to reload whenever we do something that changes state
        this.kernelFinder.onDidChangeKernels(
            () => {
                this.loadControllers(true)
                    .then(noop)
                    .catch((ex) => traceError('Error reloading notebook controllers', ex));
            },
            this,
            this.disposables
        );

        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        // If the extension activates after installing Jupyter extension, then ensure we load controllers right now.
        this.notebook.notebookDocuments.forEach((notebook) => this.onDidOpenNotebookDocument(notebook).catch(noop));

        this.loadControllers(true).ignoreErrors();

        this.controllersLoadedContext.set(false).then(noop, noop);
    }
    public loadControllers(refresh?: boolean | undefined): Promise<void> {
        if (!this.controllersPromise || refresh) {
            const stopWatch = new StopWatch();
            // Cancel previous load
            if (this.loadCancellationToken) {
                this.loadCancellationToken.cancel();
            }
            this.loadCancellationToken = new vscode.CancellationTokenSource();
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
                    ).ignoreErrors();

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

    private async loadControllersImpl(cancelToken: vscode.CancellationToken) {
        // First off set our context to false as we are about to refresh
        await this.controllersLoadedContext.set(false);

        let connections = await this.kernelFinder.listKernels(undefined, cancelToken);

        if (cancelToken.isCancellationRequested) {
            return;
        }

        traceVerbose(`Found ${connections.length} cached controllers`);
        this.createNotebookControllers(connections);

        // Look for any controllers that we have disposed (no longer found when fetching)
        const disposedControllers = Array.from(this.registration.registered).filter((controller) => {
            const connectionIsNoLongerValid = !connections.some((connection) => {
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
            traceInfoIfCI(
                `Disposing controller ${controller.id}, associated with connection ${controller.connection.id}`
            );
            controller.dispose(); // This should remove it from the registered list
        });

        // Indicate a refresh
        this.refreshedEmitter.fire();

        // Set that we have loaded controllers
        await this.controllersLoadedContext.set(true);
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
