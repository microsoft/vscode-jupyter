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
import { traceError, traceInfo, traceInfoIf } from '../../common/logger';
import {
    IConfigurationService,
    IDisposableRegistry,
    IExtensionContext,
    IExtensions,
    IPathUtils
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
    KernelConnectionMetadata,
    KernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../jupyter/kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { IJupyterKernelSpec, INotebookProvider } from '../types';
import { getNotebookMetadata, isPythonNotebook } from './helpers/helpers';
import { VSCodeNotebookController } from './vscodeNotebookController';
import { INotebookControllerManager } from './types';
import { InteractiveWindowView, JupyterNotebookView } from './constants';
import { NotebookIPyWidgetCoordinator } from '../ipywidgets/notebookIPyWidgetCoordinator';
import { InterpreterPackages } from '../telemetry/interpreterPackages';
import { sendTelemetryEvent } from '../../telemetry';
import { NotebookCellLanguageService } from './cellLanguageService';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { noop } from '../../common/utils/misc';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../api/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { isCI } from '../../common/constants';
import { NoPythonKernelsNotebookController } from './noPythonKernelsNotebookController';
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
    private activeInterpreterControllerPromise?: Promise<VSCodeNotebookController | undefined>;
    // Listing of the controllers that we have registered
    private registeredControllers = new Map<string, VSCodeNotebookController>();

    private readonly isLocalLaunch: boolean;
    private wasPythonInstalledWhenFetchingControllers?: boolean;
    private interactiveNoPythonController?: NoPythonKernelsNotebookController;
    private notbeookNoPythonController?: NoPythonKernelsNotebookController;
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
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IDocumentManager) private readonly docManager: IDocumentManager,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell
    ) {
        this._onNotebookControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: VSCodeNotebookController;
        }>();
        this.disposables.push(this._onNotebookControllerSelected);
        this.isLocalLaunch = isLocalLaunch(this.configuration);
    }
    public async getInteractiveController(): Promise<VSCodeNotebookController | undefined> {
        return this.createActiveInterpreterController();
    }

    get onNotebookControllerSelected() {
        return this._onNotebookControllerSelected.event;
    }
    public getSelectedNotebookController(notebook: NotebookDocument) {
        return Array.from(this.registeredControllers.values()).find((item) => item.isAssociatedWithDocument(notebook));
    }

    public activate() {
        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        // If the extension activates after installing Jupyter extension, then ensure we load controllers right now.
        if (this.isLocalLaunch) {
            this.notebook.notebookDocuments.forEach((notebook) => this.onDidOpenNotebookDocument(notebook).catch(noop));
        }
        // Be aware of if we need to re-look for kernels on extension change
        this.extensions.onDidChange(this.onDidChangeExtensions, this, this.disposables);
    }

    // Function to expose currently registered controllers to test code only
    public registeredNotebookControllers(): VSCodeNotebookController[] {
        return Array.from(this.registeredControllers.values());
    }

    // Find all the notebook controllers that we have registered
    public async loadNotebookControllers(): Promise<void> {
        if (!this.controllersPromise) {
            this.loadFastKernel();

            const stopWatch = new StopWatch();

            // Fetch the list of kernels ignoring the cache.
            Promise.all([
                this.loadNotebookControllersImpl(true, 'ignoreCache'),
                this.loadNotebookControllersImpl(false, 'ignoreCache')
            ]).catch((ex) => console.error('Failed to fetch controllers without cache', ex));

            // Fetch the list of kernels from the cache (note: if there's nothing in the case, it will fallback to searching).
            this.controllersPromise = Promise.all([
                this.loadNotebookControllersImpl(true, 'useCache'),
                this.loadNotebookControllersImpl(false, 'useCache')
            ])
                .then(() => noop())
                .catch((error) => {
                    traceError('Error loading notebook controllers', error);
                    throw error;
                })
                .finally(() => {
                    // Send telemetry related to fetching the kernel connections
                    sendKernelListTelemetry(
                        Uri.file('test.ipynb'), // Give a dummy ipynb value, we need this as its used in telemetry to determine the resource.
                        Array.from(this.registeredControllers.values()).map((item) => item.connection),
                        stopWatch
                    );

                    traceInfoIf(
                        !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                        `Providing notebook controllers with length ${this.registeredControllers.size}.`
                    );
                });
        }
        return this.controllersPromise;
    }

    public getOrCreateController(
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
        this.createNotebookControllers([result]);

        // Return the created controller
        return this.registeredNotebookControllers().find(
            (controller) =>
                // We register each of our kernels as two controllers
                // because controllers are currently per-viewtype. Find
                // the one for the interactive viewtype for now
                controller.controller.notebookType === notebookType &&
                controller.connection.kind === 'startUsingPythonInterpreter' &&
                controller.connection.interpreter?.path === pythonInterpreter?.path &&
                controller.connection.interpreter.displayName === pythonInterpreter.displayName
        );
    }

    private loadFastKernel() {
        const config = this.configuration.getSettings();
        if (config.fastPythonKernel) {
            traceInfo('Loading fast python controller');

            const fastKernelSpec: IJupyterKernelSpec = {
                name: 'vscodefastpythonkernel',
                path: '/vscodefastpythonkernel',
                display_name: 'VS Code Fast Python Kernel',
                argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}']
            };

            const connectionMetadata: KernelSpecConnectionMetadata = {
                kernelSpec: fastKernelSpec,
                kind: 'startUsingKernelSpec',
                id: getKernelId(fastKernelSpec, undefined),
                useProcessEnv: true
            };

            this.createNotebookController(connectionMetadata, 'Fast Python');
        }
    }

    private async createActiveInterpreterController() {
        if (this.activeInterpreterControllerPromise) {
            return this.activeInterpreterControllerPromise;
        }
        const promise = async () => {
            // Fetch the active interpreter and use the matching controller
            const api = await this.pythonApi.getApi();
            const activeInterpreter = await api.getActiveInterpreter();

            if (!activeInterpreter) {
                return;
            }
            return this.getOrCreateController(activeInterpreter, InteractiveWindowView);
        };
        this.activeInterpreterControllerPromise = promise();
        return this.activeInterpreterControllerPromise;
    }
    /**
     * Turn all our kernelConnections that we know about into registered NotebookControllers
     */
    private async loadNotebookControllersImpl(
        listLocalNonPythonKernels: boolean,
        useCache?: 'useCache' | 'ignoreCache'
    ): Promise<void> {
        const cancelToken = new CancellationTokenSource();
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
        const connections = await this.getKernelConnectionMetadata(
            listLocalNonPythonKernels,
            cancelToken.token,
            useCache
        );
        // Now create the actual controllers from our connections
        this.createNotebookControllers(connections);
        // If we're listing Python kernels & there aren't any, then add a placeholder for `Python` which will prompt users to install python
        if (!listLocalNonPythonKernels) {
            if (connections.some((item) => isPythonKernelConnection(item))) {
                this.removeNoPythonControllers();
            } else {
                this.regsiterNoPythonControllers();
            }
        }
    }
    private removeNoPythonControllers() {
        this.notbeookNoPythonController?.dispose();
        this.interactiveNoPythonController?.dispose();

        this.notbeookNoPythonController = undefined;
        this.interactiveNoPythonController = undefined;
    }
    private regsiterNoPythonControllers() {
        if (this.notbeookNoPythonController) {
            return;
        }
        this.notbeookNoPythonController = new NoPythonKernelsNotebookController(
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
        this.disposables.push(this.notbeookNoPythonController);
    }
    private async onDidChangeExtensions() {
        if (!this.isLocalLaunch || !this.controllersPromise) {
            return;
        }
        // If we just installed the Pytohn extnsion and we fetched the controllers, then fetch it again.
        if (!this.wasPythonInstalledWhenFetchingControllers && this.extensionChecker.isPythonExtensionInstalled) {
            this.controllersPromise = undefined;
            await this.loadNotebookControllers();
        }
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
        traceInfoIf(isCI, `Clear controller mapping for ${document.uri.toString()}`);
        const loadControllersPromise = this.loadNotebookControllers();

        if (isPythonNotebook(getNotebookMetadata(document)) && this.extensionChecker.isPythonExtensionInstalled) {
            // If we know we're dealing with a Python notebook, load the active interpreter as a kernel asap.
            this.createActiveInterpreterController().catch(noop);
        }
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
                traceInfoIf(isCI, `PreferredConnection not found for NotebookDocument: ${document.uri.toString()}`);
                return;
            }

            traceInfo(
                `PreferredConnection: ${preferredConnection.id} found for NotebookDocument: ${document.uri.toString()}`
            );
            // Wait for our controllers to be loaded before we try to set a preferred on
            // can happen if a document is opened quick and we have not yet loaded our controllers
            await loadControllersPromise;
            const targetController = Array.from(this.registeredControllers.values()).find(
                (value) => preferredConnection?.id === value.connection.id
            );

            if (targetController) {
                traceInfo(`TargetController found ID: ${targetController.id} for document ${document.uri.toString()}`);
                await targetController.updateNotebookAffinity(document, NotebookControllerAffinity.Preferred);
            } else {
                traceInfoIf(
                    isCI,
                    `TargetController nof found ID: ${preferredConnection.id} for document ${document.uri.toString()}`
                );
            }
        } catch (ex) {
            traceError('Failed to find & set preferred controllers', ex);
        } finally {
            disposable.dispose();
        }
    }

    private createNotebookControllers(kernelConnections: KernelConnectionMetadata[]) {
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

        connectionsWithLabel.forEach((value) => {
            this.createNotebookController(value.connection, value.label);
        });
    }
    private createNotebookController(kernelConnection: KernelConnectionMetadata, label: string) {
        try {
            // Create notebook selector
            [
                [kernelConnection.id, JupyterNotebookView],
                [`${kernelConnection.id} (Interactive)`, InteractiveWindowView]
            ]
                .filter(([id]) => !this.registeredControllers.has(id))
                .forEach(([id, viewType]) => {
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
                        this.widgetCoordinator,
                        this.docManager
                    );
                    // Hook up to if this NotebookController is selected or de-selected
                    controller.onNotebookControllerSelected(
                        this.handleOnNotebookControllerSelected,
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

    private async getKernelConnectionMetadata(
        listLocalNonPythonKernels: boolean,
        token: CancellationToken,
        useCache: 'useCache' | 'ignoreCache' = 'ignoreCache'
    ): Promise<KernelConnectionMetadata[]> {
        if (this.isLocalLaunch) {
            return listLocalNonPythonKernels
                ? this.localKernelFinder.listNonPythonKernels(token, useCache)
                : this.localKernelFinder.listKernels(undefined, token, useCache);
        } else {
            if (listLocalNonPythonKernels) {
                return [];
            }
            const connection = await this.notebookProvider.connect({
                getOnly: false,
                resource: undefined,
                disableUI: false,
                localOnly: false
            });

            return this.remoteKernelFinder.listKernels(undefined, connection, token);
        }
    }

    // Update any new or removed kernel connections, LiveKernelModels might be added or removed
    // during remote connections
    private async updateRemoteConnections(cancelToken: CancellationToken) {
        // Don't update until initial load is done
        await this.loadNotebookControllers();

        // We've connected and done the intial fetch, so this is speedy
        const connections = await this.getKernelConnectionMetadata(false, cancelToken);

        if (cancelToken.isCancellationRequested) {
            // Bail out on making the controllers if we are cancelling
            traceInfo('Cancelled loading notebook controllers');
            return [];
        }

        // Look for any connections that are not registered already as controllers
        const missingConnections = connections.filter((connection) => {
            return !this.registeredControllers.has(connection.id);
        });

        // Look for any controllers that we have disposed
        const disposedControllers = Array.from(this.registeredControllers.values()).filter((controller) => {
            return !connections.some((connection) => {
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
            traceInfoIf(isCI, `Disposing controller ${controller.id}`);
            controller.dispose();
        });
    }
}
