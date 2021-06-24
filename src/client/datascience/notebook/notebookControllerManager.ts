// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookControllerAffinity, Uri } from 'vscode';
import { CancellationTokenSource, EventEmitter, NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../activation/types';
import { ICommandManager, IVSCodeNotebook, IWorkspaceService } from '../../common/application/types';
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
import { Telemetry } from '../constants';
import {
    areKernelConnectionsEqual,
    getDisplayNameOrNameOfKernelConnection,
    isLocalLaunch
} from '../jupyter/kernels/helpers';
import { IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { INotebookProvider } from '../types';
import { getNotebookMetadata } from './helpers/helpers';
import { VSCodeNotebookController } from './vscodeNotebookController';
import { INotebookControllerManager } from './types';
import { InteractiveWindowView, JupyterNotebookView } from './constants';
import { NotebookIPyWidgetCoordinator } from '../ipywidgets/notebookIPyWidgetCoordinator';
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

        // Be aware of if we need to re-look for kernels on extension change
        this.extensions.onDidChange(this.onDidChangeExtensions, this, this.disposables);
    }

    // Function to expose currently registered controllers to test code only
    @testOnlyMethod()
    public registeredNotebookControllers(): VSCodeNotebookController[] {
        return this.registeredControllers;
    }

    // Find all the notebook controllers that we have registered
    public async loadNotebookControllers(): Promise<void> {
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
            const controllers = this.createNotebookControllers(connections);

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
        if (
            (document.notebookType !== JupyterNotebookView && document.notebookType !== InteractiveWindowView) ||
            !this.workspace.isTrusted
        ) {
            return;
        }

        // Keep track of a token per document so that we can cancel the search if the doc is closed
        const preferredSearchToken = new CancellationTokenSource();
        const disposable = this.notebook.onDidCloseNotebookDocument(
            (e) => (e === document ? preferredSearchToken.cancel() : undefined),
            this,
            this.disposables
        );

        // Prep so that we can track the selected controller for this document
        traceInfoIf(IS_CI_SERVER, `Clear controller mapping for ${document.uri.toString()}`);
        const loadControllersPromise = this.loadNotebookControllers();

        try {
            let preferredConnection: KernelConnectionMetadata | undefined;
            if (this.isLocalLaunch) {
                preferredConnection = await this.localKernelFinder.findKernel(
                    document.uri,
                    getNotebookMetadata(document),
                    preferredSearchToken.token
                );
            } else {
                // For a remote connection check for new live kernel models before we find preferred
                await this.updateRemoteConnections(preferredSearchToken.token);
                const connection = await this.notebookProvider.connect({
                    getOnly: false,
                    resource: document.uri,
                    disableUI: false,
                    localOnly: false
                });
                preferredConnection = await this.remoteKernelFinder.findKernel(
                    document.uri,
                    connection,
                    getNotebookMetadata(document),
                    preferredSearchToken.token
                );
            }

            // If we found a preferred kernel, set the association on the NotebookController
            if (preferredSearchToken.token.isCancellationRequested) {
                traceInfo('Find preferred kernel cancelled');
                return;
            }
            if (!preferredConnection) {
                traceInfoIf(
                    IS_CI_SERVER,
                    `PreferredConnection not found for NotebookDocument: ${document.uri.toString()}`
                );
                return;
            }

            traceInfo(
                `PreferredConnection: ${preferredConnection.id} found for NotebookDocument: ${document.uri.toString()}`
            );
            // Wait for our controllers to be loaded before we try to set a preferred on
            // can happen if a document is opened quick and we have not yet loaded our controllers
            await loadControllersPromise;
            const targetController = this.registeredControllers.find((value) =>
                areKernelConnectionsEqual(preferredConnection, value.connection)
            );

            if (targetController) {
                traceInfo(`TargetController found ID: ${targetController.id} for document ${document.uri.toString()}`);
                await targetController.updateNotebookAffinity(document, NotebookControllerAffinity.Preferred);
            } else {
                traceInfoIf(
                    IS_CI_SERVER,
                    `TargetController nof found ID: ${preferredConnection.id} for document ${document.uri.toString()}`
                );
            }
        } catch (ex) {
            traceError('Failed to find & set preferred controllers', ex);
        } finally {
            disposable.dispose();
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
        const allControllers: VSCodeNotebookController[] = [];
        connectionsWithLabel.forEach((value) => {
            const controllers = this.createNotebookController(value.connection, value.label);
            if (controllers) {
                allControllers.push(...controllers);
            }
        });

        return allControllers;
    }
    private createNotebookController(
        kernelConnection: KernelConnectionMetadata,
        label: string
    ): VSCodeNotebookController[] | undefined {
        try {
            // Create notebook selector
            return [
                [kernelConnection.id, JupyterNotebookView],
                [`${kernelConnection.id} (Interactive)`, InteractiveWindowView]
            ].map(([id, viewType]) => {
                const controller = new VSCodeNotebookController(
                    kernelConnection,
                    id,
                    viewType,
                    label,
                    this.notebook,
                    this.commandManager,
                    this.kernelProvider,
                    this.preferredRemoteKernelIdProvider,
                    this.context,
                    this.pathUtils,
                    this.disposables,
                    this.languageService,
                    this.workspace,
                    this.isLocalLaunch ? 'local' : 'remote',
                    this.interpreterPackages,
                    this.configuration,
                    this.widgetCoordinator
                );
                // Hook up to if this NotebookController is selected or de-selected
                controller.onNotebookControllerSelected(
                    this.handleOnNotebookControllerSelected,
                    this,
                    this.disposables
                );

                // We are disposing as documents are closed, but do this as well
                this.disposables.push(controller);

                return controller;
            });
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
    // A new NotebookController has been selected, find the associated notebook document and update it
    private async handleOnNotebookControllerSelected(event: {
        notebook: NotebookDocument;
        controller: VSCodeNotebookController;
    }) {
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
                const controllers = this.createNotebookController(value.connection, value.label);
                if (controllers) {
                    this.registeredControllers.push(...controllers);
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
}
