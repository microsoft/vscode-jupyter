// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { computeServerId } from '../../kernels/jupyter/jupyterUtils';
import { IJupyterServerUriEntry, IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { IKernelProvider, isRemoteConnection, KernelConnectionMetadata } from '../../kernels/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import {
    IVSCodeNotebook,
    ICommandManager,
    IWorkspaceService,
    IDocumentManager,
    IApplicationShell
} from '../../platform/common/application/types';
import { isCancellationError } from '../../platform/common/cancellation';
import { JupyterNotebookView, InteractiveWindowView } from '../../platform/common/constants';
import {
    IDisposableRegistry,
    IConfigurationService,
    IExtensionContext,
    IBrowserService,
    IFeaturesManager
} from '../../platform/common/types';
import { IServiceContainer } from '../../platform/ioc/types';
import { traceError, traceInfoIfCI, traceVerbose } from '../../platform/logging';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { NotebookCellLanguageService } from '../languages/cellLanguageService';
import { ConnectionDisplayDataProvider } from './connectionDisplayData';
import { KernelFilterService } from './kernelFilter/kernelFilterService';
import {
    IControllerRegistration,
    InteractiveControllerIdSuffix,
    IVSCodeNotebookController,
    IVSCodeNotebookControllerUpdateEvent
} from './types';
import { VSCodeNotebookController } from './vscodeNotebookController';

/**
 * Keeps track of registered controllers and available KernelConnectionMetadatas.
 * Filtering is applied to the KernelConnectionMetadatas to limit the list of available controllers.
 */
@injectable()
export class ControllerRegistration implements IControllerRegistration {
    private registeredControllers = new Map<string, VSCodeNotebookController>();
    private changeEmitter = new EventEmitter<IVSCodeNotebookControllerUpdateEvent>();
    private registeredMetadatas = new Map<string, KernelConnectionMetadata>();
    public get onChanged(): Event<IVSCodeNotebookControllerUpdateEvent> {
        return this.changeEmitter.event;
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
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager,
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
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(ConnectionDisplayDataProvider) private readonly displayDataProvider: ConnectionDisplayDataProvider
    ) {
        this.kernelFilter.onDidChange(this.onDidChangeFilter, this, this.disposables);
        this.serverUriStorage.onDidChangeConnectionType(this.onDidChangeFilter, this, this.disposables);
        this.serverUriStorage.onDidChangeUri(this.onDidChangeUri, this, this.disposables);
        this.serverUriStorage.onDidRemoveUris(this.onDidRemoveUris, this, this.disposables);
    }
    batchAdd(metadatas: KernelConnectionMetadata[], types: ('jupyter-notebook' | 'interactive')[]) {
        const addedList: IVSCodeNotebookController[] = [];
        metadatas.forEach((metadata) => {
            const { added } = this.addImpl(metadata, types, false);
            addedList.push(...added);
        });

        if (addedList.length) {
            this.changeEmitter.fire({ added: addedList, removed: [] });
        }
    }
    private activeInterpreterKernelConnectionId = new Set<string>();
    trackActiveInterpreterControllers(controllers: IVSCodeNotebookController[]) {
        controllers.forEach((controller) => this.activeInterpreterKernelConnectionId.add(controller.connection.id));
    }
    public canControllerBeDisposed(controller: IVSCodeNotebookController) {
        return (
            !this.activeInterpreterKernelConnectionId.has(controller.connection.id) ||
            !this.isControllerAttachedToADocument(controller)
        );
    }
    addOrUpdate(
        metadata: KernelConnectionMetadata,
        types: ('jupyter-notebook' | 'interactive')[]
    ): IVSCodeNotebookController[] {
        const { added, existing } = this.addImpl(metadata, types, true);
        return added.concat(existing);
    }
    addImpl(
        metadata: KernelConnectionMetadata,
        types: ('jupyter-notebook' | 'interactive')[],
        triggerChangeEvent: boolean
    ): { added: IVSCodeNotebookController[]; existing: IVSCodeNotebookController[] } {
        const added: IVSCodeNotebookController[] = [];
        const existing: IVSCodeNotebookController[] = [];
        traceInfoIfCI(`Create Controller for ${metadata.kind} and id '${metadata.id}' for view ${types.join(', ')}`);
        try {
            // Create notebook selector
            types
                .map((t) => {
                    const id = this.getControllerId(metadata, t);

                    // Update our list kernel connections.
                    this.registeredMetadatas.set(metadata.id, metadata);

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
                        existing.push(controller);

                        traceInfoIfCI(
                            `Found existing controller '${controller.id}', not creating a new one just updating it`
                        );
                        return false;
                    } else if (this.isFiltered(metadata)) {
                        // Filter out those in our kernel filter
                        traceInfoIfCI(`Existing controller '${id}' will be excluded as it is filtered`);
                        return false;
                    }
                    traceInfoIfCI(`Existing controller not found for '${id}', hence creating a new one`);
                    return true;
                })
                .forEach(([id, viewType]) => {
                    const controller = new VSCodeNotebookController(
                        metadata,
                        id,
                        viewType,
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
                        this.displayDataProvider
                    );
                    controller.onDidDispose(
                        () => {
                            traceInfoIfCI(
                                `Deleting controller '${controller.id}' associated with view ${viewType} from registration as it was disposed`
                            );
                            this.registeredControllers.delete(controller.id);
                            // Note to self, registered metadatas survive disposal.
                            // This is so we don't have to recompute them when we switch back
                            // and forth between local and remote
                        },
                        this,
                        this.disposables
                    );
                    controller.onNotebookControllerSelectionChanged((e) => {
                        if (
                            !e.selected &&
                            this.isFiltered(controller.connection) &&
                            !this.canControllerBeDisposed(controller)
                        ) {
                            // This item was selected but is no longer allowed in the kernel list. Remove it
                            traceVerbose(`Removing controller ${controller.id} from kernel list`);
                            controller.dispose();
                        }
                    });
                    // We are disposing as documents are closed, but do this as well
                    this.disposables.push(controller);
                    this.registeredControllers.set(controller.id, controller);
                    added.push(controller);
                });
            if (triggerChangeEvent && added.length) {
                this.changeEmitter.fire({ added: added, removed: [] });
            }
        } catch (ex) {
            if (isCancellationError(ex, true)) {
                // This can happen in the tests, and these get bubbled upto VSC and are logged as unhandled exceptions.
                // Hence swallow cancellation errors.
                return { added, existing };
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
        return { added, existing };
    }
    get(
        metadata: KernelConnectionMetadata,
        notebookType: 'jupyter-notebook' | 'interactive'
    ): IVSCodeNotebookController | undefined {
        const id = this.getControllerId(metadata, notebookType);
        return this.registeredControllers.get(id);
    }

    private isFiltered(metadata: KernelConnectionMetadata): boolean {
        const userFiltered = this.kernelFilter.isKernelHidden(metadata);
        const urlFiltered = isRemoteConnection(metadata) && this.serverUriStorage.currentServerId !== metadata.serverId;

        if (this.featuresManager.features.kernelPickerType === 'Insiders') {
            // In the 'Insiders' experiment remove the url filters as we want to register everything.
            return userFiltered;
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

    private onDidChangeFilter() {
        // Give our list of metadata should be up to date, just remove the filtered ones
        const metadatas = this.metadatas.filter((item) => !this.isFiltered(item));

        // Try to re-create the missing controllers.
        metadatas.forEach((c) => this.addOrUpdate(c, [JupyterNotebookView, InteractiveWindowView]));

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
