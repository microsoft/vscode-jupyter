// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import {
    Disposable,
    EventEmitter,
    ExtensionMode,
    languages,
    NotebookCell,
    NotebookCellExecution,
    NotebookCellKind,
    NotebookController,
    NotebookDocument,
    NotebookEdit,
    NotebookEditor,
    NotebookRendererScript,
    Uri,
    WorkspaceEdit
} from 'vscode';
import { IPythonExtensionChecker } from '../../platform/api/types';
import {
    IVSCodeNotebook,
    ICommandManager,
    IWorkspaceService,
    IDocumentManager,
    IApplicationShell
} from '../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView, PYTHON_LANGUAGE } from '../../platform/common/constants';
import { disposeAllDisposables } from '../../platform/common/helpers';
import {
    traceInfoIfCI,
    traceInfo,
    traceVerbose,
    traceWarning,
    traceDecoratorVerbose,
    traceError
} from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import {
    IBrowserService,
    IConfigurationService,
    IDisplayOptions,
    IDisposable,
    IDisposableRegistry,
    IExtensionContext
} from '../../platform/common/types';
import { createDeferred } from '../../platform/common/utils/async';
import { DataScience, Common } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { sendKernelTelemetryEvent } from '../../kernels/telemetry/sendKernelTelemetryEvent';
import { IServiceContainer } from '../../platform/ioc/types';
import { Commands } from '../../platform/common/constants';
import { Telemetry } from '../../telemetry';
import { WrappedError } from '../../platform/errors/types';
import { IPyWidgetMessages } from '../../messageTypes';
import {
    getDisplayNameOrNameOfKernelConnection,
    isPythonKernelConnection,
    areKernelConnectionsEqual
} from '../../kernels/helpers';
import {
    IKernel,
    IKernelController,
    IKernelProvider,
    isLocalConnection,
    KernelConnectionMetadata
} from '../../kernels/types';
import { KernelDeadError } from '../../kernels/errors/kernelDeadError';
import { DisplayOptions } from '../../kernels/displayOptions';
import { getNotebookMetadata, isJupyterNotebook } from '../../platform/common/utils';
import { ConsoleForegroundColors, TraceOptions } from '../../platform/logging/types';
import { KernelConnector } from './kernelConnector';
import { IVSCodeNotebookController } from './types';
import { isCancellationError } from '../../platform/common/cancellation';
import { CellExecutionCreator } from '../../kernels/execution/cellExecutionCreator';
import {
    traceCellMessage,
    endCellAndDisplayErrorsInCell,
    updateNotebookMetadata
} from '../../kernels/execution/helpers';
import type { KernelMessage } from '@jupyterlab/services';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../../kernels/telemetry/helper';
import { NotebookCellLanguageService } from '../languages/cellLanguageService';
import { IDataScienceErrorHandler } from '../../kernels/errors/types';
import { ITrustedKernelPaths } from '../../kernels/raw/finder/types';
import { KernelController } from '../../kernels/kernelController';
import { ConnectionDisplayDataProvider, IConnectionDisplayData } from './connectionDisplayData';
import { RemoteKernelReconnectBusyIndicator } from './remoteKernelReconnectBusyIndicator';

/**
 * Our implementation of the VSCode Notebook Controller. Called by VS code to execute cells in a notebook. Also displayed
 * in the kernel picker by VS code.
 */
export class VSCodeNotebookController implements Disposable, IVSCodeNotebookController {
    private readonly _onNotebookControllerSelected: EventEmitter<{
        notebook: NotebookDocument;
        controller: VSCodeNotebookController;
    }>;
    private readonly _onNotebookControllerSelectionChanged = new EventEmitter<{
        selected: boolean;
        notebook: NotebookDocument;
    }>();
    private pendingCellAdditions = new Map<NotebookDocument, Promise<void>>();
    private readonly _onDidDispose = new EventEmitter<void>();
    private readonly disposables: IDisposable[] = [];
    private notebookKernels = new WeakMap<NotebookDocument, IKernel>();
    public readonly controller: NotebookController;
    /**
     * Used purely for testing purposes.
     */
    public static kernelAssociatedWithDocument?: boolean;
    private isDisposed = false;
    private runningCellExecutions = new Map<NotebookDocument, NotebookCellExecution>();
    get id() {
        return this.controller.id;
    }

    get label() {
        return this.controller.label;
    }

    get connection() {
        return this.kernelConnection;
    }

    get viewType() {
        return this._viewType as typeof InteractiveWindowView | typeof JupyterNotebookView;
    }

    get onNotebookControllerSelected() {
        return this._onNotebookControllerSelected.event;
    }
    get onNotebookControllerSelectionChanged() {
        return this._onNotebookControllerSelectionChanged.event;
    }
    get onDidReceiveMessage() {
        return this.controller.onDidReceiveMessage;
    }
    get onDidDispose() {
        return this._onDidDispose.event;
    }
    public isAssociatedWithDocument(doc: NotebookDocument) {
        return this.associatedDocuments.has(doc);
    }
    private readonly displayData: IConnectionDisplayData;

    private readonly associatedDocuments = new WeakMap<NotebookDocument, Promise<void>>();
    public static create(
        kernelConnection: KernelConnectionMetadata,
        id: string,
        _viewType: string,
        notebookApi: IVSCodeNotebook,
        commandManager: ICommandManager,
        kernelProvider: IKernelProvider,
        context: IExtensionContext,
        disposableRegistry: IDisposableRegistry,
        languageService: NotebookCellLanguageService,
        workspace: IWorkspaceService,
        configuration: IConfigurationService,
        documentManager: IDocumentManager,
        appShell: IApplicationShell,
        browser: IBrowserService,
        extensionChecker: IPythonExtensionChecker,
        serviceContainer: IServiceContainer,
        displayDataProvider: ConnectionDisplayDataProvider
    ): IVSCodeNotebookController {
        return new VSCodeNotebookController(
            kernelConnection,
            id,
            _viewType,
            notebookApi,
            commandManager,
            kernelProvider,
            context,
            disposableRegistry,
            languageService,
            workspace,
            configuration,
            documentManager,
            appShell,
            browser,
            extensionChecker,
            serviceContainer,
            displayDataProvider
        );
    }
    constructor(
        private kernelConnection: KernelConnectionMetadata,
        id: string,
        private _viewType: string,
        private readonly notebookApi: IVSCodeNotebook,
        private readonly commandManager: ICommandManager,
        private readonly kernelProvider: IKernelProvider,
        private readonly context: IExtensionContext,
        disposableRegistry: IDisposableRegistry,
        private readonly languageService: NotebookCellLanguageService,
        private readonly workspace: IWorkspaceService,
        private readonly configuration: IConfigurationService,
        private readonly documentManager: IDocumentManager,
        private readonly appShell: IApplicationShell,
        private readonly browser: IBrowserService,
        private readonly extensionChecker: IPythonExtensionChecker,
        private serviceContainer: IServiceContainer,
        private readonly displayDataProvider: ConnectionDisplayDataProvider
    ) {
        disposableRegistry.push(this);
        this._onNotebookControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: VSCodeNotebookController;
        }>();

        this.displayData = this.displayDataProvider.getDisplayData(this.connection);
        this.controller = this.notebookApi.createNotebookController(
            id,
            _viewType,
            this.displayData.label,
            this.handleExecution.bind(this),
            this.getRendererScripts(),
            []
        );
        this.displayData.onDidChange(this.updateDisplayData, this, this.disposables);
        this.updateDisplayData();

        // Fill in extended info for our controller
        this.controller.interruptHandler = this.handleInterrupt.bind(this);
        this.controller.supportsExecutionOrder = true;
        this.controller.supportedLanguages = this.languageService.getSupportedLanguages(kernelConnection);
        // Hook up to see when this NotebookController is selected by the UI
        this.controller.onDidChangeSelectedNotebooks(this.onDidChangeSelectedNotebooks, this, this.disposables);
        this.notebookApi.onDidCloseNotebookDocument(
            (n) => {
                traceInfoIfCI(
                    `Remove associated notebook ${getDisplayPath(n.uri)} from controller ${this.connection.kind}:${
                        this.id
                    } for ${this.viewType}`
                );
                this.associatedDocuments.delete(n);
            },
            this,
            this.disposables
        );
    }
    private readonly restoredConnections = new WeakSet<NotebookDocument>();
    public async restoreConnection(notebook: NotebookDocument) {
        if (this.restoredConnections.has(notebook)) {
            return;
        }
        this.restoredConnections.add(notebook);
        const kernel = await this.connectToKernel(notebook, new DisplayOptions(true));
        if (this.kernelConnection.kind === 'connectToLiveRemoteKernel') {
            this.disposables.push(
                new RemoteKernelReconnectBusyIndicator(kernel, this.controller, notebook, this.notebookApi)
            );
        }
    }
    public updateConnection(kernelConnection: KernelConnectionMetadata) {
        if (kernelConnection.kind !== 'connectToLiveRemoteKernel') {
            this.controller.label = getDisplayNameOrNameOfKernelConnection(kernelConnection);
        }
    }
    public asWebviewUri(localResource: Uri): Uri {
        return this.controller.asWebviewUri(localResource);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public postMessage(message: any, editor?: NotebookEditor): Thenable<boolean> {
        const messageType = message && 'message' in message ? message.message : '';
        traceInfoIfCI(`${ConsoleForegroundColors.Green}Posting message to Notebook UI ${messageType}`);
        return this.controller.postMessage(message, editor);
    }
    /**
     * A cell has been added to the notebook, so wait for the execution to be queued before handling any more execution requests.
     * This only applies to the Interactive Window since cells are added from both the extension and core.
     * @param promise A promise that resolves when the notebook is ready to handle more executions.
     */
    public setPendingCellAddition(notebook: NotebookDocument, promise: Promise<void>): void {
        if (this.viewType !== InteractiveWindowView) {
            throw new Error('setPendingCellAddition only applies to the Interactive Window');
        }

        this.pendingCellAdditions.set(notebook, promise);
    }

    public dispose() {
        if (this.isDisposed) {
            return;
        }
        const nbDocumentUris = this.notebookApi.notebookDocuments
            .filter((item) => this.associatedDocuments.has(item))
            .map((item) => item.uri.toString());
        traceVerbose(
            `Disposing controller ${this.id} associated with connection ${this.connection.id} ${
                nbDocumentUris.length ? 'and documents ' + nbDocumentUris.join(', ') : ''
            }`
        );
        traceInfoIfCI(
            `Disposing controller ${this.id} associated with connection ${this.connection.id} ${
                nbDocumentUris.length ? 'and documents ' + nbDocumentUris.join(', ') : ''
            } called from ${new Error('').stack}`
        );
        this.isDisposed = true;
        this._onNotebookControllerSelected.dispose();
        this._onNotebookControllerSelectionChanged.dispose();
        this.controller.dispose();
        this._onDidDispose.fire();
        this._onDidDispose.dispose();
        disposeAllDisposables(this.disposables);
    }
    private updateDisplayData() {
        this.controller.label = this.displayData.label;
        this.controller.description = this.displayData.description;
        if (this.displayData.serverDisplayName) {
            // MRU kernel picker doesn't show controller kind/category, so add server name to description
            this.controller.description = this.displayData.description
                ? `${this.displayData.description} (${this.displayData.serverDisplayName})`
                : this.displayData.serverDisplayName;
        }
    }
    // Handle the execution of notebook cell
    @traceDecoratorVerbose('VSCodeNotebookController::handleExecution', TraceOptions.BeforeCall)
    private async handleExecution(cells: NotebookCell[], notebook: NotebookDocument) {
        if (cells.length < 1) {
            return;
        }
        if (this.pendingCellAdditions.has(notebook)) {
            await this.pendingCellAdditions.get(notebook);
        }

        // Found on CI that sometimes VS Code calls this with old deleted cells.
        // See here https://github.com/microsoft/vscode-jupyter/runs/5581627878?check_suite_focus=true
        cells = cells.filter((cell) => {
            if (cell.index < 0) {
                traceWarning(
                    `Attempting to run a cell with index ${cell.index}, kind ${
                        cell.kind
                    }, text = ${cell.document.getText()}`
                );
                return false;
            }
            return true;
        });
        // When we receive a cell execute request, first ensure that the notebook is trusted.
        // If it isn't already trusted, block execution until the user trusts it.
        if (!this.workspace.isTrusted) {
            return;
        }
        await initializeInteractiveOrNotebookTelemetryBasedOnUserAction(notebook.uri, this.connection);
        // Notebook is trusted. Continue to execute cells
        await Promise.all(cells.map((cell) => this.executeCell(notebook, cell)));
    }
    private warnWhenUsingOutdatedPython() {
        const pyVersion = this.kernelConnection.interpreter?.version;
        if (
            !pyVersion ||
            pyVersion.major >= 4 ||
            (this.kernelConnection.kind !== 'startUsingLocalKernelSpec' &&
                this.kernelConnection.kind !== 'startUsingPythonInterpreter')
        ) {
            return;
        }

        if (pyVersion.major < 3 || (pyVersion.major === 3 && pyVersion.minor <= 5)) {
            this.appShell
                .showWarningMessage(DataScience.warnWhenSelectingKernelWithUnSupportedPythonVersion, Common.learnMore)
                .then((selection) => {
                    if (selection !== Common.learnMore) {
                        return;
                    }
                    return this.browser.launch('https://aka.ms/jupyterUnSupportedPythonKernelVersions');
                }, noop);
        }
    }
    private async onDidChangeSelectedNotebooks(event: { notebook: NotebookDocument; selected: boolean }) {
        traceInfoIfCI(
            `NotebookController selection event called for notebook ${event.notebook.uri.toString()} & controller ${
                this.connection.kind
            }:${this.id}. Selected ${event.selected} `
        );
        if (this.associatedDocuments.has(event.notebook) && event.selected) {
            // Possible it gets called again in our tests (due to hacks for testing purposes).
            return;
        }

        if (!event.selected) {
            // If user has selected another controller, then kill the current kernel.
            // Possible user selected a controller that's not contributed by us at all.
            const kernel = this.kernelProvider.get(event.notebook);
            if (kernel?.kernelConnectionMetadata.id === this.kernelConnection.id) {
                traceInfo(
                    `Disposing kernel ${this.kernelConnection.id} for notebook ${getDisplayPath(
                        event.notebook.uri
                    )} due to selection of another kernel or closing of the notebook`
                );
                kernel.dispose().catch(noop);
            }
            this.associatedDocuments.delete(event.notebook);
            this._onNotebookControllerSelectionChanged.fire(event);

            return;
        }
        // We're only interested in our Notebooks.
        if (!isJupyterNotebook(event.notebook) && event.notebook.notebookType !== InteractiveWindowView) {
            return;
        }
        if (!this.workspace.isTrusted) {
            return;
        }
        this.warnWhenUsingOutdatedPython();
        const deferred = createDeferred<void>();
        traceInfoIfCI(
            `Controller ${this.connection.kind}:${this.id} associated with nb ${getDisplayPath(event.notebook.uri)}`
        );
        this.associatedDocuments.set(event.notebook, deferred.promise);
        await this.onDidSelectController(event.notebook);
        await this.updateCellLanguages(event.notebook);

        // If this NotebookController was selected, fire off the event
        this._onNotebookControllerSelected.fire({ notebook: event.notebook, controller: this });
        this._onNotebookControllerSelectionChanged.fire(event);
        traceVerbose(`Controller selection change completed`);
        deferred.resolve();
    }

    /**
     * Scenario 1:
     * Assume user opens a notebook and language is C++ or .NET Interactive, they start writing python code.
     * Next users hits the run button, next user will be prompted to select a kernel.
     * User now selects a Python kernel.
     * Nothing happens, that's right nothing happens.
     * This is because C++ is not a languages supported by the python kernel.
     * Hence VS Code will not send the execution call to the extension.
     *
     * Solution, go through the cells and change the language to something that's supported.
     *
     * Scenario 2:
     * User has .NET extension installed.
     * User opens a Python notebook and runs a cell with a .NET kernel (accidentally or deliberately).
     * User gets errors in output & realizes mistake & changes the kernel.
     * Now user runs a cell & nothing happens again.
     */
    private async updateCellLanguages(notebook: NotebookDocument) {
        const supportedLanguages = this.controller.supportedLanguages;
        // If the controller doesn't have any preferred languages, then get out.
        if (!supportedLanguages || supportedLanguages?.length === 0) {
            return;
        }
        const isPythonKernel = isPythonKernelConnection(this.kernelConnection);
        const preferredLanguage = isPythonKernel ? PYTHON_LANGUAGE : supportedLanguages[0];
        await Promise.all(
            notebook
                .getCells()
                .filter((cell) => cell.kind === NotebookCellKind.Code)
                .map(async (cell) => {
                    if (!supportedLanguages.includes(cell.document.languageId)) {
                        await languages.setTextDocumentLanguage(cell.document, preferredLanguage).then(noop, noop);
                    }
                })
        );
    }
    private getRendererScripts(): NotebookRendererScript[] {
        const scripts: Uri[] = [];

        // Only used in tests & while debugging.
        if (
            this.context.extensionMode === ExtensionMode.Development ||
            this.context.extensionMode === ExtensionMode.Test
        ) {
            scripts.push(
                Uri.joinPath(
                    this.context.extensionUri,
                    'out',
                    'webviews',
                    'webview-side',
                    'widgetTester',
                    'widgetTester.js'
                )
            );
        }

        // See comments on dummy.ts for more details.
        scripts.push(
            Uri.joinPath(this.context.extensionUri, 'out', 'webviews', 'webview-side', 'ipywidgetsKernel', 'dummy.js')
        );
        return scripts.map((uri) => new NotebookRendererScript(uri));
    }

    private handleInterrupt(notebook: NotebookDocument) {
        traceVerbose(`VS Code interrupted kernel for ${getDisplayPath(notebook.uri)}`);
        notebook.getCells().forEach((cell) => traceCellMessage(cell, 'Cell cancellation requested'));
        this.commandManager
            .executeCommand(Commands.InterruptKernel, { notebookEditor: { notebookUri: notebook.uri } })
            .then(noop, (ex) => console.error(ex));
    }

    private createCellExecutionIfNecessary(cell: NotebookCell, controller: IKernelController) {
        // Only have one cell in the 'running' state for this notebook
        let currentExecution = this.runningCellExecutions.get(cell.notebook);
        if (!currentExecution || currentExecution.cell === cell) {
            currentExecution?.end(undefined, undefined);
            currentExecution = CellExecutionCreator.getOrCreate(cell, controller);
            this.runningCellExecutions.set(cell.notebook, currentExecution);

            // When this execution ends, we don't have a current one anymore.
            const originalEnd = currentExecution.end.bind(currentExecution);
            currentExecution.end = (success: boolean | undefined, endTime?: number | undefined) => {
                this.runningCellExecutions.delete(cell.notebook);
                originalEnd(success, endTime);
            };
        }
        return currentExecution;
    }

    private async executeCell(doc: NotebookDocument, cell: NotebookCell) {
        traceVerbose(`Execute Cell ${cell.index} ${getDisplayPath(cell.notebook.uri)}`);
        // Start execution now (from the user's point of view)
        let exec = this.createCellExecutionIfNecessary(cell, new KernelController(this.controller));

        // Connect to a matching kernel if possible (but user may pick a different one)
        let currentContext: 'start' | 'execution' = 'start';
        let kernel: IKernel | undefined;
        let controller: IKernelController = new KernelController(this.controller);
        let kernelStarted = false;
        try {
            kernel = await this.connectToKernel(doc, new DisplayOptions(false));
            kernelStarted = true;
            // If the controller changed, then ensure to create a new cell execution object.
            if (kernel && kernel.controller.id !== controller.id) {
                controller = kernel.controller;
                exec = this.createCellExecutionIfNecessary(cell, kernel.controller);
            }
            currentContext = 'execution';
            if (kernel.controller.id === this.id) {
                this.updateKernelInfoInNotebookWhenAvailable(kernel, doc);
            }
            return await this.kernelProvider.getKernelExecution(kernel).executeCell(cell);
        } catch (ex) {
            if (!isCancellationError(ex)) {
                traceError(`Error in execution`, ex);
            }
            if (!kernelStarted) {
                exec.start();
                exec.clearOutput(cell).then(noop, noop);
            }
            const errorHandler = this.serviceContainer.get<IDataScienceErrorHandler>(IDataScienceErrorHandler);
            ex = WrappedError.unwrap(ex);
            const isCancelled = isCancellationError(ex) || ex instanceof KernelDeadError;
            // If there was a failure connecting or executing the kernel, stick it in this cell
            await endCellAndDisplayErrorsInCell(
                cell,
                controller,
                await errorHandler.getErrorMessageForDisplayInCell(ex, currentContext, doc.uri),
                isCancelled
            );
        }

        // Execution should be ended elsewhere
    }

    private async connectToKernel(doc: NotebookDocument, options: IDisplayOptions): Promise<IKernel> {
        return KernelConnector.connectToNotebookKernel(
            this.kernelConnection,
            this.serviceContainer,
            { resource: doc.uri, notebook: doc, controller: this.controller },
            options,
            this.disposables
        );
    }

    private updateKernelInfoInNotebookWhenAvailable(kernel: IKernel, doc: NotebookDocument) {
        if (this.notebookKernels.get(doc) === kernel) {
            return;
        }
        this.notebookKernels.set(doc, kernel);
        const handlerDisposables: IDisposable[] = [];
        // If the notebook is closed, dispose everything.
        this.notebookApi.onDidCloseNotebookDocument(
            (e) => {
                if (e === doc) {
                    disposeAllDisposables(handlerDisposables);
                }
            },
            this,
            handlerDisposables
        );
        const kernelDisposedDisposable = kernel.onDisposed(() => disposeAllDisposables(handlerDisposables));
        const statusChangeDisposable = kernel.onStatusChanged(async () => {
            if (kernel.disposed || !kernel.info) {
                return;
            }

            // Disregard if we've changed kernels (i.e. if this controller is no longer associated with the document)
            if (!this.associatedDocuments.has(doc)) {
                return;
            }
            await updateNotebookDocumentMetadata(
                doc,
                this.documentManager,
                kernel.kernelConnectionMetadata,
                kernel.info
            );
            if (kernel.info.status === 'ok') {
                disposeAllDisposables(handlerDisposables);
            }
        });

        handlerDisposables.push({ dispose: () => statusChangeDisposable.dispose() });
        handlerDisposables.push({ dispose: () => kernelDisposedDisposable?.dispose() });
    }
    private async onDidSelectController(document: NotebookDocument) {
        const selectedKernelConnectionMetadata = this.connection;
        const existingKernel = this.kernelProvider.get(document);
        if (
            existingKernel &&
            areKernelConnectionsEqual(existingKernel.kernelConnectionMetadata, selectedKernelConnectionMetadata)
        ) {
            traceInfo('Switch kernel did not change kernel.');
            return;
        }

        // Send our SwitchKernel telemetry
        sendKernelTelemetryEvent(document.uri, Telemetry.SwitchKernel);
        // If we have an existing kernel, then we know for a fact the user is changing the kernel.
        // Else VSC is just setting a kernel for a notebook after it has opened.
        if (existingKernel) {
            const telemetryEvent = isLocalConnection(this.kernelConnection)
                ? Telemetry.SelectLocalJupyterKernel
                : Telemetry.SelectRemoteJupyterKernel;
            sendKernelTelemetryEvent(document.uri, telemetryEvent);
            this.notebookApi.notebookEditors
                .filter((editor) => editor.notebook === document)
                .forEach((editor) =>
                    this.postMessage(
                        { message: IPyWidgetMessages.IPyWidgets_onKernelChanged, payload: undefined },
                        editor
                    )
                );
        }

        // Before we start the notebook, make sure the metadata is set to this new kernel.
        await updateNotebookDocumentMetadata(document, this.documentManager, selectedKernelConnectionMetadata);

        if (document.notebookType === InteractiveWindowView) {
            // Possible its an interactive window, in that case we'll create the kernel manually.
            return;
        }
        // Make this the new kernel (calling this method will associate the new kernel with this Uri).
        // Calling `getOrCreate` will ensure a kernel is created and it is mapped to the Uri provided.
        // This will dispose any existing (older kernels) associated with this notebook.
        // This way other parts of extension have access to this kernel immediately after event is handled.
        // Unlike webview notebooks we cannot revert to old kernel if kernel switching fails.
        const newKernel = this.kernelProvider.getOrCreate(document, {
            metadata: selectedKernelConnectionMetadata,
            controller: this.controller,
            resourceUri: document.uri // In the case of interactive window, we cannot pass the Uri of notebook, it must be the Py file or undefined.
        });
        traceVerbose(`KernelProvider switched kernel to id = ${newKernel.kernelConnectionMetadata.id}`);

        // If this is a Python notebook and Python isn't installed, then don't auto-start the kernel.
        if (isPythonKernelConnection(this.kernelConnection) && !this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        // Auto start the local kernels.
        const trustedKernelPaths = this.serviceContainer.get<ITrustedKernelPaths>(ITrustedKernelPaths);
        if (
            !this.configuration.getSettings(undefined).disableJupyterAutoStart &&
            isLocalConnection(this.kernelConnection) &&
            this.kernelConnection.kernelSpec.specFile &&
            trustedKernelPaths.isTrusted(Uri.file(this.kernelConnection.kernelSpec.specFile))
        ) {
            // Startup could fail due to missing dependencies or the like.
            this.connectToKernel(document, new DisplayOptions(true)).catch(noop);
        }
    }
}

async function updateNotebookDocumentMetadata(
    document: NotebookDocument,
    editManager: IDocumentManager,
    kernelConnection?: KernelConnectionMetadata,
    kernelInfo?: Partial<KernelMessage.IInfoReplyMsg['content']>
) {
    let metadata = getNotebookMetadata(document) || { orig_nbformat: 3 };
    const { changed } = await updateNotebookMetadata(metadata, kernelConnection, kernelInfo);
    if (changed) {
        const edit = new WorkspaceEdit();
        // Create a clone.
        const docMetadata = JSON.parse(
            JSON.stringify(
                (document.metadata as {
                    custom?: Exclude<Partial<nbformat.INotebookContent>, 'cells'>;
                }) || { custom: {} }
            )
        );

        docMetadata.custom = docMetadata.custom || {};
        docMetadata.custom.metadata = metadata;
        edit.set(document.uri, [
            NotebookEdit.updateNotebookMetadata({
                ...(document.metadata || {}),
                custom: docMetadata.custom
            })
        ]);
        await editManager.applyEdit(edit);
    }
}
