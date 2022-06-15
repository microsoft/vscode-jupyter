// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookControllerAffinity, Uri } from 'vscode';
import { CancellationTokenSource, EventEmitter, NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import {
    IVSCodeNotebook,
    ICommandManager,
    IWorkspaceService,
    IDocumentManager,
    IApplicationShell
} from '../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView, PYTHON_LANGUAGE } from '../../platform/common/constants';
import {
    traceInfoIfCI,
    traceError,
    traceWarning,
    traceInfo,
    traceDecoratorVerbose,
    traceVerbose
} from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import {
    IDisposableRegistry,
    IExtensions,
    IConfigurationService,
    IExtensionContext,
    IBrowserService,
    Resource,
    IsWebExtension
} from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { trackKernelResourceInformation } from '../../kernels/telemetry/helper';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { IServiceContainer } from '../../platform/ioc/types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { NotebookCellLanguageService } from '../../intellisense/cellLanguageService';
import {
    LiveRemoteKernelConnectionMetadata,
    IKernelProvider,
    KernelConnectionMetadata,
    PythonKernelConnectionMetadata,
    IKernelFinder,
    isLocalConnection
} from '../../kernels/types';
import { INotebookControllerManager } from '../types';
import { KernelFilterService } from './kernelFilter/kernelFilterService';
import { NoPythonKernelsNotebookController } from './noPythonKernelsNotebookController';
import { VSCodeNotebookController } from './vscodeNotebookController';
import { IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { IVSCodeNotebookController } from './types';
import {
    createInterpreterKernelSpec,
    findKernelSpecMatchingInterpreter,
    getDisplayNameOrNameOfKernelConnection,
    getKernelId,
    getLanguageInNotebookMetadata,
    isPythonKernelConnection
} from '../../kernels/helpers';
import { getNotebookMetadata, getResourceType, isPythonNotebook } from '../../platform/common/utils';
import { getTelemetrySafeLanguage } from '../../telemetry/helpers';
import { INotebookMetadata } from '@jupyterlab/nbformat';
import { ServerConnectionType } from '../../kernels/jupyter/launcher/serverConnectionType';
import { computeServerId } from '../../kernels/jupyter/jupyterUtils';
import { ILocalResourceUriConverter } from '../../kernels/ipywidgets-message-coordination/types';
import { isCancellationError } from '../../platform/common/cancellation';

// Even after shutting down a kernel, the server API still returns the old information.
// Re-query after 2 seconds to ensure we don't get stale information.
const REMOTE_KERNEL_REFRESH_INTERVAL = 2_000;
export const InteractiveControllerIdSuffix = ' (Interactive)';

// Flag enum for the reason why a kernel was logged as an exact match
export enum PreferredKernelExactMatchReason {
    NoMatch = 0,
    OnlyKernel = 1 << 0,
    WasPreferredInterpreter = 1 << 1,
    IsExactMatch = 1 << 2
}

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
    private readonly _onNotebookControllerSelectionChanged = new EventEmitter<{
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
        selected: boolean;
    }>();

    // Promise to resolve when we have loaded our controllers
    private controllersPromise?: Promise<void>;
    // Listing of the controllers that we have registered
    private registeredControllers = new Map<string, VSCodeNotebookController>();
    private selectedControllers = new Map<string, VSCodeNotebookController>();
    private get allKernelConnections() {
        return Array.from(this.registeredControllers.values()).map((item) => item.connection);
    }
    private _controllersLoaded?: boolean;
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
    private preferredControllers = new Map<NotebookDocument, IVSCodeNotebookController>();

    private get isLocalLaunch(): boolean {
        return this.serverConnectionType.isLocalLaunch;
    }
    private wasPythonInstalledWhenFetchingControllers?: boolean;
    private interactiveNoPythonController?: NoPythonKernelsNotebookController;
    private notebookNoPythonController?: NoPythonKernelsNotebookController;
    private remoteRefreshedEmitter = new EventEmitter<LiveRemoteKernelConnectionMetadata[]>();
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(NotebookCellLanguageService) private readonly languageService: NotebookCellLanguageService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IDocumentManager) private readonly docManager: IDocumentManager,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(KernelFilterService) private readonly kernelFilter: KernelFilterService,
        @inject(IBrowserService) private readonly browser: IBrowserService,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IsWebExtension) private readonly isWeb: boolean,
        @inject(ServerConnectionType) private readonly serverConnectionType: ServerConnectionType,
        @inject(ILocalResourceUriConverter) private readonly resourceConverter: ILocalResourceUriConverter
    ) {
        this._onNotebookControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: VSCodeNotebookController;
        }>();
        this.disposables.push(this._onNotebookControllerSelected);
        this.disposables.push(this._onNotebookControllerSelectionChanged);
        this.kernelFilter.onDidChange(this.onDidChangeKernelFilter, this, this.disposables);

        let timer: NodeJS.Timeout | number | undefined;
        this.interpreters.onDidChangeInterpreters(
            () => {
                if (timer) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    clearTimeout(timer as any);
                }
                timer = setTimeout(
                    () =>
                        this.loadNotebookControllers(true).catch((ex) =>
                            traceError('Failed to re-query python kernels after changes to list of interpreters', ex)
                        ),
                    // This hacky solution should be removed in favor of https://github.com/microsoft/vscode-jupyter/issues/7583
                    // as a proper fix for https://github.com/microsoft/vscode-jupyter/issues/5319
                    1_000
                );
            },
            this,
            this.disposables
        );

        // Make sure to reload whenever we do something that changes state
        const forceLoad = () => this.loadNotebookControllers(true);
        this.serverUriStorage.onDidChangeUri(forceLoad, this, this.disposables);
        this.serverUriStorage.onDidRemoveUris(
            (uris) =>
                uris.forEach((uri) => {
                    // Remove controllers associated with remote connections that are no longer available.
                    const controllers = Array.from(this.registeredControllers.values());
                    controllers.forEach((item) => {
                        if (
                            item.connection.kind !== 'connectToLiveRemoteKernel' &&
                            item.connection.kind !== 'startUsingRemoteKernelSpec'
                        ) {
                            return;
                        }
                        if (item.connection.serverId !== computeServerId(uri)) {
                            return;
                        }
                        item.dispose();
                    });
                }),
            this,
            this.disposables
        );
        this.kernelProvider.onDidStartKernel(forceLoad, this, this.disposables);

        // For kernel dispose we need to wait a bit, otherwise the list comes back the
        // same
        this.kernelProvider.onDidDisposeKernel(
            () => setTimeout(forceLoad, REMOTE_KERNEL_REFRESH_INTERVAL),
            this,
            this.disposables
        );
    }
    public async getActiveInterpreterOrDefaultController(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        resource: Resource
    ): Promise<IVSCodeNotebookController | undefined> {
        if (this.isLocalLaunch) {
            traceInfoIfCI('CreateActiveInterpreterController');
            return this.createActiveInterpreterController(notebookType, resource);
        } else {
            traceInfoIfCI('CreateDefaultRemoteController');
            const notebook =
                notebookType === JupyterNotebookView
                    ? this.notebook.notebookDocuments.find((item) => item.notebookType === notebookType)
                    : undefined;
            const controller = await this.createDefaultRemoteController(notebookType, notebook);
            // If we're running on web, there is no active interpreter to fall back to
            if (controller || this.isWeb) {
                return controller;
            }
            traceVerbose('No default remote controller, hence returning the active interpreter');
            return this.createActiveInterpreterController(notebookType, resource);
        }
    }

    public getControllerForConnection(
        connection: KernelConnectionMetadata,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ) {
        const id =
            notebookType === JupyterNotebookView ? connection.id : `${connection.id}${InteractiveControllerIdSuffix}`;
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
    public getRegisteredNotebookControllers(): VSCodeNotebookController[] {
        return Array.from(this.registeredControllers.values());
    }

    // Find all the notebook controllers that we have registered
    public async loadNotebookControllers(refresh?: boolean): Promise<void> {
        if (!this.controllersPromise || refresh) {
            const stopWatch = new StopWatch();
            const cancelToken = new CancellationTokenSource();
            this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
            this.controllersPromise = this.loadNotebookControllersImpl(cancelToken.token)
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
                        Uri.file('test.ipynb'), // Give a dummy ipynb value, we need this as its used in telemetry to determine the resource.
                        Array.from(this.registeredControllers.values()).map((item) => item.connection),
                        stopWatch
                    );

                    traceInfoIfCI(`Providing notebook controllers with length ${this.registeredControllers.size}.`);
                });
        }
        return this.controllersPromise;
    }

    private async loadNotebookControllersImpl(cancelToken: CancellationToken) {
        let cachedConnections = await this.listKernels(cancelToken, 'useCache');
        // Remove all remove kernels if we're no longer interested in them.
        if (this.isLocalLaunch) {
            cachedConnections = cachedConnections.filter((connection) => isLocalConnection(connection));
        }
        const nonCachedConnectionsPromise = this.listKernels(cancelToken, 'ignoreCache');

        traceVerbose(`Found ${cachedConnections.length} cached controllers`);
        // Now create or update the actual controllers from our connections. Do this for the cached connections
        // so they show up quicker.
        this.createNotebookControllers(cachedConnections);

        // Do the same thing again but with non cached
        const nonCachedConnections = await nonCachedConnectionsPromise;
        traceVerbose(`Found ${cachedConnections.length} non-cached controllers`);
        this.createNotebookControllers(nonCachedConnections);

        // If there aren't any Python kernels, then add a placeholder for `Python` which will prompt users to install python (only do this in the node version so
        // we don't end up with a kernel that asks to install python)
        if (!this.isWeb) {
            if ([...this.registeredControllers.values()].some((item) => isPythonKernelConnection(item.connection))) {
                this.removeNoPythonControllers();
            } else {
                this.registerNoPythonControllers();
            }
        }

        // Update total number of connection & the like for existing remote controllers.
        nonCachedConnections.forEach((connection) => {
            const controller = this.registeredControllers.get(connection.id);
            if (controller && connection.kind === 'connectToLiveRemoteKernel') {
                controller.updateRemoteKernelDetails(connection);
            }
            const iwController = this.registeredControllers.get(`${connection.id}${InteractiveControllerIdSuffix}`);
            if (iwController && connection.kind === 'connectToLiveRemoteKernel') {
                iwController.updateRemoteKernelDetails(connection);
            }
        });

        // Look for any controllers that we have disposed (no longer found when fetching)
        const disposedControllers = Array.from(this.registeredControllers.values()).filter((controller) => {
            const connectionIsNoLongerValid = !nonCachedConnections.some((connection) => {
                return connection.id === controller.connection.id;
            });

            // Never remove remote kernels that don't exist.
            // Always leave them there for user to select, and if the connection is not available/not valid,
            // then notify the user and remove them.
            // Unless the user switches to using local kernels (i.e. doesn't have a remote kernel setup).
            if (
                connectionIsNoLongerValid &&
                controller.connection.kind === 'connectToLiveRemoteKernel' &&
                !this.isLocalLaunch
            ) {
                return true;
            }
            return connectionIsNoLongerValid;
        });

        // If we have any out of date connections, dispose of them
        disposedControllers.forEach((controller) => {
            this.registeredControllers.delete(controller.id);
            traceInfoIfCI(`Disposing controller ${controller.id}`);
            controller.dispose();
        });

        // If any of our non cached controllers were remote, indicate a remote refresh
        const liveConnections = nonCachedConnections.filter(
            (n) => n.kind === 'connectToLiveRemoteKernel'
        ) as LiveRemoteKernelConnectionMetadata[];
        if (liveConnections.length > 0) {
            this.remoteRefreshedEmitter.fire(liveConnections);
        }
    }

    private listKernels(
        cancelToken: CancellationToken,
        useCache: 'ignoreCache' | 'useCache'
    ): Promise<KernelConnectionMetadata[]> {
        return this.kernelFinder.listKernels(undefined, cancelToken, useCache).then((l) =>
            l
                .filter((item) => !this.kernelFilter.isKernelHidden(item))
                .filter((item) => {
                    return item.kind === 'startUsingPythonInterpreter';
                })
        );
        //.then((l) => l.filter((item) => !this.kernelFilter.isKernelHidden(item)));
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
        return this.getRegisteredNotebookControllers().find(
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
        const activeInterpreter = await this.interpreters.getActiveInterpreter(resource);

        if (!activeInterpreter) {
            traceWarning(`Unable to create a controller for ${notebookType} without an active interpreter.`);
            return;
        }
        traceVerbose(
            `Creating controller for ${notebookType} with interpreter ${getDisplayPath(activeInterpreter.uri)}`
        );
        return this.getOrCreateControllerForActiveInterpreter(activeInterpreter, notebookType);
    }
    @traceDecoratorVerbose('Get default Remote Controller')
    private async createDefaultRemoteController(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        notebook?: NotebookDocument
    ) {
        const metadata = notebook ? getNotebookMetadata(notebook) : undefined;
        const language =
            !metadata || isPythonNotebook(metadata) || !metadata.language_info?.name
                ? PYTHON_LANGUAGE
                : metadata.language_info.name;
        const kernelName = metadata ? metadata.kernelspec?.name : undefined;
        // Get all remote kernels
        await this.loadNotebookControllers();
        const controllers = this.getRegisteredNotebookControllers().filter((item) => {
            // Sort out interactive or non-interactive controllers
            if (
                item.connection.kind !== 'startUsingRemoteKernelSpec' ||
                item.controller.notebookType !== notebookType
            ) {
                return false;
            }
            return true;
        });
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
            // Sort out interactive or non-interactive controllers
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

        const defaultController = defaultPython3Kernel || defaultPythonKernel || defaultPythonLanguageKernel;

        if (language === PYTHON_LANGUAGE) {
            return defaultController;
        } else {
            let matchingKernelNameController: VSCodeNotebookController | undefined;
            let matchingKernelLanguageController: VSCodeNotebookController | undefined;
            controllers.forEach((item) => {
                // Sort out interactive or non-interactive controllers
                if (item.connection.kind !== 'startUsingRemoteKernelSpec') {
                    return;
                }
                if (item.connection.kernelSpec.name === kernelName) {
                    matchingKernelNameController = item;
                } else if (item.connection.kernelSpec.language === language) {
                    matchingKernelLanguageController = item;
                }
            });

            return matchingKernelNameController || matchingKernelLanguageController || defaultController;
        }
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

    // When a document is opened we need to look for a preferred kernel for it
    private async onDidOpenNotebookDocument(document: NotebookDocument) {
        // Restrict to only our notebook documents
        if (
            (document.notebookType !== JupyterNotebookView && document.notebookType !== InteractiveWindowView) ||
            !this.workspace.isTrusted
        ) {
            return;
        }

        this.initializePreferredNotebookController(document).catch(noop);
        if (isPythonNotebook(getNotebookMetadata(document)) && this.extensionChecker.isPythonExtensionInstalled) {
            // If we know we're dealing with a Python notebook, load the active interpreter as a kernel asap.
            this.createActiveInterpreterController(JupyterNotebookView, document.uri).catch(noop);
        }
    }

    public async initializePreferredNotebookController(document: NotebookDocument): Promise<void> {
        const { preferredConnection, controller } = await this.computePreferredNotebookController(document);

        if (controller) {
            traceVerbose(`TargetController found ID: ${controller.id} for document ${getDisplayPath(document.uri)}`);
            await controller.controller.updateNotebookAffinity(document, NotebookControllerAffinity.Preferred);

            trackKernelResourceInformation(document.uri, {
                kernelConnection: preferredConnection,
                isPreferredKernel: true
            });

            // Save in our map so we can find it in test code.
            this.preferredControllers.set(document, controller);
        } else {
            traceInfoIfCI(
                `TargetController not found ID: ${preferredConnection?.id} for document ${getDisplayPath(document.uri)}`
            );
        }
    }
    public async computePreferredNotebookController(
        document: NotebookDocument,
        serverId?: string
    ): Promise<{ preferredConnection?: KernelConnectionMetadata; controller?: IVSCodeNotebookController }> {
        traceInfoIfCI(`Clear controller mapping for ${getDisplayPath(document.uri)}`);
        const loadControllersPromise = this.loadNotebookControllers();
        // Keep track of a token per document so that we can cancel the search if the doc is closed
        const preferredSearchToken = new CancellationTokenSource();
        const disposable = this.notebook.onDidCloseNotebookDocument(
            (e) => (e === document ? preferredSearchToken.cancel() : undefined),
            this,
            this.disposables
        );

        try {
            let preferredConnection: KernelConnectionMetadata | undefined;
            // Don't attempt preferred kernel search for interactive window, but do make sure we
            // load all our controllers for interactive window
            const notebookMetadata = getNotebookMetadata(document);
            const resourceType = getResourceType(document.uri);
            const isPythonNbOrInteractiveWindow = isPythonNotebook(notebookMetadata) || resourceType === 'interactive';
            if (document.notebookType === JupyterNotebookView && !this.isLocalLaunch && isPythonNbOrInteractiveWindow) {
                const defaultPythonController = await this.createDefaultRemoteController(document.notebookType);
                preferredConnection = defaultPythonController?.connection;
            }
            if (document.notebookType === JupyterNotebookView && !preferredConnection) {
                const preferredInterpreter =
                    !serverId && isPythonNbOrInteractiveWindow && this.extensionChecker.isPythonExtensionInstalled
                        ? await this.interpreters.getActiveInterpreter(document.uri)
                        : undefined;

                // Await looking for the preferred kernel
                ({ preferredConnection } = await this.findPreferredKernelExactMatch(
                    document,
                    notebookMetadata,
                    preferredSearchToken.token,
                    'useCache',
                    preferredInterpreter,
                    serverId
                ));

                // Also start the search to refresh the cache, don't need to await on this
                // unless we don't find a match. It will update the cache after running
                const ignoreCacheFindPreferredPromise = this.findPreferredKernelExactMatch(
                    document,
                    notebookMetadata,
                    preferredSearchToken.token,
                    'ignoreCache',
                    preferredInterpreter,
                    serverId
                );

                // If we didn't find an exact match in the cache, try awaiting for the non-cache version
                if (!preferredConnection) {
                    ({ preferredConnection } = await ignoreCacheFindPreferredPromise);
                }

                // Send telemetry on looking for preferred don't await for sending it
                this.sendPreferredKernelTelemetry(
                    document.uri,
                    notebookMetadata,
                    preferredConnection,
                    preferredInterpreter
                ).ignoreErrors();

                // If we found a preferred kernel, set the association on the NotebookController
                if (preferredSearchToken.token.isCancellationRequested && !preferredConnection) {
                    traceInfo('Find preferred kernel cancelled');
                    return {};
                }
                if (!preferredConnection) {
                    traceInfoIfCI(
                        `PreferredConnection not found for NotebookDocument: ${getDisplayPath(document.uri)}`
                    );
                    return {};
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
                    traceVerbose(`Early registration of controller for Kernel connection ${preferredConnection.id}`);
                    this.createNotebookControllers([preferredConnection]);
                }
            } else if (document.notebookType === InteractiveWindowView) {
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
                        ? `${preferredConnection.id}${InteractiveControllerIdSuffix}`
                        : preferredConnection.id;
                targetController = this.registeredControllers.get(preferredId);
            }

            return { preferredConnection, controller: targetController };
        } catch (ex) {
            traceError('Failed to find & set preferred controllers', ex);
            return {};
        } finally {
            disposable.dispose();
        }
    }

    // Use our kernel finder to rank our kernels, and see if we have an exact match
    private async findPreferredKernelExactMatch(
        document: NotebookDocument,
        notebookMetadata: INotebookMetadata | undefined,
        cancelToken: CancellationToken,
        useCache: 'useCache' | 'ignoreCache' | undefined,
        preferredInterpreter: PythonEnvironment | undefined,
        serverId: string | undefined
    ): Promise<{
        rankedConnections: KernelConnectionMetadata[] | undefined;
        preferredConnection: KernelConnectionMetadata | undefined;
    }> {
        let preferredConnection: KernelConnectionMetadata | undefined;
        const rankedConnections = await this.kernelFinder.rankKernels(
            document.uri,
            notebookMetadata,
            preferredInterpreter,
            cancelToken,
            useCache,
            serverId
        );

        if (rankedConnections && rankedConnections.length) {
            const potentialMatch = rankedConnections[rankedConnections.length - 1];

            // Are we the only connection?
            const onlyConnection = rankedConnections.length === 1;

            // Is the top ranked connection the preferred interpreter?
            const topMatchIsPreferredInterpreter = findKernelSpecMatchingInterpreter(preferredInterpreter, [
                potentialMatch
            ]);

            // Are we an exact match based on metadata hash / name / ect...?
            const isExactMatch = this.kernelFinder.isExactMatch(document.uri, potentialMatch, notebookMetadata);

            // Match on our possible reasons
            if (onlyConnection || topMatchIsPreferredInterpreter || isExactMatch) {
                traceInfo(`Preferred kernel ${potentialMatch.id} is exact match`);
                preferredConnection = potentialMatch;
            }

            // Send telemetry on why we matched
            let matchReason: PreferredKernelExactMatchReason = PreferredKernelExactMatchReason.NoMatch;
            onlyConnection && (matchReason |= PreferredKernelExactMatchReason.OnlyKernel);
            topMatchIsPreferredInterpreter && (matchReason |= PreferredKernelExactMatchReason.WasPreferredInterpreter);
            isExactMatch && (matchReason |= PreferredKernelExactMatchReason.IsExactMatch);
            sendTelemetryEvent(Telemetry.PreferredKernelExactMatch, undefined, {
                matchedReason: matchReason
            });
        }

        return { rankedConnections, preferredConnection };
    }
    private async sendPreferredKernelTelemetry(
        resource: Resource,
        notebookMetadata?: INotebookMetadata,
        preferredConnection?: KernelConnectionMetadata,
        preferredInterpreter?: PythonEnvironment
    ) {
        // Send telemetry on searching for a preferred connection
        const resourceType = getResourceType(resource);
        const telemetrySafeLanguage =
            resourceType === 'interactive'
                ? PYTHON_LANGUAGE
                : getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata) || '');

        sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
            result: preferredConnection ? 'found' : 'notfound',
            resourceType,
            language: telemetrySafeLanguage,
            hasActiveInterpreter: !!preferredInterpreter
        });
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
        traceVerbose(`Creating ${kernelConnections?.length} controllers`);
        // First sort our items by label
        const connectionsWithLabel = kernelConnections.map((value) => {
            return { connection: value, label: getDisplayNameOrNameOfKernelConnection(value) };
        });

        try {
            connectionsWithLabel.forEach((value) => {
                this.createNotebookController(value.connection, value.label, doNotHideInteractiveKernel);
            });
        } catch (ex) {
            if (!isCancellationError(ex, true)) {
                // This can happen in the tests, and these get bubbled upto VSC and are logged as unhandled exceptions.
                // Hence swallow cancellation errors.
                throw ex;
            }
        }
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
                [`${kernelConnection.id}${InteractiveControllerIdSuffix}`, InteractiveWindowView]
            ]
                .filter(([id]) => {
                    const controller = this.registeredControllers.get(id);
                    if (controller) {
                        // If we already have this controller, its possible the Python version information has changed.
                        // E.g. we had a cached kernlespec, and since then the user updated their version of python,
                        // Now we need to update the display name of the kernelspec.
                        // Assume user created a venv with name `.venv` and points to Python 3.8
                        // Tomorrow they delete this folder and re-create it with version Python 3.9.
                        // Similarly they could re-create conda environments or just install a new version of Global Python env.
                        if (
                            isPythonKernelConnection(kernelConnection) &&
                            (kernelConnection.kind === 'startUsingLocalKernelSpec' ||
                                kernelConnection.kind === 'startUsingPythonInterpreter')
                        ) {
                            controller.updateInterpreterDetails(kernelConnection);
                        }
                        return false;
                    }
                    return true;
                })
                .forEach(([id, viewType]) => {
                    let hideController = false;
                    if (kernelConnection.kind === 'connectToLiveRemoteKernel') {
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
                        this.context,
                        this.disposables,
                        this.languageService,
                        this.workspace,
                        this.configuration,
                        this.docManager,
                        this.appShell,
                        this.browser,
                        this.extensionChecker,
                        this.resourceConverter,
                        this.serviceContainer
                    );
                    // Hook up to if this NotebookController is selected or de-selected
                    controller.onNotebookControllerSelected(
                        this.handleOnNotebookControllerSelected,
                        this,
                        this.disposables
                    );
                    controller.onNotebookControllerSelectionChanged(
                        (e) => this._onNotebookControllerSelectionChanged.fire({ ...e, controller }),
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
            if (isCancellationError(ex, true)) {
                // This can happen in the tests, and these get bubbled upto VSC and are logged as unhandled exceptions.
                // Hence swallow cancellation errors.
                return;
            }
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
}
