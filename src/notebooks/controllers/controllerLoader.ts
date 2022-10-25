// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { isPythonNotebook } from '../../kernels/helpers';
import { IKernelFinder, KernelConnectionMetadata } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { isCancellationError } from '../../platform/common/cancellation';
import { InteractiveWindowView, JupyterNotebookView } from '../../platform/common/constants';
import { IDisposableRegistry } from '../../platform/common/types';
import { getNotebookMetadata } from '../../platform/common/utils';
import { noop } from '../../platform/common/utils/misc';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { traceInfoIfCI, traceVerbose } from '../../platform/logging';
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
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IControllerRegistration) private readonly registration: IControllerRegistration
    ) {}

    public activate(): void {
        // Make sure to reload whenever we do something that changes state
        this.kernelFinder.onDidChangeKernels(() => this.loadControllers(), this, this.disposables);

        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        // If the extension activates after installing Jupyter extension, then ensure we load controllers right now.
        this.notebook.notebookDocuments.forEach((notebook) => this.onDidOpenNotebookDocument(notebook).catch(noop));
        this.registration.onCreated(() => this.refreshedEmitter.fire(), this, this.disposables);

        this.loadControllers();
    }
    private loadControllers() {
        this.loadControllersImpl();
        sendKernelListTelemetry(this.registration.registered.map((v) => v.connection));

        traceInfoIfCI(`Providing notebook controllers with length ${this.registration.registered.length}.`);
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

    private loadControllersImpl() {
        const connections = this.kernelFinder.kernels;
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
            controller.dispose(); // This should remove it from the registered list
        });

        // Set that we have loaded controllers
        this.controllersPromise = this.controllersPromise || Promise.resolve();
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
            this.registration.batchAdd(kernelConnections, viewTypes);
        } catch (ex) {
            if (!isCancellationError(ex, true)) {
                // This can happen in the tests, and these get bubbled upto VSC and are logged as unhandled exceptions.
                // Hence swallow cancellation errors.
                throw ex;
            }
        }
    }
}
