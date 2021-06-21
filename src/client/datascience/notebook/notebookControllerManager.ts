// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { CancellationToken, ExtensionMode, NotebookControllerAffinity, Uri } from 'vscode';
import { CancellationTokenSource, EventEmitter, NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../activation/types';
import { ICommandManager, IVSCodeNotebook, IWorkspaceService } from '../../common/application/types';
import { JVSC_EXTENSION_ID, PYTHON_LANGUAGE } from '../../common/constants';
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
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../telemetry/telemetry';
import { INotebookProvider } from '../types';
import { getNotebookMetadata, isJupyterNotebook, updateNotebookDocumentMetadata } from './helpers/helpers';
import { VSCodeNotebookController } from './vscodeNotebookController';
import { INotebookControllerManager } from './types';
import { JupyterNotebookView } from './constants';
import { NotebookIPyWidgetCoordinator } from '../ipywidgets/notebookIPyWidgetCoordinator';
import { IPyWidgetMessages } from '../interactive-common/interactiveWindowTypes';
import { InterpreterPackages } from '../telemetry/interpreterPackages';
import { sendTelemetryEvent } from '../../telemetry';
import { NotebookCellLanguageService } from './cellLanguageService';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { testOnlyMethod } from '../../common/utils/decorators';
import { IS_CI_SERVER } from '../../../test/ciConstants';
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
    private controllersPromise?: Promise<void>;

    // Listing of the controllers that we have registered
    private registeredControllers: VSCodeNotebookController[] = [];

    private cancelToken: CancellationTokenSource | undefined;
    private readonly isLocalLaunch: boolean;
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
        @inject(InterpreterPackages) private readonly interpreterPackages: InterpreterPackages,
        @inject(NotebookCellLanguageService) private readonly languageService: NotebookCellLanguageService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {
        this._onNotebookControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: VSCodeNotebookController;
        }>();
        this.disposables.push(this._onNotebookControllerSelected);
        this.isLocalLaunch = isLocalLaunch(this.configuration);
    }

    get onNotebookControllerSelected() {
        return this._onNotebookControllerSelected.event;
    }

    public activate() {
        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        this.notebook.onDidCloseNotebookDocument(this.onDidCloseNotebookDocument, this, this.disposables);

        // Be aware of if we need to re-look for kernels on extension change
        this.extensions.onDidChange(this.onDidChangeExtensions, this, this.disposables);
    }

    // Look up what NotebookController is currently selected for the given notebook document
    public getSelectedNotebookController(document: NotebookDocument): VSCodeNotebookController | undefined {
        return this.controllerMapping.get(document);
    }

    // Function to expose currently registered controllers to test code only
    @testOnlyMethod()
    public registeredNotebookControllers(): VSCodeNotebookController[] {
        return this.registeredControllers;
    }

    // Find all the notebook controllers that we have registered
    private async loadNotebookControllers(): Promise<void> {
        if (!this.controllersPromise) {
            this.controllersPromise = this.loadNotebookControllersImpl()
                .then((controllers) => {
                    // Just assign here as this is our initial set of controllers
                    // anything that adds or updates should make sure the initial load has happened first
                    this.registeredControllers = controllers;
                })
                .catch((error) => {
                    traceError('Error loading notebook controllers', error);
                    throw error;
                });
        }
        return this.controllersPromise;
    }

    // Turn all our kernelConnections that we know about into registered NotebookControllers
    private async loadNotebookControllersImpl(): Promise<VSCodeNotebookController[]> {
        const stopWatch = new StopWatch();

        try {
            this.cancelToken = new CancellationTokenSource();

            const connections = await this.getKernelConnectionMetadata(this.cancelToken.token);

            if (this.cancelToken.token.isCancellationRequested) {
                // Bail out on making the controllers if we are cancelling
                traceInfo('Cancelled loading notebook controllers');
                return [];
            }

            // Now create the actual controllers from our connections
            const controllers = await this.createNotebookControllers(connections);

            // Send telemetry related to fetching the kernel connections
            sendKernelListTelemetry(
                Uri.file('test.ipynb'), // Give a dummy ipynb value, we need this as its used in telemetry to determine the resource.
                controllers.map((item) => item.connection),
                stopWatch
            );

            traceInfoIf(
                !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                `Providing notebook controllers with length ${controllers.length}.`
            );

            return controllers;
        } finally {
            this.cancelToken = undefined;
        }
    }

    private onDidChangeExtensions() {
        // KERNELPUSH: On extension load we might fetch different kernels, need to invalidate here and regen
    }

    // When a document is opened we need to look for a perferred kernel for it
    private async onDidOpenNotebookDocument(document: NotebookDocument) {
        // Restrict to only our notebook documents
        if (document.notebookType !== JupyterNotebookView || !this.workspace.isTrusted) {
            return;
        }

        // Keep track of a token per document so that we can cancel the search if the doc is closed
        const preferredSearchToken = new CancellationTokenSource();
        this.findPreferredInProgress.set(document, preferredSearchToken);

        // Prep so that we can track the selected controller for this document
        traceInfoIf(IS_CI_SERVER, `Clear controller mapping for ${document.uri.toString()}`);
        this.controllerMapping.delete(document);

        try {
            if (!this.isLocalLaunch) {
                // For a remote connection check for new live kernel models before we find preferred
                await this.updateRemoteConnections(preferredSearchToken.token);
            }

            await this.findPreferredKernel(document, preferredSearchToken.token)
                .then(async (preferredConnection) => {
                    if (preferredSearchToken.token.isCancellationRequested) {
                        traceInfo('Find preferred kernel cancelled');
                        return;
                    }

                    // If we found a preferred kernel, set the association on the NotebookController
                    if (preferredConnection) {
                        traceInfo(
                            `PreferredConnection: ${
                                preferredConnection.id
                            } found for NotebookDocument: ${document.uri.toString()}`
                        );
                        this.setPreferredController(document, preferredConnection).catch(traceError);
                    } else {
                        traceInfoIf(
                            IS_CI_SERVER,
                            `PreferredConnection not found for NotebookDocument: ${document.uri.toString()}`
                        );
                    }
                })
                .catch((error) => traceError(error));
        } finally {
            // Make sure that we clear our finding in progress when done
            this.findPreferredInProgress.delete(document);
        }
    }

    // For the given document, find the notebook controller that matches this kernel connection and associate the two
    private async setPreferredController(document: NotebookDocument, kernelConnection: KernelConnectionMetadata) {
        // Wait for our controllers to be loaded before we try to set a preferred on
        // can happen if a document is opened quick and we have not yet loaded our controllers
        await this.loadNotebookControllers();

        const targetController = this.registeredControllers.find((value) => {
            // Check for a connection match
            return areKernelConnectionsEqual(kernelConnection, value.connection);
        });

        if (targetController) {
            traceInfo(`TargetController found ID: ${targetController.id} for document ${document.uri.toString()}`);
            await targetController.updateNotebookAffinity(document, NotebookControllerAffinity.Preferred);
        } else {
            traceInfoIf(
                IS_CI_SERVER,
                `TargetController nof found ID: ${kernelConnection.id} for document ${document.uri.toString()}`
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
            traceInfoIf(IS_CI_SERVER, `Notebook closed event handled widget coordinator ${document.uri.toString()}`);
            this.findPreferredInProgress.get(document)?.cancel();
        }

        // Remove from our current selection tracking list
        this.controllerMapping.delete(document);
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
                this.disposables,
                this.languageService,
                this.workspace,
                this.setAsActiveControllerForTests.bind(this)
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
            traceError(`Failed to create notebook controller for ${kernelConnection.id}`, ex);
        }
    }
    /**
     * In our tests, preferred controllers are setup as the active controller.
     *
     * This method is called on when running tests, else in the real world,
     * users need to select a kernel (preferred is on top of the list).
     */
    private async setAsActiveControllerForTests(controller: VSCodeNotebookController, notebook: NotebookDocument) {
        // Only when running tests should we force the selection of the kernel.
        // Else the general VS Code behavior is for the user to select a kernel (here we make it look as though use selected it).
        if (this.context.extensionMode !== ExtensionMode.Test) {
            return;
        }
        traceInfoIf(
            IS_CI_SERVER,
            `Command notebook.selectKernel executing for ${notebook.uri.toString()} ${controller.id}`
        );
        await this.commandManager.executeCommand('notebook.selectKernel', {
            id: controller.id,
            extension: JVSC_EXTENSION_ID
        });
        traceInfoIf(
            IS_CI_SERVER,
            `Command notebook.selectKernel exected for ${notebook.uri.toString()} ${controller.id}`
        );
        // Used in tests to determine when the controller has been associated with a document.
        VSCodeNotebookController.kernelAssociatedWithDocument = true;

        // Sometimes the selection doesn't work (after all this is a hack).
        if (!this.controllerMapping.get(notebook)) {
            await this.handleOnNotebookControllerSelected({ notebook, controller });
        }
    }
    // A new NotebookController has been selected, find the associated notebook document and update it
    private async handleOnNotebookControllerSelected(event: {
        notebook: NotebookDocument;
        controller: VSCodeNotebookController;
    }) {
        if (this.controllerMapping.get(event.notebook) === event.controller) {
            // Possible it gets called again in our tests (due to hacks for testing purposes).
            return;
        }
        traceInfoIf(IS_CI_SERVER, `Notebook Controller set ${event.notebook.uri.toString()}, ${event.controller.id}`);
        this.widgetCoordinator.setActiveController(event.notebook, event.controller);
        this.controllerMapping.set(event.notebook, event.controller);

        // Now actually handle the change
        await this.notebookKernelChanged(event.notebook, event.controller);

        // Now notify out that we have updated a notebooks controller
        this._onNotebookControllerSelected.fire(event);
    }

    private async getKernelConnectionMetadata(token: CancellationToken): Promise<KernelConnectionMetadata[]> {
        let kernels: KernelConnectionMetadata[] = [];

        // Instead of a specific resource, we can just search on undefined for the workspace
        const resource: Resource = undefined;

        if (this.isLocalLaunch) {
            kernels = await this.localKernelFinder.listKernels(resource, token);
        } else {
            const connection = await this.notebookProvider.connect({
                getOnly: false,
                resource: resource,
                disableUI: false,
                localOnly: false
            });

            kernels = await this.remoteKernelFinder.listKernels(resource, connection, token);
        }

        return kernels;
    }

    // Update any new or removed kernel connections, LiveKernelModels might be added or removed
    // during remote connections
    private async updateRemoteConnections(cancelToken: CancellationToken) {
        // Don't update until initial load is done
        await this.loadNotebookControllers();

        // We've connected and done the intial fetch, so this is speedy
        const connections = await this.getKernelConnectionMetadata(cancelToken);

        if (cancelToken.isCancellationRequested) {
            // Bail out on making the controllers if we are cancelling
            traceInfo('Cancelled loading notebook controllers');
            return [];
        }

        // Look for any connections that are not registered already as controllers
        const missingConnections = connections.filter((connection) => {
            return !this.registeredControllers.some((controller) => {
                return controller.id === connection.id;
            });
        });

        // Look for any controllers that we have disposed
        const disposedControllers = this.registeredControllers.filter((controller) => {
            return !connections.some((connection) => {
                return connection.id === controller.id;
            });
        });

        // If we have any new connections, register them
        if (missingConnections.length > 0) {
            const connectionsWithLabel = missingConnections.map((value) => {
                return { connection: value, label: getDisplayNameOrNameOfKernelConnection(value) };
            });

            connectionsWithLabel.forEach((value) => {
                const controller = this.createNotebookController(value.connection, value.label);
                if (controller) {
                    this.registeredControllers.push(controller);
                }
            });
        }

        // If we have any out of date connections, dispose of them
        disposedControllers.forEach((controller) => {
            this.registeredControllers = this.registeredControllers.filter((regController) => {
                return regController.id !== controller.id;
            });
            traceInfoIf(IS_CI_SERVER, `Disposing controller ${controller.id}`);
            controller.dispose();
        });
    }

    private async notebookKernelChanged(document: NotebookDocument, controller: VSCodeNotebookController) {
        // We're only interested in our Jupyter Notebooks.
        if (!isJupyterNotebook(document)) {
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

        // Before we start the notebook, make sure the metadata is set to this new kernel.
        await updateNotebookDocumentMetadata(document, selectedKernelConnectionMetadata);

        // Make this the new kernel (calling this method will associate the new kernel with this Uri).
        // Calling `getOrCreate` will ensure a kernel is created and it is mapped to the Uri provided.
        // This will dispose any existing (older kernels) associated with this notebook.
        // This way other parts of extension have access to this kernel immediately after event is handled.
        // Unlike webview notebooks we cannot revert to old kernel if kernel switching fails.
        const newKernel = this.kernelProvider.getOrCreate(document.uri, {
            metadata: selectedKernelConnectionMetadata,
            controller: controller.controller
        });
        traceInfo(`KernelProvider switched kernel to id = ${newKernel?.kernelConnectionMetadata.id}`);

        // Auto start the local kernels.
        // if (newKernel && !this.configuration.getSettings(undefined).disableJupyterAutoStart && this.isLocalLaunch) {
        //     await newKernel.start({ disableUI: true, document }).catch(noop);
        // }
    }
}
