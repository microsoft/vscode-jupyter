// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookControllerAffinity, Uri } from 'vscode';
import { CancellationTokenSource, EventEmitter, NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../activation/types';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../common/application/types';
import { traceDecorators, traceError, traceInfo, traceInfoIfCI, traceWarning } from '../../common/logger';
import {
    IBrowserService,
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
    createInterpreterKernelSpec,
    getDisplayNameOrNameOfKernelConnection,
    getKernelId,
    isLocalLaunch,
    isPythonKernelConnection
} from '../jupyter/kernels/helpers';
import {
    IKernelProvider,
    isLocalConnection,
    KernelConnectionMetadata,
    LiveKernelConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../jupyter/kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { IJupyterServerUriStorage, INotebookProvider } from '../types';
import { getNotebookMetadata, isPythonNotebook } from './helpers/helpers';
import { VSCodeNotebookController } from './vscodeNotebookController';
import { INotebookControllerManager } from './types';
import { InteractiveWindowView, JupyterNotebookView } from './constants';
import { NotebookIPyWidgetCoordinator } from '../ipywidgets/notebookIPyWidgetCoordinator';
import { sendTelemetryEvent } from '../../telemetry';
import { NotebookCellLanguageService } from './cellLanguageService';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { noop } from '../../common/utils/misc';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../api/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { NoPythonKernelsNotebookController } from './noPythonKernelsNotebookController';
import { IInterpreterService } from '../../interpreter/contracts';
import { KernelFilterService } from './kernelFilter/kernelFilterService';
import { getDisplayPath } from '../../common/platform/fs-paths';
import { DisplayOptions } from '../displayOptions';
import { JupyterServerSelector } from '../jupyter/serverSelector';
import { DataScience } from '../../common/utils/localize';

// Even after shutting down a kernel, the server API still returns the old information.
// Re-query after 2 seconds to ensure we don't get stale information.
const REMOTE_KERNEL_REFRESH_INTERVAL = 2_000;

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
    private readonly _onNotebookControllerSelectionChanged = new EventEmitter<void>();
    private readonly interactiveControllerIdSuffix = ' (Interactive)';

    // Promise to resolve when we have loaded our controllers
    private controllersPromise?: Promise<void>;
    // Listing of the controllers that we have registered
    private registeredControllers = new Map<string, VSCodeNotebookController>();
    private selectedControllers = new Map<string, VSCodeNotebookController>();
    private get allKernelConnections() {
        return Array.from(this.registeredControllers.values()).map((item) => item.connection);
    }
    private _controllersLoaded?: boolean;
    private failedToFetchRemoteKernels?: boolean;
    public get onNotebookControllerSelectionChanged() {
        return this._onNotebookControllerSelectionChanged.event;
    }
    public get kernelConnections() {
        return this.loadNotebookControllers().then(() => this.allKernelConnections);
    }
    public get controllersLoaded() {
        return this._controllersLoaded === true;
    }
    public get remoteRefreshed() {
        return this.remoteRefreshedEmitter.event;
    }
    private preferredControllers = new Map<NotebookDocument, VSCodeNotebookController>();

    private get isLocalLaunch(): boolean {
        return isLocalLaunch(this.configuration);
    }
    private wasPythonInstalledWhenFetchingControllers?: boolean;
    private interactiveNoPythonController?: NoPythonKernelsNotebookController;
    private notebookNoPythonController?: NoPythonKernelsNotebookController;
    private handlerAddedForChangesToRemoteKernelUri?: boolean;
    private remoteRefreshedEmitter = new EventEmitter<LiveKernelConnectionMetadata[]>();
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
        @inject(NotebookCellLanguageService) private readonly languageService: NotebookCellLanguageService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IDocumentManager) private readonly docManager: IDocumentManager,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(KernelFilterService) private readonly kernelFilter: KernelFilterService,
        @inject(IBrowserService) private readonly browser: IBrowserService,
        @inject(JupyterServerSelector) private readonly jupyterServerSelector: JupyterServerSelector,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage
    ) {
        this._onNotebookControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: VSCodeNotebookController;
        }>();
        this.disposables.push(this._onNotebookControllerSelected);
        this.disposables.push(this._onNotebookControllerSelectionChanged);
        this.kernelFilter.onDidChange(this.onDidChangeKernelFilter, this, this.disposables);
    }
    public async getActiveInterpreterOrDefaultController(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        resource: Resource
    ): Promise<VSCodeNotebookController | undefined> {
        if (this.isLocalLaunch) {
            traceInfoIfCI('CreateActiveInterpreterController');
            return this.createActiveInterpreterController(notebookType, resource);
        } else {
            traceInfoIfCI('CreateDefaultRemoteController');
            return this.createDefaultRemoteController();
        }
    }

    public getControllerForConnection(
        connection: KernelConnectionMetadata,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ) {
        const id =
            notebookType === 'jupyter-notebook'
                ? connection.id
                : `${connection.id}${this.interactiveControllerIdSuffix}`;
        return this.registeredControllers.get(id);
    }
    get onNotebookControllerSelected() {
        return this._onNotebookControllerSelected.event;
    }
    public getSelectedNotebookController(notebook: NotebookDocument) {
        return this.selectedControllers.get(notebook.uri.toString());
    }

    public getPreferredNotebookController(notebook: NotebookDocument) {
        return this.preferredControllers.get(notebook);
    }

    public activate() {
        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        // If the extension activates after installing Jupyter extension, then ensure we load controllers right now.
        this.notebook.notebookDocuments.forEach((notebook) => this.onDidOpenNotebookDocument(notebook).catch(noop));
        // Be aware of if we need to re-look for kernels on extension change
        this.extensions.onDidChange(this.onDidChangeExtensions, this, this.disposables);
    }

    // Function to expose currently registered controllers to test code only
    public registeredNotebookControllers(): VSCodeNotebookController[] {
        return Array.from(this.registeredControllers.values());
    }

    // Find all the notebook controllers that we have registered
    public async loadNotebookControllers(refresh?: boolean): Promise<void> {
        if (!this.controllersPromise || refresh) {
            const stopWatch = new StopWatch();

            // Fetch the list of kernels ignoring the cache.
            this.loadLocalNotebookControllersImpl('ignoreCache')
                .catch((ex) => console.error('Failed to fetch controllers without cache', ex))
                .finally(() => {
                    this._controllersLoaded = true;
                    let timer: NodeJS.Timeout | number | undefined;
                    this.interpreters.onDidChangeInterpreters(
                        () => {
                            if (timer) {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                clearTimeout(timer as any);
                            }
                            timer = setTimeout(
                                () =>
                                    this.loadLocalNotebookControllersImpl('ignoreCache').catch((ex) =>
                                        console.error(
                                            'Failed to re-query python kernels after changes to list of interpreters',
                                            ex
                                        )
                                    ),
                                // This hacky solution should be removed in favor of https://github.com/microsoft/vscode-jupyter/issues/7583
                                // as a proper fix for https://github.com/microsoft/vscode-jupyter/issues/5319
                                1_000
                            );
                        },
                        this,
                        this.disposables
                    );
                });

            // Fetch kernel the fastest possible way (local kernels from cache but remote fetch latest).
            // Fetch the list of kernels from the cache (note: if there's nothing in the case, it will fallback to searching).
            // Fetching remote kernels cannot be done from cache.
            const promises = [this.loadLocalNotebookControllersImpl('useCache')];
            if (!this.isLocalLaunch) {
                promises.push(this.loadRemoteNotebookControllersImpl());
            }
            this.controllersPromise = Promise.all(promises)
                .then(() => noop())
                .catch((error) => {
                    traceError('Error loading notebook controllers', error);
                    throw error;
                })
                .finally(() => {
                    if (!this.isLocalLaunch) {
                        const cancellation = new CancellationTokenSource();
                        this.updateRemoteConnections(cancellation.token)
                            .catch(noop)
                            .finally(() => cancellation.dispose());
                    }

                    // Send telemetry related to fetching the kernel connections
                    sendKernelListTelemetry(
                        Uri.file('test.ipynb'), // Give a dummy ipynb value, we need this as its used in telemetry to determine the resource.
                        Array.from(this.registeredControllers.values()).map((item) => item.connection),
                        stopWatch
                    );

                    traceInfoIfCI(`Providing notebook controllers with length ${this.registeredControllers.size}.`);
                });
        }
        return this.controllersPromise;
    }

    public getOrCreateControllerForActiveInterpreter(
        pythonInterpreter: PythonEnvironment,
        notebookType: 'interactive' | 'jupyter-notebook'
    ): VSCodeNotebookController | undefined {
        // Ensure that the controller corresponding to the active interpreter
        // has been successfully created
        const spec = createInterpreterKernelSpec(pythonInterpreter);
        const result: PythonKernelConnectionMetadata = {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: spec,
            interpreter: pythonInterpreter,
            id: getKernelId(spec, pythonInterpreter)
        };
        this.createNotebookControllers([result], notebookType === 'interactive');

        // Return the created controller
        return this.registeredNotebookControllers().find(
            (controller) =>
                // We register each of our kernels as two controllers
                // because controllers are currently per-notebookType. Find
                // the one for the notebookType we're interested in
                controller.controller.notebookType === notebookType &&
                controller.connection.kind === 'startUsingPythonInterpreter' &&
                // KernelConnectionMetadata.id should be the same as the one we just set up
                controller.connection.id === result.id
        );
    }

    private async createActiveInterpreterController(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        resource: Resource
    ) {
        // Fetch the active interpreter and use the matching controller
        const api = await this.pythonApi.getApi();
        const activeInterpreter = await api.getActiveInterpreter(resource);

        if (!activeInterpreter) {
            traceWarning(`Unable to create a controller for ${notebookType} without an active interpreter.`);
            return;
        }
        traceInfo(`Creating controller for ${notebookType} with interpreter ${getDisplayPath(activeInterpreter.path)}`);
        return this.getOrCreateControllerForActiveInterpreter(activeInterpreter, notebookType);
    }
    @traceDecorators.verbose('Get default Remote Controller')
    private async createDefaultRemoteController() {
        // Get all remote kernels
        await this.loadNotebookControllers();
        const controllers = this.registeredNotebookControllers();
        if (controllers.length === 0) {
            traceError('No remote controllers');
            return;
        }

        // Find the default kernel `python` if we can find one
        // If not available, then return anything thats a python kernel
        let defaultPython3Kernel: VSCodeNotebookController | undefined;
        let defaultPythonKernel: VSCodeNotebookController | undefined;
        let defaultPythonLanguageKernel: VSCodeNotebookController | undefined;
        controllers.forEach((item) => {
            if (item.connection.kind !== 'startUsingRemoteKernelSpec') {
                return;
            }
            if (item.connection.kernelSpec.name === 'python') {
                defaultPythonKernel = item;
            } else if (item.connection.kernelSpec.name === 'python3') {
                defaultPython3Kernel = item;
            } else if (item.connection.kernelSpec.language === PYTHON_LANGUAGE) {
                defaultPythonLanguageKernel = item;
            }
        });

        return defaultPython3Kernel || defaultPythonKernel || defaultPythonLanguageKernel || controllers[0];
    }
    /**
     * Turn all our local kernelConnections that we know about into registered NotebookControllers
     */
    private async loadLocalNotebookControllersImpl(useCache: 'useCache' | 'ignoreCache'): Promise<void> {
        const cancelToken = new CancellationTokenSource();
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
        let connections = await this.localKernelFinder
            .listKernels(undefined, cancelToken.token, useCache)
            .catch((ex) => {
                traceError('Failed to get local kernel connections', ex);
                return [] as KernelConnectionMetadata[];
            });

        // Filter the connections.
        connections = connections.filter((item) => !this.kernelFilter.isKernelHidden(item));

        // Now create the actual controllers from our connections
        this.createNotebookControllers(connections);

        // If there aren't any Python kernels, then add a placeholder for `Python` which will prompt users to install python
        if (connections.some((item) => isPythonKernelConnection(item))) {
            this.removeNoPythonControllers();
        } else {
            this.registerNoPythonControllers();
        }
    }
    /**
     * Turn all our remote kernelConnections that we know about into registered NotebookControllers
     */
    private async loadRemoteNotebookControllersImpl(): Promise<void> {
        const cancelToken = new CancellationTokenSource();
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
        let connections = await this.getRemoteKernelConnectionMetadata(cancelToken.token);

        // Filter the connections.
        connections = connections.filter((item) => !this.kernelFilter.isKernelHidden(item));

        // Now create the actual controllers from our connections
        this.createNotebookControllers(connections);
    }
    private removeNoPythonControllers() {
        this.notebookNoPythonController?.dispose();
        this.interactiveNoPythonController?.dispose();

        this.notebookNoPythonController = undefined;
        this.interactiveNoPythonController = undefined;
    }
    private registerNoPythonControllers() {
        if (this.notebookNoPythonController) {
            return;
        }
        this.notebookNoPythonController = new NoPythonKernelsNotebookController(
            JupyterNotebookView,
            this.notebook,
            this.commandManager,
            this.disposables,
            this.extensionChecker,
            this.appShell
        );
        this.interactiveNoPythonController = new NoPythonKernelsNotebookController(
            InteractiveWindowView,
            this.notebook,
            this.commandManager,
            this.disposables,
            this.extensionChecker,
            this.appShell
        );
        this.disposables.push(this.interactiveNoPythonController);
        this.disposables.push(this.notebookNoPythonController);
    }
    private async onDidChangeExtensions() {
        if (!this.isLocalLaunch || !this.controllersPromise) {
            return;
        }
        // If we just installed the Python extension and we fetched the controllers, then fetch it again.
        if (!this.wasPythonInstalledWhenFetchingControllers && this.extensionChecker.isPythonExtensionInstalled) {
            this.controllersPromise = undefined;
            await this.loadNotebookControllers();
        }
    }
    private removeRemoteKernelControllers() {
        const remoteControllers = Array.from(this.registeredControllers.values()).filter(
            (item) => !isLocalConnection(item.connection)
        );
        remoteControllers.forEach((item) => {
            this.registeredControllers.delete(item.connection.id);
            item.dispose();
        });
    }
    private reloadControllersAfterChangingRemote() {
        if (this.handlerAddedForChangesToRemoteKernelUri) {
            return;
        }
        this.handlerAddedForChangesToRemoteKernelUri = true;
        let wasLocal = this.isLocalLaunch;
        const refreshRemoteKernels = async () => {
            if (this.isLocalLaunch) {
                this.removeRemoteKernelControllers();
                // Possible we started a new kernel or shutdown a kernel.
                // Hence no need to fetch kernels again.
                if (!wasLocal) {
                    void this.loadRemoteNotebookControllersImpl();
                }
                wasLocal = true;
                return;
            }
            wasLocal = false;
            const cancellation = new CancellationTokenSource();
            let connections = await this.getRemoteKernelConnectionMetadata(cancellation.token);
            await this.updateRemoteConnections(cancellation.token, connections);
            cancellation.dispose();

            // Indicate a refresh of the remote connections
            const allLiveKernelConnections = this.allKernelConnections.filter(
                (item) => item.kind === 'connectToLiveKernel'
            );
            this.remoteRefreshedEmitter.fire(allLiveKernelConnections as LiveKernelConnectionMetadata[]);
        };
        this.serverUriStorage.onDidChangeUri(refreshRemoteKernels, this, this.disposables);
        this.kernelProvider.onDidStartKernel(refreshRemoteKernels, this, this.disposables);
        this.kernelProvider.onDidDisposeKernel(
            () => {
                void refreshRemoteKernels();
                setTimeout(refreshRemoteKernels, REMOTE_KERNEL_REFRESH_INTERVAL);
            },
            this,
            this.disposables
        );
    }
    // When a document is opened we need to look for a preferred kernel for it
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
        traceInfoIfCI(`Clear controller mapping for ${getDisplayPath(document.uri)}`);
        const loadControllersPromise = this.loadNotebookControllers();
        if (!this.isLocalLaunch) {
            void loadControllersPromise.finally(() => {
                if (this.isLocalLaunch) {
                    return;
                }
                if (this.failedToFetchRemoteKernels) {
                    void this.appShell
                        .showErrorMessage(
                            DataScience.jupyterRemoteConnectFailedModalMessage(),
                            { modal: true },
                            DataScience.changeJupyterRemoteConnection(),
                            DataScience.showJupyterLogs()
                        )
                        .then((selection) => {
                            switch (selection) {
                                case DataScience.changeJupyterRemoteConnection():
                                    void this.jupyterServerSelector.selectJupyterURI(true, 'prompt');
                                    break;
                                case DataScience.showJupyterLogs():
                                    void this.commandManager.executeCommand('jupyter.viewOutput');
                                    break;
                            }
                        });
                }
            });
        }
        if (isPythonNotebook(getNotebookMetadata(document)) && this.extensionChecker.isPythonExtensionInstalled) {
            // If we know we're dealing with a Python notebook, load the active interpreter as a kernel asap.
            this.createActiveInterpreterController(JupyterNotebookView, document.uri).catch(noop);
        }

        try {
            let preferredConnection: KernelConnectionMetadata | undefined;
            // Don't attempt preferred kernel search for interactive window, but do make sure we
            // load all our controllers for interactive window
            if (document.notebookType === JupyterNotebookView) {
                this.reloadControllersAfterChangingRemote();
                if (
                    this.isLocalLaunch ||
                    this.localKernelFinder.findPreferredLocalKernelConnectionFromCache(getNotebookMetadata(document))
                ) {
                    preferredConnection = await this.localKernelFinder.findKernel(
                        document.uri,
                        getNotebookMetadata(document),
                        preferredSearchToken.token
                    );
                } else {
                    // For a remote connection check for new live kernel models before we find preferred
                    await this.updateRemoteConnections(preferredSearchToken.token);
                    const ui = new DisplayOptions(false);
                    try {
                        const connection = await this.notebookProvider.connect({
                            resource: document.uri,
                            ui,
                            kind: 'remoteJupyter',
                            token: preferredSearchToken.token
                        });
                        preferredConnection = await this.remoteKernelFinder.findKernel(
                            document.uri,
                            connection,
                            getNotebookMetadata(document),
                            preferredSearchToken.token
                        );
                    } finally {
                        ui.dispose();
                    }
                }

                // If we found a preferred kernel, set the association on the NotebookController
                if (preferredSearchToken.token.isCancellationRequested && !preferredConnection) {
                    traceInfo('Find preferred kernel cancelled');
                    return;
                }
                if (!preferredConnection) {
                    traceInfoIfCI(
                        `PreferredConnection not found for NotebookDocument: ${getDisplayPath(document.uri)}`
                    );
                    return;
                }

                traceInfo(
                    `PreferredConnection: ${preferredConnection.id} found for NotebookDocument: ${getDisplayPath(
                        document.uri
                    )}`
                );
                const targetController = Array.from(this.registeredControllers.values()).find(
                    (value) => preferredConnection?.id === value.connection.id
                );
                // If the controller doesn't exist, then it means we're still loading them.
                // However we can create this one as we have all of the necessary info.
                if (!targetController) {
                    traceInfo(`Early registration of controller for Kernel connection ${preferredConnection.id}`);
                    this.createNotebookControllers([preferredConnection]);
                }
            } else {
                // Wait for our controllers to be loaded before we try to set a preferred on
                // can happen if a document is opened quick and we have not yet loaded our controllers
                await loadControllersPromise;

                // For interactive set the preferred controller as the interpreter or default
                const defaultInteractiveController = await this.getActiveInterpreterOrDefaultController(
                    'interactive',
                    document.uri
                );
                preferredConnection = defaultInteractiveController?.connection;
            }

            // See if the preferred connection is in our registered controllers, add the sufix for the interactive scenario
            let targetController;
            if (preferredConnection) {
                const preferredId =
                    document.notebookType === 'interactive'
                        ? `${preferredConnection.id}${this.interactiveControllerIdSuffix}`
                        : preferredConnection.id;
                targetController = this.registeredControllers.get(preferredId);
            }

            if (targetController) {
                traceInfo(
                    `TargetController found ID: ${targetController.id} for document ${getDisplayPath(document.uri)}`
                );
                await targetController.updateNotebookAffinity(document, NotebookControllerAffinity.Preferred);

                // Save in our map so we can find it in test code.
                this.preferredControllers.set(document, targetController);
            } else {
                traceInfoIfCI(
                    `TargetController not found ID: ${preferredConnection?.id} for document ${getDisplayPath(
                        document.uri
                    )}`
                );
            }
        } catch (ex) {
            traceError('Failed to find & set preferred controllers', ex);
        } finally {
            disposable.dispose();
        }
    }
    private onDidChangeKernelFilter() {
        // Filter the connections.
        const connections = this.allKernelConnections.filter((item) => !this.kernelFilter.isKernelHidden(item));

        // Try to re-create the missing controllers.
        this.createNotebookControllers(connections);

        // Go through all controllers that have been created and hide them.
        // Unless they are attached to an existing document.
        Array.from(this.registeredControllers.values()).forEach((item) => {
            // TODO: Don't hide controllers that are already associated with a notebook.
            // If we have a notebook opened and its using a kernel.
            // Else we end up killing the execution as well.
            if (this.kernelFilter.isKernelHidden(item.connection) && !this.isControllerAttachedToADocument(item)) {
                item.dispose();
            }
        });
    }
    private isControllerAttachedToADocument(controller: VSCodeNotebookController) {
        return this.notebook.notebookDocuments.some((doc) => controller.isAssociatedWithDocument(doc));
    }
    private createNotebookControllers(
        kernelConnections: KernelConnectionMetadata[],
        doNotHideInteractiveKernel?: boolean
    ) {
        // First sort our items by label
        const connectionsWithLabel = kernelConnections.map((value) => {
            return { connection: value, label: getDisplayNameOrNameOfKernelConnection(value) };
        });

        connectionsWithLabel.forEach((value) => {
            this.createNotebookController(value.connection, value.label, doNotHideInteractiveKernel);
        });
    }
    private createNotebookController(
        kernelConnection: KernelConnectionMetadata,
        label: string,
        doNotHideInteractiveKernel?: boolean
    ) {
        try {
            // Create notebook selector
            [
                [kernelConnection.id, JupyterNotebookView],
                [`${kernelConnection.id}${this.interactiveControllerIdSuffix}`, InteractiveWindowView]
            ]
                .filter(([id]) => !this.registeredControllers.has(id))
                .forEach(([id, viewType]) => {
                    let hideController = false;
                    if (kernelConnection.kind === 'connectToLiveKernel') {
                        if (viewType === InteractiveWindowView && doNotHideInteractiveKernel) {
                            hideController = false;
                        } else {
                            hideController = this.kernelFilter.isKernelHidden(kernelConnection);
                        }
                    }
                    if (hideController) {
                        return;
                    }

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
                        this.configuration,
                        this.widgetCoordinator,
                        this.docManager,
                        this.appShell,
                        this.browser,
                        this.extensionChecker
                    );
                    // Hook up to if this NotebookController is selected or de-selected
                    controller.onNotebookControllerSelected(
                        this.handleOnNotebookControllerSelected,
                        this,
                        this.disposables
                    );
                    controller.onNotebookControllerSelectionChanged(
                        () => this._onNotebookControllerSelectionChanged.fire(),
                        this,
                        this.disposables
                    );
                    controller.onDidDispose(
                        () => {
                            this.registeredControllers.delete(controller.id);
                        },
                        this,
                        this.disposables
                    );
                    // We are disposing as documents are closed, but do this as well
                    this.disposables.push(controller);
                    this.registeredControllers.set(controller.id, controller);
                });
        } catch (ex) {
            // We know that this fails when we have xeus kernels installed (untill that's resolved thats one instance when we can have duplicates).
            sendTelemetryEvent(
                Telemetry.FailedToCreateNotebookController,
                undefined,
                { kind: kernelConnection.kind },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ex as any,
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
        traceInfoIfCI(`Controller ${event.controller?.id} selected`);
        this.selectedControllers.set(event.notebook.uri.toString(), event.controller);
        // Now notify out that we have updated a notebooks controller
        this._onNotebookControllerSelected.fire(event);
    }

    private async getRemoteKernelConnectionMetadata(token: CancellationToken): Promise<KernelConnectionMetadata[]> {
        const ui = new DisplayOptions(false);
        try {
            const connection = await this.notebookProvider.connect({
                resource: undefined,
                ui,
                kind: 'remoteJupyter',
                token
            });

            const kernels = await this.remoteKernelFinder.listKernels(undefined, connection, token);
            this.failedToFetchRemoteKernels = false;
            return kernels;
        } catch (ex) {
            this.failedToFetchRemoteKernels = true;
            traceError('Failed to get remote kernel connections', ex);
            return [] as KernelConnectionMetadata[];
        } finally {
            ui.dispose();
        }
    }

    // Update any new or removed kernel connections, LiveKernelModels might be added or removed
    // during remote connections
    private async updateRemoteConnections(cancelToken: CancellationToken, connections?: KernelConnectionMetadata[]) {
        traceInfoIfCI('Updating remote connections');
        // Don't update until initial load is done
        await this.loadNotebookControllers();

        // We've connected and done the initial fetch, so this is speedy
        connections = connections || (await this.getRemoteKernelConnectionMetadata(cancelToken));
        traceInfoIfCI(`Current remote connections, ${JSON.stringify(connections)}`);
        if (cancelToken.isCancellationRequested || !connections) {
            // Bail out on making the controllers if we are cancelling
            traceInfo('Cancelled loading notebook controllers');
            return [];
        }
        // Update total number of connection & the like for existing controllers.
        connections.forEach((connection) => {
            const controller = this.registeredControllers.get(connection.id);
            if (controller && connection.kind === 'connectToLiveKernel') {
                controller.updateRemoteKernelDetails(connection);
            }
            const iwController = this.registeredControllers.get(
                `${connection.id}${this.interactiveControllerIdSuffix}`
            );
            if (iwController && connection.kind === 'connectToLiveKernel') {
                iwController.updateRemoteKernelDetails(connection);
            }
        });

        // Look for any connections that are not registered already as controllers
        const missingConnections = connections.filter((connection) => {
            return !this.registeredControllers.has(connection.id);
        });

        // Look for any controllers that we have disposed
        const disposedControllers = Array.from(this.registeredControllers.values())
            .filter((controller) => !isLocalConnection(controller.connection))
            .filter((controller) => {
                return !connections!.some((connection) => {
                    return connection.id === controller.connection.id;
                });
            });

        // If we have any new connections, register them
        if (missingConnections.length > 0) {
            const connectionsWithLabel = missingConnections.map((value) => {
                return { connection: value, label: getDisplayNameOrNameOfKernelConnection(value) };
            });

            connectionsWithLabel.forEach((value) => {
                this.createNotebookController(value.connection, value.label);
            });
        }

        // If we have any out of date connections, dispose of them
        disposedControllers.forEach((controller) => {
            this.registeredControllers.delete(controller.id);
            traceInfoIfCI(`Disposing controller ${controller.id}`);
            controller.dispose();
        });
    }
}
