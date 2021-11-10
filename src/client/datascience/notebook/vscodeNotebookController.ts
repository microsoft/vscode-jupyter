// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { join } from 'path';
import {
    Disposable,
    EventEmitter,
    languages,
    NotebookCell,
    NotebookCellKind,
    NotebookController,
    NotebookControllerAffinity,
    NotebookDocument,
    NotebookEditor,
    NotebookRendererScript,
    Uri
} from 'vscode';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { disposeAllDisposables } from '../../common/helpers';
import { traceInfo, traceInfoIfCI } from '../../common/logger';
import { getDisplayPath } from '../../common/platform/fs-paths';
import {
    IBrowserService,
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    IExtensionContext,
    IPathUtils
} from '../../common/types';
import { Common, DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { ConsoleForegroundColors } from '../../logging/_global';
import { EnvironmentType } from '../../pythonEnvironments/info';
import { sendNotebookOrKernelLanguageTelemetry } from '../common';
import { Commands, Telemetry } from '../constants';
import { IPyWidgetMessages } from '../interactive-common/interactiveWindowTypes';
import { NotebookIPyWidgetCoordinator } from '../ipywidgets/notebookIPyWidgetCoordinator';
import {
    areKernelConnectionsEqual,
    getRemoteKernelSessionInformation,
    isPythonKernelConnection,
    getKernelConnectionPath
} from '../jupyter/kernels/helpers';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { InterpreterPackages } from '../telemetry/interpreterPackages';
import {
    initializeInteractiveOrNotebookTelemetryBasedOnUserAction,
    sendKernelTelemetryEvent,
    trackKernelResourceInformation
} from '../telemetry/telemetry';
import { KernelSocketInformation } from '../types';
import { NotebookCellLanguageService } from './cellLanguageService';
import { InteractiveWindowView } from './constants';
import { isJupyterNotebook, traceCellMessage, updateNotebookDocumentMetadata } from './helpers/helpers';

export class VSCodeNotebookController implements Disposable {
    private readonly _onNotebookControllerSelected: EventEmitter<{
        notebook: NotebookDocument;
        controller: VSCodeNotebookController;
    }>;
    private readonly _onNotebookControllerSelectionChanged = new EventEmitter<void>();
    private readonly _onDidDispose = new EventEmitter<void>();
    private readonly disposables: IDisposable[] = [];
    private notebookKernels = new WeakMap<NotebookDocument, IKernel>();
    public readonly controller: NotebookController;
    /**
     * Used purely for testing purposes.
     */
    public static kernelAssociatedWithDocument?: boolean;
    private isDisposed = false;
    get id() {
        return this.controller.id;
    }

    get label() {
        return this.controller.label;
    }

    get connection() {
        return this.kernelConnection;
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

    private readonly associatedDocuments = new WeakSet<NotebookDocument>();
    constructor(
        private readonly kernelConnection: KernelConnectionMetadata,
        id: string,
        viewType: string,
        label: string,
        private readonly notebookApi: IVSCodeNotebook,
        private readonly commandManager: ICommandManager,
        private readonly kernelProvider: IKernelProvider,
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        private readonly context: IExtensionContext,
        private readonly pathUtils: IPathUtils,
        disposableRegistry: IDisposableRegistry,
        private readonly languageService: NotebookCellLanguageService,
        private readonly workspace: IWorkspaceService,
        private readonly localOrRemoteKernel: 'local' | 'remote',
        private readonly interpreterPackages: InterpreterPackages,
        private readonly configuration: IConfigurationService,
        private readonly widgetCoordinator: NotebookIPyWidgetCoordinator,
        private readonly documentManager: IDocumentManager,
        private readonly appShell: IApplicationShell,
        private readonly browser: IBrowserService
    ) {
        disposableRegistry.push(this);
        this._onNotebookControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: VSCodeNotebookController;
        }>();

        this.controller = this.notebookApi.createNotebookController(
            id,
            viewType,
            label,
            this.handleExecution.bind(this),
            this.getRendererScripts()
        );

        // Fill in extended info for our controller
        this.controller.interruptHandler = this.handleInterrupt.bind(this);
        this.controller.description = getKernelConnectionPath(kernelConnection, this.pathUtils, this.workspace);
        this.controller.detail =
            kernelConnection.kind === 'connectToLiveKernel' ? getRemoteKernelSessionInformation(kernelConnection) : '';
        this.controller.kind = getKernelConnectionCategory(kernelConnection);
        this.controller.supportsExecutionOrder = true;
        this.controller.supportedLanguages = this.languageService.getSupportedLanguages(kernelConnection);
        // Hook up to see when this NotebookController is selected by the UI
        this.controller.onDidChangeSelectedNotebooks(this.onDidChangeSelectedNotebooks, this, this.disposables);
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

    public dispose() {
        if (!this.isDisposed) {
            this.isDisposed = true;
            this._onNotebookControllerSelected.dispose();
            this._onNotebookControllerSelectionChanged.dispose();
            this.controller.dispose();
        }
        this._onDidDispose.fire();
        this._onDidDispose.dispose();
        disposeAllDisposables(this.disposables);
    }

    public async updateNotebookAffinity(notebook: NotebookDocument, affinity: NotebookControllerAffinity) {
        traceInfo(`Setting controller affinity for ${getDisplayPath(notebook.uri)} ${this.id}`);
        this.controller.updateNotebookAffinity(notebook, affinity);
    }

    // Handle the execution of notebook cell
    private async handleExecution(cells: NotebookCell[], notebook: NotebookDocument) {
        if (cells.length < 1) {
            traceInfoIfCI('No cells passed to handleExecution');
            return;
        }
        // When we receive a cell execute request, first ensure that the notebook is trusted.
        // If it isn't already trusted, block execution until the user trusts it.
        if (!this.workspace.isTrusted) {
            return;
        }
        initializeInteractiveOrNotebookTelemetryBasedOnUserAction(notebook.uri, this.connection);
        sendKernelTelemetryEvent(notebook.uri, Telemetry.ExecuteCell);
        // Notebook is trusted. Continue to execute cells
        traceInfo(`Execute Cells request ${cells.length} ${cells.map((cell) => cell.index).join(', ')}`);
        await Promise.all(cells.map((cell) => this.executeCell(notebook, cell)));
    }
    private warnWhenUsingOutdatedPython() {
        const pyVersion = this.kernelConnection.interpreter?.version;
        if (
            !pyVersion ||
            pyVersion.major >= 4 ||
            (this.kernelConnection.kind !== 'startUsingKernelSpec' &&
                this.kernelConnection.kind !== 'startUsingPythonInterpreter')
        ) {
            return;
        }

        if (pyVersion.major < 3 || (pyVersion.major === 3 && pyVersion.minor <= 5)) {
            void this.appShell
                .showWarningMessage(
                    DataScience.warnWhenSelectingKernelWithUnSupportedPythonVersion(),
                    Common.learnMore()
                )
                .then((selection) => {
                    if (selection !== Common.learnMore()) {
                        return;
                    }
                    return this.browser.launch('https://aka.ms/jupyterUnSupportedPythonKernelVersions');
                });
        }
    }
    private async onDidChangeSelectedNotebooks(event: { notebook: NotebookDocument; selected: boolean }) {
        traceInfoIfCI(
            `NotebookController selection event called for notebook ${event.notebook.uri.toString()} & controller ${
                this.id
            }. Selected ${event.selected} `
        );
        if (this.associatedDocuments.has(event.notebook) && event.selected) {
            // Possible it gets called again in our tests (due to hacks for testing purposes).
            return;
        }
        if (!event.selected) {
            // If user has selectd another controller, then kill the current kernel.
            // Possible user selected a controller that's not contributed by us at all.
            const kernel = this.kernelProvider.get(event.notebook);
            if (kernel?.kernelConnectionMetadata.id === this.kernelConnection.id) {
                void kernel.dispose();
            }
            this.associatedDocuments.delete(event.notebook);
            this._onNotebookControllerSelectionChanged.fire();
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
        traceInfoIfCI(`Notebook Controller set ${getDisplayPath(event.notebook.uri)}, ${this.id}`);
        this.associatedDocuments.add(event.notebook);

        // Now actually handle the change
        this.widgetCoordinator.setActiveController(event.notebook, this);
        await this.onDidSelectController(event.notebook);
        await this.updateCellLanguages(event.notebook);

        // If this NotebookController was selected, fire off the event
        this._onNotebookControllerSelected.fire({ notebook: event.notebook, controller: this });
        this._onNotebookControllerSelectionChanged.fire();
    }
    /**
     * Scenario 1:
     * Assume user opens a notebook and language is C++ or .NET Interactive, they start writing python code.
     * Next users hits the run button, next user will be promtped to select a kernel.
     * User now selects a Python kernel.
     * Nothing happens, that's right nothing happens.
     * This is because C++ is not a lanaugage supported by the python kernel.
     * Hence VS Code will not send the execution call to the extension.
     *
     * Solution, go through the cells and change the languges to something that's supported.
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
        return [
            join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'require.js'),
            join(this.context.extensionPath, 'out', 'ipywidgets', 'dist', 'ipywidgets.js'),
            join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'ipywidgetsKernel.js'),
            join(this.context.extensionPath, 'out', 'fontAwesome', 'fontAwesomeLoader.js')
        ].map((uri) => new NotebookRendererScript(Uri.file(uri)));
    }

    private handleInterrupt(notebook: NotebookDocument) {
        notebook.getCells().forEach((cell) => traceCellMessage(cell, 'Cell cancellation requested'));
        this.commandManager
            .executeCommand(Commands.NotebookEditorInterruptKernel, notebook.uri)
            .then(noop, (ex) => console.error(ex));
    }

    private executeCell(doc: NotebookDocument, cell: NotebookCell) {
        traceInfo(`Execute Cell ${cell.index} ${getDisplayPath(cell.notebook.uri)}`);
        const kernel = this.kernelProvider.getOrCreate(cell.notebook, {
            metadata: this.kernelConnection,
            controller: this.controller,
            resourceUri: doc.uri
        });
        this.updateKernelInfoInNotebookWhenAvailable(kernel, doc);
        return kernel.executeCell(cell);
    }

    private updateKernelInfoInNotebookWhenAvailable(kernel: IKernel, doc: NotebookDocument) {
        if (this.notebookKernels.get(doc) === kernel) {
            return;
        }
        this.notebookKernels.set(doc, kernel);
        let kernelSocket: KernelSocketInformation | undefined;
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
        const saveKernelInfo = () => {
            const kernelId = kernelSocket?.options.id;
            if (!kernelId) {
                return;
            }
            traceInfo(`Updating preferred kernel for remote notebook ${kernelId}`);
            this.preferredRemoteKernelIdProvider.storePreferredRemoteKernelId(doc.uri, kernelId).catch(noop);
        };

        const kernelDisposedDisposable = kernel.onDisposed(() => disposeAllDisposables(handlerDisposables));
        const subscriptionDisposables = kernel.kernelSocket.subscribe((item) => {
            kernelSocket = item;
            saveKernelInfo();
        });
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
            if (this.kernelConnection.kind === 'startUsingKernelSpec') {
                if (kernel.info.status === 'ok') {
                    saveKernelInfo();
                } else {
                    disposeAllDisposables(handlerDisposables);
                }
            } else {
                disposeAllDisposables(handlerDisposables);
            }
        });

        handlerDisposables.push({ dispose: () => subscriptionDisposables.unsubscribe() });
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
        switch (this.connection.kind) {
            case 'startUsingPythonInterpreter':
                sendNotebookOrKernelLanguageTelemetry(Telemetry.SwitchToExistingKernel, PYTHON_LANGUAGE);
                break;
            case 'connectToLiveKernel':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    this.connection.kernelModel.language
                );
                break;
            case 'startUsingKernelSpec':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    this.connection.kernelSpec.language
                );
                break;
            default:
            // We don't know as its the default kernel on Jupyter server.
        }
        trackKernelResourceInformation(document.uri, { kernelConnection: this.connection });
        sendKernelTelemetryEvent(document.uri, Telemetry.SwitchKernel);
        // If we have an existing kernel, then we know for a fact the user is changing the kernel.
        // Else VSC is just setting a kernel for a notebook after it has opened.
        if (existingKernel) {
            const telemetryEvent =
                this.localOrRemoteKernel === 'local'
                    ? Telemetry.SelectLocalJupyterKernel
                    : Telemetry.SelectRemoteJupyterKernel;
            sendKernelTelemetryEvent(document.uri, telemetryEvent);
            this.notebookApi.notebookEditors
                .filter((editor) => editor.document === document)
                .forEach((editor) =>
                    this.postMessage(
                        { message: IPyWidgetMessages.IPyWidgets_onKernelChanged, payload: undefined },
                        editor
                    )
                );
        }
        if (selectedKernelConnectionMetadata.interpreter) {
            this.interpreterPackages.trackPackages(selectedKernelConnectionMetadata.interpreter);
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
        traceInfo(`KernelProvider switched kernel to id = ${newKernel.kernelConnectionMetadata.id}`);

        // Auto start the local kernels.
        if (
            !this.configuration.getSettings(undefined).disableJupyterAutoStart &&
            this.localOrRemoteKernel === 'local'
        ) {
            await newKernel.start({ disableUI: true }).catch(noop);
        }
    }
}

function getKernelConnectionCategory(kernelConnection: KernelConnectionMetadata) {
    switch (kernelConnection.kind) {
        case 'connectToLiveKernel':
            return DataScience.kernelCategoryForJupyterSession();
        case 'startUsingKernelSpec':
            return DataScience.kernelCategoryForJupyterKernel();
        case 'startUsingPythonInterpreter': {
            switch (kernelConnection.interpreter.envType) {
                case EnvironmentType.Conda:
                    return DataScience.kernelCategoryForConda();
                case EnvironmentType.Pipenv:
                    return DataScience.kernelCategoryForPipEnv();
                case EnvironmentType.Poetry:
                    return DataScience.kernelCategoryForPoetry();
                case EnvironmentType.Pyenv:
                    return DataScience.kernelCategoryForPyEnv();
                case EnvironmentType.Venv:
                case EnvironmentType.VirtualEnv:
                case EnvironmentType.VirtualEnvWrapper:
                    return DataScience.kernelCategoryForVirtual();
                default:
                    return DataScience.kernelCategoryForGlobal();
            }
        }
    }
}
