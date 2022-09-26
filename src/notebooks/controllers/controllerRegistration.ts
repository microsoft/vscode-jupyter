// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import { ConfigurationChangeEvent, Event, EventEmitter } from 'vscode';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { computeServerId } from '../../kernels/jupyter/jupyterUtils';
import { IJupyterServerUriEntry, IJupyterServerUriStorage, IServerConnectionType } from '../../kernels/jupyter/types';
import {
    IKernel,
    IKernelProvider,
    isLocalConnection,
    isRemoteConnection,
    KernelAction,
    KernelActionSource,
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata
} from '../../kernels/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import {
    IVSCodeNotebook,
    ICommandManager,
    IWorkspaceService,
    IDocumentManager,
    IApplicationShell,
    IApplicationEnvironment
} from '../../platform/common/application/types';
import { isCancellationError } from '../../platform/common/cancellation';
import { JupyterNotebookView, InteractiveWindowView, JVSC_EXTENSION_ID } from '../../platform/common/constants';
import {
    IDisposableRegistry,
    IConfigurationService,
    IExtensionContext,
    IBrowserService
} from '../../platform/common/types';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import { IServiceContainer } from '../../platform/ioc/types';
import { traceError, traceVerbose, traceWarning } from '../../platform/logging';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { NotebookCellLanguageService } from '../languages/cellLanguageService';
import { KernelFilterService } from './kernelFilter/kernelFilterService';
import { IControllerRegistration, InteractiveControllerIdSuffix, IVSCodeNotebookController } from './types';
import { VSCodeNotebookController } from './vscodeNotebookController';
import * as path from '../../platform/vscode-path/path';
import { waitForCondition } from '../../platform/common/utils/async';

/**
 * Keeps track of registered controllers and available KernelConnectionMetadatas.
 * Filtering is applied to the KernelConnectionMetadatas to limit the list of available controllers.
 */
@injectable()
export class ControllerRegistration implements IControllerRegistration {
    private get isLocalLaunch(): boolean {
        return this.serverConnectionType.isLocalLaunch;
    }
    private registeredControllers = new Map<string, VSCodeNotebookController>();
    private creationEmitter = new EventEmitter<IVSCodeNotebookController>();
    private registeredMetadatas = new Map<string, KernelConnectionMetadata>();
    private inKernelExperiment = false;

    public get onCreated(): Event<IVSCodeNotebookController> {
        return this.creationEmitter.event;
    }
    public get registered(): IVSCodeNotebookController[] {
        return [...this.registeredControllers.values()];
    }
    public get all(): KernelConnectionMetadata[] {
        return this.metadatas;
    }
    private get metadatas(): KernelConnectionMetadata[] {
        return [...this.registeredMetadatas.values()];
    }
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(KernelFilterService) private readonly kernelFilter: KernelFilterService,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(NotebookCellLanguageService) private readonly languageService: NotebookCellLanguageService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IDocumentManager) private readonly docManager: IDocumentManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IBrowserService) private readonly browser: IBrowserService,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IServerConnectionType) private readonly serverConnectionType: IServerConnectionType,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IApplicationEnvironment) private readonly app: IApplicationEnvironment
    ) {
        this.kernelFilter.onDidChange(this.onDidChangeFilter, this, this.disposables);
        this.serverConnectionType.onDidChange(this.onDidChangeFilter, this, this.disposables);
        this.serverUriStorage.onDidChangeUri(this.onDidChangeUri, this, this.disposables);
        this.serverUriStorage.onDidRemoveUris(this.onDidRemoveUris, this, this.disposables);
        this.workspace.onDidChangeConfiguration(this.onDidChangeConfiguration, this, this.disposables);
        this.inKernelExperiment = this.configuration.getSettings().kernelPickerType === 'OnlyOneTypeOfKernel';
    }
    add(
        metadata: KernelConnectionMetadata,
        types: ('jupyter-notebook' | 'interactive')[]
    ): IVSCodeNotebookController[] {
        let results: IVSCodeNotebookController[] = [];
        try {
            // Create notebook selector
            types
                .map((t) => {
                    const id = this.getControllerId(metadata, t);

                    // Update our list kernel connections.
                    this.registeredMetadatas.set(id, metadata);

                    // Return the id and the metadata for use below
                    return [id, t];
                })
                .filter(([id]) => {
                    // See if we already created this controller or not
                    const controller = this.registeredControllers.get(id);
                    if (controller) {
                        // If we already have this controller, its possible the Python version information has changed.
                        // E.g. we had a cached kernlespec, and since then the user updated their version of python,
                        // Now we need to update the display name of the kernelspec.
                        controller.updateConnection(metadata);

                        // Add to results so that callers can find
                        results.push(controller);
                        return false;
                    } else if (this.isFiltered(metadata)) {
                        // Filter out those in our kernel filter
                        return false;
                    }
                    return true;
                })
                .forEach(([id, viewType]) => {
                    const controller = new VSCodeNotebookController(
                        metadata,
                        id,
                        viewType,
                        getDisplayNameOrNameOfKernelConnection(metadata),
                        this.notebook,
                        this.commandManager,
                        this.kernelProvider,
                        this.context,
                        this.disposables,
                        this.languageService,
                        this.workspace,
                        this.configuration,
                        this.docManager,
                        this.appShell,
                        this.browser,
                        this.extensionChecker,
                        this.serviceContainer,
                        async (action: KernelAction, actionSource: KernelActionSource, kernel: IKernel) => {
                            if (action !== 'start' || actionSource !== 'jupyterExtension') {
                                return;
                            }
                            // Lets enable this functionality later, for now this is enabled only in insiders.
                            if (this.app.channel === 'insiders') {
                                await this.swapKernelSpecConnectionControllerWithLiveController(kernel);
                            }
                        }
                    );
                    controller.onDidDispose(
                        () => {
                            this.registeredControllers.delete(controller.id);
                            // Note to self, registered metadatas survive disposal.
                            // This is so we don't have to recompute them when we switch back
                            // and forth between local and remote
                        },
                        this,
                        this.disposables
                    );
                    controller.onNotebookControllerSelectionChanged((e) => {
                        if (!e.selected && this.isFiltered(controller.connection)) {
                            // This item was selected but is no longer allowed in the kernel list. Remove it
                            traceVerbose(`Removing controller ${controller.id} from kernel list`);
                            controller.dispose();
                        }
                    });
                    // We are disposing as documents are closed, but do this as well
                    this.disposables.push(controller);
                    this.registeredControllers.set(controller.id, controller);
                    results.push(controller);
                    this.creationEmitter.fire(controller);
                });
        } catch (ex) {
            if (isCancellationError(ex, true)) {
                // This can happen in the tests, and these get bubbled upto VSC and are logged as unhandled exceptions.
                // Hence swallow cancellation errors.
                return results;
            }
            // We know that this fails when we have xeus kernels installed (untill that's resolved thats one instance when we can have duplicates).
            sendTelemetryEvent(
                Telemetry.FailedToCreateNotebookController,
                undefined,
                { kind: metadata.kind },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ex as any
            );
            traceError(`Failed to create notebook controller for ${metadata.id}`, ex);
        }
        return results;
    }
    get(
        metadata: KernelConnectionMetadata,
        notebookType: 'jupyter-notebook' | 'interactive'
    ): IVSCodeNotebookController | undefined {
        const id = this.getControllerId(metadata, notebookType);
        return this.registeredControllers.get(id);
    }
    @swallowExceptions()
    private async swapKernelSpecConnectionControllerWithLiveController(kernel: IKernel) {
        if (kernel.kernelConnectionMetadata.kind === 'startUsingRemoteKernelSpec') {
            if (!kernel.session?.kernel?.id) {
                return;
            }
            // Check if we have a controller registered for this live kernel session.
            // If not, then create one.
            // Next, then swap the metadata & controller in the kernel.
            const liveKernelConnection: LiveRemoteKernelConnectionMetadata = {
                kind: 'connectToLiveRemoteKernel',
                baseUrl: kernel.kernelConnectionMetadata.baseUrl,
                id: kernel.session.kernel.id,
                kernelModel: {
                    ...kernel.kernelConnectionMetadata.kernelSpec,
                    model: {
                        id: kernel.session.kernel.id,
                        name: kernel.session.kernel.name,
                        path: path.basename(kernel.uri.path),
                        type: 'notebook',
                        kernel: kernel.session.kernel.model
                    },
                    notebook: {
                        path: path.basename(kernel.uri.path)
                    },
                    name: kernel.session.kernel.name,
                    numberOfConnections: 1,
                    lastActivityTime: new Date(),
                    id: kernel.session.kernel.id
                },
                serverId: kernel.kernelConnectionMetadata.serverId,
                interpreter: kernel.kernelConnectionMetadata.interpreter
            };
            if (!this.registeredControllers.has(this.getControllerId(liveKernelConnection, 'jupyter-notebook'))) {
                this.add(liveKernelConnection, [JupyterNotebookView, InteractiveWindowView]);
            }
            const liveController = Array.from(this.registeredControllers.values()).find(
                (item) =>
                    item.controller.notebookType === kernel.controller.notebookType &&
                    item.connection.kind === 'connectToLiveRemoteKernel' &&
                    item.connection.id === kernel.session?.kernel?.id
            );
            if (liveController) {
                this.kernelProvider.updateKernel(kernel, liveController.connection, liveController.controller);

                const notebookEditor = this.notebook.notebookEditors.find(
                    (item) => item.notebook.uri.toString() === kernel.uri.toString()
                );
                await this.commandManager.executeCommand('notebook.selectKernel', {
                    id: liveController.id,
                    extension: JVSC_EXTENSION_ID,
                    // Pass in the notebook editor as well, in case the notebook isn't active.
                    notebookEditor
                });
                const nb = this.notebook.notebookDocuments.find(
                    (item) => item.uri.toString() === kernel.uri.toString()
                );
                // Ensure our code see's this controller as having been selected.
                if (nb) {
                    await waitForCondition(async () => liveController.isAssociatedWithDocument(nb), 5_000, 100);
                }
            } else {
                traceWarning(
                    `Changing to live controller failed, could not find live kernel controller for ${kernel.session?.kernel?.id}`
                );
            }
            return;
        }
    }

    private isFiltered(metadata: KernelConnectionMetadata): boolean {
        const userFiltered = this.kernelFilter.isKernelHidden(metadata);
        const connectionTypeFiltered = isLocalConnection(metadata) !== this.isLocalLaunch;
        const urlFiltered = isRemoteConnection(metadata) && this.serverUriStorage.currentServerId !== metadata.serverId;

        if (this.inKernelExperiment) {
            return userFiltered || connectionTypeFiltered || urlFiltered;
        }

        return userFiltered || urlFiltered;
    }

    private getControllerId(
        metadata: KernelConnectionMetadata,
        viewType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ) {
        return viewType === JupyterNotebookView ? metadata.id : `${metadata.id}${InteractiveControllerIdSuffix}`;
    }

    private isControllerAttachedToADocument(controller: IVSCodeNotebookController) {
        return this.notebook.notebookDocuments.some((doc) => controller.isAssociatedWithDocument(doc));
    }

    private onDidChangeUri() {
        // Our list of metadata could be out of date. Remove old ones that don't match the uri
        if (this.serverUriStorage.currentServerId) {
            [...this.registeredMetadatas.keys()].forEach((k) => {
                const m = this.registeredMetadatas.get(k);
                if (m && isRemoteConnection(m) && this.serverUriStorage.currentServerId !== m.serverId) {
                    this.registeredMetadatas.delete(k);
                }
            });
        }

        // Update the list of controllers
        this.onDidChangeFilter();
    }

    private async onDidRemoveUris(uriEntries: IJupyterServerUriEntry[]) {
        // Remove any connections that are no longer available.
        const serverIds = await Promise.all(uriEntries.map((entry) => entry.uri).map(computeServerId));
        serverIds.forEach((serverId) => {
            [...this.registeredMetadatas.keys()].forEach((k) => {
                const m = this.registeredMetadatas.get(k);
                if (m && isRemoteConnection(m) && serverId === m.serverId) {
                    this.registeredMetadatas.delete(k);
                }
            });
        });

        // Update list of controllers
        this.onDidChangeFilter();
    }

    private onDidChangeConfiguration(e: ConfigurationChangeEvent) {
        if (e.affectsConfiguration('jupyter.showOnlyOneTypeOfKernel')) {
            this.inKernelExperiment = this.workspace.getConfiguration('jupyter')?.get('showOnlyOneTypeOfKernel', false);
            this.onDidChangeFilter();
        }
    }

    private onDidChangeFilter() {
        // Give our list of metadata should be up to date, just remove the filtered ones
        const metadatas = this.metadatas.filter((item) => !this.isFiltered(item));

        // Try to re-create the missing controllers.
        metadatas.forEach((c) => this.add(c, [JupyterNotebookView, InteractiveWindowView]));

        // Go through all controllers that have been created and hide them.
        // Unless they are attached to an existing document.
        this.registered.forEach((item) => {
            // TODO: Don't hide controllers that are already associated with a notebook.
            // If we have a notebook opened and its using a kernel.
            // Else we end up killing the execution as well.
            if (this.isFiltered(item.connection) && !this.isControllerAttachedToADocument(item)) {
                item.dispose();
            }
        });
    }
}
