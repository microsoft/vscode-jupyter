// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookControllerAffinity } from 'vscode';
import { CancellationTokenSource, EventEmitter, NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../activation/types';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceError, traceInfo, traceInfoIf } from '../../common/logger';
import {
    IConfigurationService,
    IDisposableRegistry,
    IExtensionContext,
    IExtensions,
    IPathUtils,
    Resource
} from '../../common/types';
import { StopWatch } from '../../common/utils/stopWatch';
import { sendNotebookOrKernelLanguageTelemetry } from '../common';
import { Telemetry } from '../constants';
import {
    areKernelConnectionsEqual,
    getDisplayNameOrNameOfKernelConnection,
    isLocalLaunch
} from '../jupyter/kernels/helpers';
import { IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';
import { INotebookStorageProvider } from '../notebookStorage/notebookStorageProvider';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { sendNotebookControllerCreateTelemetry } from '../telemetry/kernelTelemetry';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../telemetry/telemetry';
import { INotebookProvider } from '../types';
import { getNotebookMetadata, isJupyterNotebook, trackKernelInNotebookMetadata } from './helpers/helpers';
import { VSCodeNotebookController } from './vscodeNotebookController';
import { INotebookControllerManager } from './types';
import { JupyterNotebookView } from './constants';
import { NotebookIPyWidgetCoordinator } from '../ipywidgets/notebookIPyWidgetCoordinator';
import { IPyWidgetMessages } from '../interactive-common/interactiveWindowTypes';
import { InterpreterPackages } from '../telemetry/interpreterPackages';
import { sendTelemetryEvent } from '../../telemetry';
import { createDeferred, Deferred } from '../../common/utils/async';
import { IS_REMOTE_NATIVE_TEST } from '../../../test/constants';
/**
 * This class tracks notebook documents that are open and the provides NotebookControllers for
 * each of them
 */
@injectable()
export class NotebookControllerManager implements INotebookControllerManager, IExtensionSyncActivationService {
    // Keep tabs on which controller is selected relative to each notebook document
    private controllerMapping = new WeakMap<NotebookDocument, VSCodeNotebookController | undefined>();

    // When opening a document, track our find preferred search so that we can cancel if needed
    private findPreferredInProgress = new WeakMap<NotebookDocument, CancellationTokenSource>();

    private readonly _onNotebookControllerSelected: EventEmitter<{
        notebook: NotebookDocument;
        controller: VSCodeNotebookController;
    }>;

    // Promise to resolve when we have loaded our controllers
    private controllersPromise: Promise<VSCodeNotebookController[]> | undefined;

    private isLocalLaunch: boolean;
    private cancelToken: CancellationTokenSource | undefined;
    private _allowRemoteConnection = createDeferred<void>();
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        @inject(IRemoteKernelFinder) private readonly remoteKernelFinder: IRemoteKernelFinder,
        @inject(INotebookStorageProvider) private readonly storageProvider: INotebookStorageProvider,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils,
        @inject(NotebookIPyWidgetCoordinator) private readonly widgetCoordinator: NotebookIPyWidgetCoordinator,
        @inject(InterpreterPackages) private readonly interpreterPackages: InterpreterPackages
    ) {
        this._onNotebookControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: VSCodeNotebookController;
        }>();
        this.disposables.push(this._onNotebookControllerSelected);
        this.isLocalLaunch = isLocalLaunch(this.configuration);

        // For remote tests, we need to wait until we start jupyter and assign the server URI
        // so we wait on this connection, for non remote tests just run
        if (!IS_REMOTE_NATIVE_TEST) {
            this._allowRemoteConnection.resolve();
        }
    }

    get onNotebookControllerSelected() {
        return this._onNotebookControllerSelected.event;
    }

    get allowRemoteConnection(): Deferred<void> {
        return this._allowRemoteConnection;
    }

    public activate() {
        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        this.notebook.onDidCloseNotebookDocument(this.onDidCloseNotebookDocument, this, this.disposables);

        // Be aware of if we need to re-look for kernels on extension change
        this.extensions.onDidChange(this.onDidChangeExtensions, this, this.disposables);

        this.controllersPromise = this.loadNotebookControllers().catch((error) => {
            traceError('Error loading notebook controllers', error);
            throw error;
        });
    }

    // Look up what NotebookController is currently selected for the given notebook document
    public getSelectedNotebookController(document: NotebookDocument): VSCodeNotebookController | undefined {
        if (this.controllerMapping.has(document)) {
            return this.controllerMapping.get(document);
        }
    }

    // Find all the notebook controllers that we have registered
    public async getNotebookControllers(): Promise<VSCodeNotebookController[] | undefined> {
        return this.controllersPromise;
    }

    // Turn all our kernelConnections that we know about into registered NotebookControllers
    private async loadNotebookControllers(): Promise<VSCodeNotebookController[]> {
        const stopWatch = new StopWatch();

        traceInfo('IANHU start loadNotebookControllers');

        try {
            this.cancelToken = new CancellationTokenSource();

            const connections = await this.getKernelConnectionMetadata(this.cancelToken.token);

            traceInfo(`IANHU connections found ${connections.length}`);

            if (this.cancelToken.token.isCancellationRequested) {
                // Bail out on making the controllers if we are cancelling
                traceInfo('Cancelled loading notebook controllers');
                return [];
            }

            // Now create the actual controllers from our connections
            const controllers = await this.createNotebookControllers(connections);

            // Send telemetry related to fetching the kernel connections
            // KERNELPUSH: undefined works for telemetry?
            sendNotebookControllerCreateTelemetry(undefined, controllers, stopWatch);

            traceInfoIf(
                !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                `Providing notebook controllers with length ${controllers.length}.`
            );

            controllers.forEach((value) => {
                traceInfo(`IANHU Controller label ${value.label}`);
                traceInfo(`IANHU Controller id ${value.id}`);
                traceInfo(`IANHU Connection kind ${value.connection.kind}`);
                traceInfo(`IANHU Connection id ${value.connection.id}`);
            });

            return controllers;
        } finally {
            this.cancelToken = undefined;
        }
    }

    private onDidChangeExtensions() {
        // KERNELPUSH: On extension load we might fetch different kernels, need to invalidate here and regen
    }

    // When a document is opened we need to look for a perferred kernel for it
    private onDidOpenNotebookDocument(document: NotebookDocument) {
        // Restrict to only our notebook documents
        if (document.viewType !== JupyterNotebookView) {
            return;
        }

        // Prep so that we can track the selected controller for this document
        this.controllerMapping.set(document, undefined);

        // Keep track of a token per document so that we can cancel the search if the doc is closed
        const preferredSearchToken = new CancellationTokenSource();
        this.findPreferredInProgress.set(document, preferredSearchToken);

        traceInfo('IANHU starting preferred search');

        this.findPreferredKernel(document, preferredSearchToken.token)
            .then((preferredConnection) => {
                if (preferredSearchToken.token.isCancellationRequested) {
                    traceInfo('Find preferred kernel cancelled');
                    return;
                }

                // If we found a preferred kernel, set the association on the NotebookController
                if (preferredConnection) {
                    traceInfo(
                        `IANHU PreferredConnection: ${
                            preferredConnection.id
                        } found for NotebookDocument: ${document.uri.toString()}`
                    );
                    this.setPreferredController(document, preferredConnection).catch(traceError);
                }
            })
            .finally(() => {
                // Make sure that we clear our finding in progress when done
                this.findPreferredInProgress.delete(document);
            });
    }

    // For the given document, find the notebook controller that matches this kernel connection and associate the two
    private async setPreferredController(document: NotebookDocument, kernelConnection: KernelConnectionMetadata) {
        if (!this.controllersPromise) {
            // Should not happen as this promise is assigned in activate
            return;
        }

        traceInfo('IANHU start setPreferredController');

        // Wait for our controllers to be loaded before we try to set a preferred on
        // can happen if a document is opened quick and we have not yet loaded our controllers
        const controllers = await this.controllersPromise;

        const targetController = controllers.find((value) => {
            // Check for a connection match
            return areKernelConnectionsEqual(kernelConnection, value.connection);
        });

        if (targetController) {
            traceInfo(
                `IANHU TargetController found ID: ${targetController.id} for document ${document.uri.toString()}`
            );
            await targetController.updateNotebookAffinity(document, NotebookControllerAffinity.Preferred);

            // When we set the target controller we don't actually get a selected event from our controllers
            // to get around that when we see affinity here 'force' an event as if a user selected it
            this.handleOnNotebookControllerSelected({ notebook: document, controller: targetController }).catch(
                traceError
            );
        }
    }

    private async findPreferredKernel(
        document: NotebookDocument,
        token: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined> {
        let preferred: KernelConnectionMetadata | undefined;

        if (this.isLocalLaunch) {
            const preferredConnectionPromise = preferred
                ? Promise.resolve(preferred)
                : this.localKernelFinder.findKernel(document.uri, getNotebookMetadata(document), token);
            preferred = await preferredConnectionPromise;
        } else {
            const connection = await this.notebookProvider.connect({
                getOnly: false,
                resource: document.uri,
                disableUI: false,
                localOnly: false
            });

            const preferredConnectionPromise = preferred
                ? Promise.resolve(preferred)
                : this.remoteKernelFinder.findKernel(document.uri, connection, getNotebookMetadata(document), token);
            preferred = await preferredConnectionPromise;
        }

        return preferred;
    }

    private onDidCloseNotebookDocument(document: NotebookDocument) {
        // When we close a document, cancel any preferred searches in progress
        if (this.findPreferredInProgress.has(document)) {
            this.findPreferredInProgress.get(document)?.cancel();
        }

        // Remove from our current selection tracking list
        if (this.controllerMapping.has(document)) {
            this.controllerMapping.delete(document);
        }
    }

    private createNotebookControllers(kernelConnections: KernelConnectionMetadata[]): VSCodeNotebookController[] {
        // First sort our items by label
        const connectionsWithLabel = kernelConnections.map((value) => {
            return { connection: value, label: getDisplayNameOrNameOfKernelConnection(value) };
        });
        connectionsWithLabel.sort((a, b) => {
            if (a.label > b.label) {
                return 1;
            } else if (a.label === b.label) {
                return 0;
            } else {
                return -1;
            }
        });

        // Map KernelConnectionMetadata => NotebookController
        const controllers: VSCodeNotebookController[] = [];
        connectionsWithLabel.forEach((value) => {
            const controller = this.createNotebookController(value.connection, value.label);
            if (controller) {
                controllers.push(controller);
            }
        });

        return controllers;
    }

    private createNotebookController(
        kernelConnection: KernelConnectionMetadata,
        label: string
    ): VSCodeNotebookController | undefined {
        try {
            // Create notebook selector
            const controller = new VSCodeNotebookController(
                kernelConnection,
                label,
                this.notebook,
                this.commandManager,
                this.kernelProvider,
                this.preferredRemoteKernelIdProvider,
                this.context,
                this,
                this.pathUtils,
                this.disposables
            );

            // Hook up to if this NotebookController is selected or de-selected
            controller.onNotebookControllerSelected(this.handleOnNotebookControllerSelected, this, this.disposables);

            // We are disposing as documents are closed, but do this as well
            this.disposables.push(controller);

            return controller;
        } catch (ex) {
            // We know that this fails when we have xeus kernels installed (untill that's resolved thats one instance when we can have duplicates).
            sendTelemetryEvent(
                Telemetry.FailedToCreateNotebookController,
                undefined,
                { kind: kernelConnection.kind },
                ex,
                true
            );
            traceError(`Failed to create notebbook controller for ${kernelConnection.id}`, ex);
        }
    }

    // A new NotebookController has been selected, find the associated notebook document and update it
    private async handleOnNotebookControllerSelected(event: {
        notebook: NotebookDocument;
        controller: VSCodeNotebookController;
    }) {
        this.widgetCoordinator.setActiveController(event.notebook, event.controller);
        if (this.controllerMapping.has(event.notebook)) {
            this.controllerMapping.set(event.notebook, event.controller);

            // Now actually handle the change
            await this.notebookKernelChanged(event.notebook, event.controller);

            // Now notify out that we have updated a notebooks controller
            this._onNotebookControllerSelected.fire(event);
        }
    }

    private async getKernelConnectionMetadata(token: CancellationToken): Promise<KernelConnectionMetadata[]> {
        let kernels: KernelConnectionMetadata[] = [];

        // Instead of a specific resource, we can just search on undefined for the workspace
        const resource: Resource = undefined;

        if (this.isLocalLaunch) {
            kernels = await this.localKernelFinder.listKernels(resource, token);

            // We need to filter out those items that are for other extensions.
            kernels = kernels.filter((r) => {
                if (r.kind !== 'connectToLiveKernel' && r.kernelSpec) {
                    if (
                        r.kernelSpec.metadata?.vscode?.extension_id &&
                        this.extensions.getExtension(r.kernelSpec.metadata?.vscode?.extension_id)
                    ) {
                        return false;
                    }
                }
                return true;
            });
        } else {
            // In remote CI test we need to wait until we start up our server and input our URI before we
            // try to connect to the server to get kernel connection info
            await this.allowRemoteConnection.promise;

            traceInfo('IANHU about to connect notebook provider');
            const connection = await this.notebookProvider.connect({
                getOnly: false,
                resource: resource,
                disableUI: false,
                localOnly: false
            });

            traceInfo('IANHU notebook provider connected');

            kernels = await this.remoteKernelFinder.listKernels(resource, connection, token);
        }

        return kernels;
    }

    private async notebookKernelChanged(document: NotebookDocument, controller: VSCodeNotebookController) {
        // We're only interested in our Jupyter Notebooks.
        if (!isJupyterNotebook(document)) {
            trackKernelInNotebookMetadata(document, undefined);
            return;
        }
        const selectedKernelConnectionMetadata = controller.connection;

        const model = this.storageProvider.get(document.uri);
        if (model && model.isTrusted === false) {
            // eslint-disable-next-line
            // TODO: https://github.com/microsoft/vscode-python/issues/13476
            // If a model is not trusted, we cannot change the kernel (this results in changes to notebook metadata).
            // This is because we store selected kernel in the notebook metadata.
            traceInfoIf(!!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT, 'Kernel not switched, model not trusted');
            return;
        }

        const existingKernel = this.kernelProvider.get(document.uri);
        if (
            existingKernel &&
            areKernelConnectionsEqual(existingKernel.kernelConnectionMetadata, selectedKernelConnectionMetadata)
        ) {
            traceInfo('Switch kernel did not change kernel.');
            return;
        }
        switch (controller.connection.kind) {
            case 'startUsingPythonInterpreter':
                sendNotebookOrKernelLanguageTelemetry(Telemetry.SwitchToExistingKernel, PYTHON_LANGUAGE);
                break;
            case 'connectToLiveKernel':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    controller.connection.kernelModel.language
                );
                break;
            case 'startUsingKernelSpec':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    controller.connection.kernelSpec.language
                );
                break;
            default:
            // We don't know as its the default kernel on Jupyter server.
        }
        trackKernelResourceInformation(document.uri, { kernelConnection: controller.connection });
        sendKernelTelemetryEvent(document.uri, Telemetry.SwitchKernel);
        // If we have an existing kernel, then we know for a fact the user is changing the kernel.
        // Else VSC is just setting a kernel for a notebook after it has opened.
        if (existingKernel) {
            const telemetryEvent = this.isLocalLaunch
                ? Telemetry.SelectLocalJupyterKernel
                : Telemetry.SelectRemoteJupyterKernel;
            sendKernelTelemetryEvent(document.uri, telemetryEvent);
            this.notebook.notebookEditors
                .filter((editor) => editor.document === document)
                .forEach((editor) =>
                    controller.postMessage(
                        { message: IPyWidgetMessages.IPyWidgets_onKernelChanged, payload: undefined },
                        editor
                    )
                );
        }
        if (selectedKernelConnectionMetadata.interpreter) {
            this.interpreterPackages.trackPackages(selectedKernelConnectionMetadata.interpreter);
        }

        trackKernelInNotebookMetadata(document, selectedKernelConnectionMetadata);

        // Make this the new kernel (calling this method will associate the new kernel with this Uri).
        // Calling `getOrCreate` will ensure a kernel is created and it is mapped to the Uri provided.
        // This will dispose any existing (older kernels) associated with this notebook.
        // This way other parts of extension have access to this kernel immediately after event is handled.
        // Unlike webview notebooks we cannot revert to old kernel if kernel switching fails.
        const newKernel = this.kernelProvider.getOrCreate(document.uri, {
            metadata: selectedKernelConnectionMetadata,
            controller: controller.controller
        });
        traceInfo(`KernelProvider switched kernel to id = ${newKernel?.kernelConnectionMetadata.id}}`);

        // Before we start the notebook, make sure the metadata is set to this new kernel.
        trackKernelInNotebookMetadata(document, selectedKernelConnectionMetadata);

        // Auto start the local kernels.
        // if (newKernel && !this.configuration.getSettings(undefined).disableJupyterAutoStart && this.isLocalLaunch) {
        //     await newKernel.start({ disableUI: true, document }).catch(noop);
        // }
    }
}
