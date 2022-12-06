// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { isPythonNotebook } from '../../kernels/helpers';
import { computeServerId } from '../../kernels/jupyter/jupyterUtils';
import { IJupyterServerUriEntry, IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { IKernelFinder, IKernelProvider, isRemoteConnection, KernelConnectionMetadata } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../platform/common/application/types';
import { isCancellationError } from '../../platform/common/cancellation';
import { InteractiveWindowView, JupyterNotebookView, Telemetry } from '../../platform/common/constants';
import { disposeAllDisposables } from '../../platform/common/helpers';
import {
    IBrowserService,
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    IExtensionContext,
    IFeaturesManager,
    IsWebExtension
} from '../../platform/common/types';
import { getNotebookMetadata, isJupyterNotebook } from '../../platform/common/utils';
import { noop } from '../../platform/common/utils/misc';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { IServiceContainer } from '../../platform/ioc/types';
import { traceError, traceInfoIfCI, traceVerbose } from '../../platform/logging';
import { sendTelemetryEvent } from '../../telemetry';
import { NotebookCellLanguageService } from '../languages/cellLanguageService';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { ConnectionDisplayDataProvider } from './connectionDisplayData';
import { createActiveInterpreterController } from './helpers';
import { KernelFilterService } from './kernelFilter/kernelFilterService';
import {
    IControllerRegistry,
    InteractiveControllerIdSuffix,
    IVSCodeNotebookController,
    IVSCodeNotebookControllerUpdateEvent
} from './types';
import { VSCodeNotebookController } from './vscodeNotebookController';

/**
 * This class finds and creates notebook controllers.
 */
@injectable()
export class ControllerLoader implements IControllerRegistry, IExtensionSyncActivationService {
    // Promise to resolve when we have loaded our controllers
    private controllersPromise: Promise<void>;
    private registeredControllers = new Map<string, VSCodeNotebookController>();
    private changeEmitter = new vscode.EventEmitter<IVSCodeNotebookControllerUpdateEvent>();
    private registeredMetadatas = new Map<string, KernelConnectionMetadata>();
    public get onDidChange(): vscode.Event<IVSCodeNotebookControllerUpdateEvent> {
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
    public get onControllerSelected(): vscode.Event<{
        notebook: vscode.NotebookDocument;
        controller: IVSCodeNotebookController;
    }> {
        return this.selectedEmitter.event;
    }
    public get onControllerSelectionChanged(): vscode.Event<{
        notebook: vscode.NotebookDocument;
        controller: IVSCodeNotebookController;
        selected: boolean;
    }> {
        return this.selectionChangedEmitter.event;
    }
    private selectedEmitter = new vscode.EventEmitter<{
        notebook: vscode.NotebookDocument;
        controller: IVSCodeNotebookController;
    }>();
    private selectionChangedEmitter = new vscode.EventEmitter<{
        notebook: vscode.NotebookDocument;
        controller: IVSCodeNotebookController;
        selected: boolean;
    }>();
    private selectedControllers = new Map<string, IVSCodeNotebookController>();
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(KernelFilterService) private readonly kernelFilter: KernelFilterService,
        @inject(IsWebExtension) private readonly isWebExtension: boolean,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(NotebookCellLanguageService) private readonly languageService: NotebookCellLanguageService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDocumentManager) private readonly docManager: IDocumentManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IBrowserService) private readonly browser: IBrowserService,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(ConnectionDisplayDataProvider) private readonly displayDataProvider: ConnectionDisplayDataProvider
    ) {}

    public activate(): void {
        this.kernelFinder.onDidChangeKernels(() => this.loadControllers(), this, this.disposables);
        this.kernelFilter.onDidChange(this.onDidChangeFilter, this, this.disposables);
        this.serverUriStorage.onDidChangeConnectionType(this.onDidChangeFilter, this, this.disposables);
        this.serverUriStorage.onDidChangeUri(this.onDidChangeUri, this, this.disposables);
        this.serverUriStorage.onDidRemoveUris(this.onDidRemoveUris, this, this.disposables);

        this.onDidChange(
            ({ added }) => {
                added.forEach((controller) => {
                    controller.onNotebookControllerSelectionChanged(
                        (e) => {
                            if (
                                this.featuresManager.features.kernelPickerType === 'Stable' &&
                                !e.selected &&
                                this.isFiltered(controller.connection) &&
                                this.canControllerBeDisposed(controller)
                            ) {
                                // This item was selected but is no longer allowed in the kernel list. Remove it
                                traceVerbose(`Removing controller ${controller.id} from kernel list`);
                                controller.dispose();
                            }
                        },
                        this,
                        this.disposables
                    );
                });
            },
            this,
            this.disposables
        );
        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        let previousKernelPickerType = this.featuresManager.features.kernelPickerType;
        this.featuresManager.onDidChangeFeatures(
            () => {
                if (previousKernelPickerType === this.featuresManager.features.kernelPickerType) {
                    return;
                }
                previousKernelPickerType = this.featuresManager.features.kernelPickerType;
                // With the old kernel picker some controllers can get disposed.
                // Hence to be on the safe side, when switching between the old and new kernel picker, reload the controllers.
                this.loadControllers();
            },
            this,
            this.disposables
        );

        // If the extension activates after installing Jupyter extension, then ensure we load controllers right now.
        this.loadControllers();
        this.notebook.notebookDocuments.forEach((notebook) => this.onDidOpenNotebookDocument(notebook).catch(noop));
    }
    private _activeInterpreterControllerIds = new Set<string>();
    trackActiveInterpreterControllers(controllers: IVSCodeNotebookController[]) {
        controllers.forEach((controller) => this._activeInterpreterControllerIds.add(controller.id));
    }
    private canControllerBeDisposed(controller: IVSCodeNotebookController) {
        return (
            !this._activeInterpreterControllerIds.has(controller.id) &&
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
                    const controllerDisposables: IDisposable[] = [];
                    controller.onDidDispose(
                        () => {
                            traceInfoIfCI(
                                `Deleting controller '${controller.id}' associated with view ${viewType} from registration as it was disposed`
                            );
                            this.registeredControllers.delete(controller.id);
                            // Note to self, registered metadatas survive disposal.
                            // This is so we don't have to recompute them when we switch back
                            // and forth between local and remote
                            disposeAllDisposables(controllerDisposables);
                        },
                        this,
                        this.disposables
                    );
                    controller.onNotebookControllerSelectionChanged(
                        (e) => {
                            if (e.selected) {
                                traceInfoIfCI(`Controller ${controller?.id} selected`);
                                this.selectedControllers.set(e.notebook.uri.toString(), controller);
                                this.selectedEmitter.fire({ notebook: e.notebook, controller });
                            }
                            this.selectionChangedEmitter.fire({ ...e, controller });
                        },
                        this,
                        controllerDisposables
                    );
                    // We are disposing as documents are closed, but do this as well
                    this.disposables.push(controller);
                    this.disposables.push(...controllerDisposables);
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
        if (this.featuresManager.features.kernelPickerType === 'Insiders') {
            return false;
        }
        const userFiltered = this.kernelFilter.isKernelHidden(metadata);
        const urlFiltered = isRemoteConnection(metadata) && this.serverUriStorage.currentServerId !== metadata.serverId;

        return userFiltered || urlFiltered;
    }
    public getSelected(document: vscode.NotebookDocument): IVSCodeNotebookController | undefined {
        return this.selectedControllers.get(document.uri.toString());
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
    private loadControllers() {
        this.controllersPromise = this.loadControllersImpl();
        sendKernelListTelemetry(this.registered.map((v) => v.connection));

        traceInfoIfCI(`Providing notebook controllers with length ${this.registered.length}.`);
    }
    public get loaded() {
        return this.controllersPromise;
    }
    private async onDidOpenNotebookDocument(document: vscode.NotebookDocument) {
        if (
            isJupyterNotebook(document) &&
            vscode.workspace.isTrusted &&
            isPythonNotebook(getNotebookMetadata(document)) &&
            this.extensionChecker.isPythonExtensionInstalled &&
            this.featuresManager.features.kernelPickerType === 'Stable'
        ) {
            // No need to always display active python env in VS Codes controller list.
            // If we know we're dealing with a Python notebook, load the active interpreter as a kernel asap.
            createActiveInterpreterController(JupyterNotebookView, document.uri, this.interpreters, this).catch(noop);
        }
    }

    private async loadControllersImpl() {
        if (
            this.extensionChecker.isPythonExtensionInstalled &&
            !this.isWebExtension &&
            this.featuresManager.features.kernelPickerType === 'Stable' &&
            this.serverUriStorage.isLocalLaunch
        ) {
            // This is temporary, when we create an MRU list in VS Code or the like, this should go away.
            // Debt https://github.com/microsoft/vscode-jupyter/issues/11988

            // First thing is to always create the controller for the active interpreter only if we don't have any remote connections.
            // This reduces flickering (changing controllers from one to another).
            await createActiveInterpreterController(JupyterNotebookView, undefined, this.interpreters, this);
        }
        const connections = this.kernelFinder.kernels;
        traceVerbose(`Found ${connections.length} cached controllers`);
        if (connections.length > 0) {
            traceVerbose(`Creating ${connections?.length} controllers`);
            const addedList: IVSCodeNotebookController[] = [];
            connections.forEach((metadata) => {
                const { added } = this.addImpl(metadata, [JupyterNotebookView, InteractiveWindowView], false);
                addedList.push(...added);
            });

            if (addedList.length) {
                this.changeEmitter.fire({ added: addedList, removed: [] });
            }
        }

        traceInfoIfCI(
            `Kernels found in kernel finder include ${connections
                .map((c) => `${c.kind}:${c.id}`)
                .join('\n')} \n and currently registered controllers include ${this.registered
                .map((c) => `${c.connection.kind}:${c.connection.id}`)
                .join('\n')}`
        );
        // Look for any controllers that we have disposed (no longer found when fetching)
        const validConnectionIds = new Set(connections.map((c) => c.id));
        const disposedControllers = Array.from(this.registered).filter((controller) => {
            const connectionIsStillValid = validConnectionIds.has(controller.connection.id);

            // Never remove remote kernels that don't exist.
            // Always leave them there for user to select, and if the connection is not available/not valid,
            // then notify the user and remove them.
            if (
                this.featuresManager.features.kernelPickerType === 'Stable' &&
                !connectionIsStillValid &&
                controller.connection.kind === 'connectToLiveRemoteKernel'
            ) {
                return true;
            }
            if (
                this.featuresManager.features.kernelPickerType === 'Stable' &&
                this._activeInterpreterControllerIds.has(controller.id)
            ) {
                return false;
            }
            if (!connectionIsStillValid) {
                traceVerbose(
                    `Controller ${controller.connection.kind}:'${controller.id}' for view = '${controller.viewType}' is no longer a valid`
                );
            }
            return !connectionIsStillValid;
        });
        // If we have any out of date connections, dispose of them
        disposedControllers.forEach((controller) => {
            traceVerbose(
                `Disposing old controller ${controller.connection.kind}:'${controller.id}' for view = '${controller.viewType}'`
            );
            controller.dispose(); // This should remove it from the registered list
        });
    }
    // TODO: Move to kernel finders.
    private onDidChangeUri() {
        // This logic only applies to old kernel picker which supports local vs remote, not both and not multiple remotes.
        if (this.featuresManager.features.kernelPickerType === 'Stable') {
            // Our list of metadata could be out of date. Remove old ones that don't match the uri
            if (this.serverUriStorage.currentServerId) {
                this.registered.forEach((c) => {
                    if (
                        isRemoteConnection(c.connection) &&
                        this.serverUriStorage.currentServerId !== c.connection.serverId
                    ) {
                        c.dispose();
                    }
                });
            }
        }
        // Update the list of controllers
        this.onDidChangeFilter();
    }

    // TODO: Move to kernel finders.
    private async onDidRemoveUris(uriEntries: IJupyterServerUriEntry[]) {
        // Remove any connections that are no longer available.
        const serverIds = await Promise.all(uriEntries.map((entry) => entry.uri).map(computeServerId));
        serverIds.forEach((serverId) => {
            this.registered.forEach((c) => {
                if (isRemoteConnection(c.connection) && serverId === c.connection.serverId) {
                    c.dispose();
                }
            });
        });

        // Update list of controllers
        this.onDidChangeFilter();
    }

    private onDidChangeFilter() {
        // Give our list of metadata should be up to date, just remove the filtered ones
        const metadatas = this.all.filter((item) => !this.isFiltered(item));

        // Try to re-create the missing controllers.
        metadatas.forEach((c) => this.addOrUpdate(c, [JupyterNotebookView, InteractiveWindowView]));

        // Go through all controllers that have been created and hide them.
        // Unless they are attached to an existing document.
        this.registered.forEach((item) => {
            // TODO: Don't hide controllers that are already associated with a notebook.
            // If we have a notebook opened and its using a kernel.
            // Else we end up killing the execution as well.
            if (this.isFiltered(item.connection) && this.canControllerBeDisposed(item)) {
                item.dispose();
            }
        });
    }
}
