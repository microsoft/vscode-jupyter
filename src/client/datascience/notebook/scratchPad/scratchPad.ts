// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { injectable, unmanaged } from 'inversify';
import * as path from 'path';
import * as fsextra from 'fs-extra';
import {
    CancellationError,
    ConfigurationTarget,
    Disposable,
    NotebookCell,
    NotebookEditor,
    NotebookEditorRevealType,
    NotebookRange,
    Uri,
    WebviewView as vscodeWebviewView
} from 'vscode';

import {
    IApplicationShell,
    ICommandManager,
    IVSCodeNotebook,
    IWebviewViewProvider,
    IWorkspaceService
} from '../../../common/application/types';
import { EXTENSION_ROOT_DIR, isTestExecution, PYTHON_LANGUAGE } from '../../../common/constants';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../../../common/types';
import {
    ICopyCode,
    IInteractiveWindowMapping,
    InteractiveWindowMessages,
    IReExecuteCells
} from '../../interactive-common/interactiveWindowTypes';
import {
    CellState,
    ICell,
    ICodeCssGenerator,
    IDataScienceErrorHandler,
    IInteractiveWindowListener,
    IJupyterServerUriStorage,
    INotebook,
    INotebookProvider,
    INotebookProviderConnection,
    INotebookStorage,
    InterruptResult,
    IProgress,
    IScratchPad,
    IStatusProvider,
    IThemeFinder
} from '../../types';
import { WebviewViewHost } from '../../webviews/webviewViewHost';
import { INotebookWatcher } from '../types';
import { SimpleMessageListener } from '../../interactive-common/simpleMessageListener';
import { traceError, traceInfo, traceWarning } from '../../../common/logger';
import { Commands, Identifiers, Settings } from '../../constants';
import { createCodeCell, createErrorOutput } from '../../../../datascience-ui/common/cellFactory';
import * as localize from '../../../common/utils/localize';
import { SharedMessages } from '../../messages';
import { noop } from '../../../common/utils/misc';
import { JupyterKernelPromiseFailedError } from '../../jupyter/kernels/jupyterKernelPromiseFailedError';
import { serializeLanguageConfiguration } from '../../interactive-common/serialization';
import { nbformat } from '@jupyterlab/coreutils';
import { createDeferred, Deferred } from '../../../common/utils/async';
import { CellMatcher } from '../../cellMatcher';
import { combineData, translateKernelLanguageToMonaco } from '../../common';
import { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import { isNil } from 'lodash';
import { JupyterInvalidKernelError } from '../../jupyter/jupyterInvalidKernelError';
import {
    getDisplayNameOrNameOfKernelConnection,
    getKernelConnectionLanguage,
    kernelConnectionMetadataHasKernelSpec
} from '../../jupyter/kernels/helpers';
import { KernelSelector } from '../../jupyter/kernels/kernelSelector';
import { IKernelProvider, KernelConnectionMetadata } from '../../jupyter/kernels/types';
import { addNewCellAfter } from '../helpers/executionHelpers';
import { createJupyterCellFromVSCNotebookCell } from '../helpers/helpers';

const root = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'notebook');

// This is the client side host for the scratch pad (shown in the jupyter tab)
@injectable()
export class ScratchPad extends WebviewViewHost<IInteractiveWindowMapping>
    implements IDisposable, IProgress, IScratchPad {
    private vscodeWebView: vscodeWebviewView | undefined;
    private restartingKernel: boolean = false;
    private unfinishedCells: ICell[] = [];
    private potentiallyUnfinishedStatus: Disposable[] = [];
    private notebookCellMap = new Map<string, ICell>();
    private lastOwningResource: Resource;
    private getAllCellsPromise: Deferred<ICell[]> | undefined;
    private notebookSignup = new Set<INotebook>();

    protected get owningResource(): Resource {
        if (this.vscNotebooks.activeNotebookEditor?.document) {
            return this.vscNotebooks.activeNotebookEditor.document.uri;
        }
        return undefined;
    }
    constructor(
        @unmanaged() private readonly listeners: IInteractiveWindowListener[],
        @unmanaged() private readonly configuration: IConfigurationService,
        @unmanaged() cssGenerator: ICodeCssGenerator,
        @unmanaged() themeFinder: IThemeFinder,
        @unmanaged() workspaceService: IWorkspaceService,
        @unmanaged() provider: IWebviewViewProvider,
        @unmanaged() private readonly disposables: IDisposableRegistry,
        @unmanaged() private readonly notebookWatcher: INotebookWatcher,
        @unmanaged() private readonly vscNotebooks: IVSCodeNotebook,
        @unmanaged() private statusProvider: IStatusProvider,
        @unmanaged() private readonly applicationShell: IApplicationShell,
        @unmanaged() private readonly errorHandler: IDataScienceErrorHandler,
        @unmanaged() private readonly notebookProvider: INotebookProvider,
        @unmanaged() private readonly notebookStorage: INotebookStorage,
        @unmanaged() private readonly serverStorage: IJupyterServerUriStorage,
        @unmanaged() private readonly selector: KernelSelector,
        @unmanaged() private readonly commandManager: ICommandManager,
        @unmanaged() private readonly kernelProvider: IKernelProvider
    ) {
        super(
            configuration,
            cssGenerator,
            themeFinder,
            workspaceService,
            (c, d) => new SimpleMessageListener(c, d),
            provider,
            root,
            [
                path.join(root, 'require.js'),
                path.join(root, 'ipywidgets.js'),
                path.join(root, 'monaco.bundle.js'),
                path.join(root, 'commons.initial.bundle.js'),
                path.join(root, 'scratchPad.js')
            ]
        );

        // Sign up if the active variable view notebook is changed, restarted or updated
        this.notebookWatcher.onDidExecuteActiveNotebook(this.activeNotebookExecuted, this, this.disposables);
        this.notebookWatcher.onDidChangeActiveNotebook(this.activeNotebookChanged, this, this.disposables);
        this.notebookWatcher.onDidRestartActiveNotebook(this.activeNotebookRestarted, this, this.disposables);
        this.vscNotebooks.onDidChangeActiveNotebookEditor(this.activeEditorChanged, this, this.disposables);
        this.kernelProvider.onKernelChanged(this.kernelChanged, this, this.disposables);

        // For each listener sign up for their post events
        this.listeners.forEach((l) => l.postMessage((e) => this.postMessageInternal(e.message, e.payload)));
        // Channel for listeners to send messages to the scratch pad
        this.listeners.forEach((l) => {
            if (l.postInternalMessage) {
                l.postInternalMessage((e) => this.onMessage(e.message, e.payload));
            }
        });
    }

    // Used to identify this webview in telemetry, not shown to user so no localization
    // for webview views
    public get title(): string {
        return 'scratchPad';
    }

    public loadCell(input: NotebookCell) {
        const cell: ICell = {
            id: '1',
            file: Identifiers.EmptyFileName,
            line: 0,
            state: CellState.finished,
            data: createJupyterCellFromVSCNotebookCell(input)
        };

        // Replace the source in our single cell with the new results
        this.postMessage(InteractiveWindowMessages.LoadAllCells, {
            cells: [cell],
            isNotebookTrusted: true
        }).ignoreErrors();

        // Update our map
        if (this.owningResource) {
            this.notebookCellMap.set(this.owningResource.toString(), cell);
        }
    }

    public async load(codeWebview: vscodeWebviewView) {
        this.vscodeWebView = codeWebview;
        await super.loadWebview(process.cwd(), codeWebview).catch(traceError);

        // Set the title if there is an active notebook
        if (this.vscodeWebView) {
            await this.activeEditorChanged(this.vscNotebooks.activeNotebookEditor);
            await this.activeNotebookChanged({
                notebook: this.notebookWatcher.activeNotebook,
                executionCount: this.notebookWatcher.activeNotebookExecutionCount
            });
        }
    }

    public startProgress() {
        this.postMessage(InteractiveWindowMessages.StartProgress).ignoreErrors();
    }

    public stopProgress() {
        this.postMessage(InteractiveWindowMessages.StopProgress).ignoreErrors();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case InteractiveWindowMessages.ConvertUriForUseInWebViewRequest:
                const request = payload as Uri;
                const response = { request, response: this.asWebviewUri(request) };
                this.postMessageToListeners(InteractiveWindowMessages.ConvertUriForUseInWebViewResponse, response);
                break;

            case InteractiveWindowMessages.Started:
                // Send the first settings message
                this.onDataScienceSettingsChanged().ignoreErrors();

                // Send the loc strings (skip during testing as it takes up a lot of memory)
                const locStrings = isTestExecution() ? '{}' : localize.getCollectionJSON();
                this.postMessageInternal(SharedMessages.LocInit, locStrings).ignoreErrors();
                break;

            case InteractiveWindowMessages.CopyCodeCell:
                this.handleMessage(message, payload, this.copyCode);
                break;

            case InteractiveWindowMessages.LoadTmLanguageRequest:
                this.handleMessage(message, payload, this.requestTmLanguage);
                break;

            case InteractiveWindowMessages.LoadOnigasmAssemblyRequest:
                this.handleMessage(message, payload, this.requestOnigasm);
                break;
            case InteractiveWindowMessages.ReExecuteCells:
                this.handleMessage(message, payload, this.reexecuteCells);
                break;
            case InteractiveWindowMessages.ReturnAllCells:
                this.handleMessage(message, payload, this.handleReturnAllCells);
                break;
            case InteractiveWindowMessages.RestartKernel:
                this.restartKernel().ignoreErrors();
                break;

            case InteractiveWindowMessages.Interrupt:
                this.interruptKernel().ignoreErrors();
                break;

            default:
                break;
        }

        // Let our listeners handle the message too
        this.postMessageToListeners(message, payload);

        // Pass onto our base class.
        super.onMessage(message, payload);
    }

    protected async reexecuteCells(info: IReExecuteCells): Promise<void> {
        try {
            for (let i = 0; i < info.cellIds.length; i += 1) {
                const cell: ICell = {
                    id: info.cellIds[i],
                    file: Identifiers.EmptyFileName,
                    line: 0,
                    state: CellState.executing,
                    data: createCodeCell(info.code[i])
                };
                await this.reexecuteCell(cell, info.code[i]);
            }
        } catch (exc) {
            // Tell the other side we restarted the kernel. This will stop all executions
            this.postMessage(InteractiveWindowMessages.RestartKernel).ignoreErrors();

            // Handle an error
            await this.errorHandler.handleError(exc);
        } finally {
        }
    }

    protected postMessage<M extends IInteractiveWindowMapping, T extends keyof M>(
        type: T,
        payload?: M[T]
    ): Promise<void> {
        // First send to our listeners
        this.postMessageToListeners(type.toString(), payload);

        // Then send it to the webview
        return super.postMessage(type, payload);
    }

    // Handle message helper function to specifically handle our message mapping type
    protected handleMessage<M extends IInteractiveWindowMapping, T extends keyof M>(
        _message: T,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: any,
        handler: (args: M[T]) => void
    ) {
        const args = payload as M[T];
        handler.bind(this)(args);
    }

    protected async clearResult(id: string): Promise<void> {
        const notebook = await this.getNotebook(false);
        if (notebook) {
            notebook.clear(id);
        }
    }

    protected sendCellsToWebView(cells: ICell[]) {
        // Send each cell to the other side
        cells.forEach((cell: ICell) => {
            switch (cell.state) {
                case CellState.init:
                    // Tell the react controls we have a new cell
                    this.postMessage(InteractiveWindowMessages.StartCell, cell).ignoreErrors();

                    // Keep track of this unfinished cell so if we restart we can finish right away.
                    this.unfinishedCells.push(cell);
                    break;

                case CellState.executing:
                    // Tell the react controls we have an update
                    this.postMessage(InteractiveWindowMessages.UpdateCellWithExecutionResults, cell).ignoreErrors();
                    break;

                case CellState.error:
                case CellState.finished:
                    // Tell the react controls we're done
                    this.postMessage(InteractiveWindowMessages.FinishCell, {
                        cell,
                        notebookIdentity: this.owningResource!
                    }).ignoreErrors();

                    // Remove from the list of unfinished cells
                    this.unfinishedCells = this.unfinishedCells.filter((c) => c.id !== cell.id);
                    break;

                default:
                    break; // might want to do a progress bar or something
            }
        });

        // Update our current cell state
        if (this.owningResource) {
            this.notebookCellMap.set(this.owningResource.toString(), cells[0]);
        }
    }

    private handleReturnAllCells(cells: ICell[]) {
        // See what we're waiting for.
        if (this.getAllCellsPromise) {
            this.getAllCellsPromise.resolve(cells);
        }
    }

    private copyCode(args: ICopyCode) {
        return this.copyCodeInternal(args.source).catch((err) => {
            this.applicationShell.showErrorMessage(err).then(noop, noop);
        });
    }

    private async copyCodeInternal(source: string) {
        let editor = this.vscNotebooks.activeNotebookEditor;
        if (!editor) {
            // Find the first visible notebook editor if nothing is visible
            const notebookEditors = this.vscNotebooks.notebookEditors;
            if (notebookEditors.length > 0) {
                editor = notebookEditors[0];
            }
        }
        if (editor) {
            return this.copyCodeToNotebook(editor, source);
        }
    }

    private async copyCodeToNotebook(editor: NotebookEditor, source: string) {
        // Add a new cell with our source
        var lastCell = editor.document.cellAt(editor.document.cellCount - 1);
        await addNewCellAfter(lastCell, source);

        // Make sure this cell is shown to the user
        editor.revealRange(
            new NotebookRange(lastCell.index + 1, lastCell.index + 1),
            NotebookEditorRevealType.InCenterIfOutsideViewport
        );
    }

    private async reexecuteCell(cell: ICell, code: string): Promise<void> {
        try {
            // If there's any payload, it has the code and the id
            if (cell.id && cell.data.cell_type !== 'messages') {
                traceInfo(`Executing cell ${cell.id}`);

                // Clear the result if we've run before
                await this.clearResult(cell.id);

                // Clear 'per run' data passed to WebView before execution
                if (cell.data.metadata.tags !== undefined) {
                    cell.data.metadata.tags = cell.data.metadata.tags.filter((t) => t !== 'outputPrepend');
                }

                // Send to ourselves.
                await this.submitCode(code, Identifiers.EmptyFileName, 0, cell.id, cell.data);
            }
        } catch (exc) {
            traceInfo(`Exception executing cell ${cell.id}: `, exc);

            // Make this error our cell output
            this.sendCellsToWebView([
                {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    data: { ...cell.data, outputs: [createErrorOutput(exc)] } as any, // nyc compiler issue
                    id: cell.id,
                    file: Identifiers.EmptyFileName,
                    line: 0,
                    state: CellState.error
                }
            ]);

            throw exc;
        } finally {
            if (cell && cell.id) {
                traceInfo(`Finished executing cell ${cell.id}`);
            }
        }
    }

    protected setStatus = (message: string, showInWebView: boolean): Disposable => {
        const result = this.statusProvider.set(message, showInWebView, undefined, undefined, this);
        this.potentiallyUnfinishedStatus.push(result);
        return result;
    };

    protected async submitCode(
        code: string,
        file: string,
        line: number,
        id: string,
        data?: nbformat.ICodeCell | nbformat.IRawCell | nbformat.IMarkdownCell
    ): Promise<boolean> {
        let result = true;
        // Do not execute or render empty code cells
        const cellMatcher = new CellMatcher(this.configService.getSettings(this.owningResource));
        if (cellMatcher.stripFirstMarker(code).length === 0) {
            return result;
        }

        // Skip if notebook not set
        if (!this.owningResource) {
            return result;
        }

        // Start a status item
        const status = this.setStatus(localize.DataScience.executingCode(), false);

        // Create a deferred object that will wait until the status is disposed
        const finishedAddingCode = createDeferred<void>();
        const actualDispose = status.dispose.bind(status);
        status.dispose = () => {
            finishedAddingCode.resolve();
            actualDispose();
        };

        try {
            // Make sure we're loaded first.
            const notebook = await this.getNotebook(false);

            if (notebook) {
                const owningResource = this.owningResource;
                const observable = notebook.executeObservable(code, file, line, id, false);

                // Sign up for cell changes
                observable.subscribe(
                    (cells: ICell[]) => {
                        // Combine the cell data with the possible input data (so we don't lose anything that might have already been in the cells)
                        const combined = cells.map(combineData.bind(undefined, data));

                        // Then send the combined output to the UI
                        this.sendCellsToWebView(combined);

                        // Any errors will move our result to false (if allowed)
                        if (this.configuration.getSettings(owningResource).stopOnError) {
                            result = result && cells.find((c) => c.state === CellState.error) === undefined;
                        }
                    },
                    (error) => {
                        traceError(`Error executing a cell: `, error);
                        status.dispose();
                        if (!(error instanceof CancellationError)) {
                            this.applicationShell.showErrorMessage(error.toString()).then(noop, noop);
                        }
                    },
                    () => {
                        // Indicate executing until this cell is done.
                        status.dispose();
                    }
                );

                // Wait for the cell to finish
                await finishedAddingCode.promise;
                traceInfo(`Finished execution for ${id}`);
            }
        } finally {
            status.dispose();
        }

        return result;
    }

    private async getNotebookMetadata(): Promise<nbformat.INotebookMetadata | undefined> {
        if (this.owningResource) {
            const model = await this.notebookStorage.getOrCreateModel({ file: this.owningResource!, isNative: true });
            return model.metadata;
        }
    }

    protected async getKernelConnection(): Promise<Readonly<KernelConnectionMetadata> | undefined> {
        if (this.owningResource) {
            const kernel = this.kernelProvider.get(this.owningResource);
            if (kernel) {
                return kernel.kernelConnectionMetadata;
            }
        }
    }

    protected async getServerDisplayName(serverConnection: INotebookProviderConnection | undefined): Promise<string> {
        const serverUri = await this.serverStorage.getUri();
        // If we don't have a server connection, make one if remote. We need the remote connection in order
        // to compute the display name. However only do this if the user is allowing auto start.
        if (
            !serverConnection &&
            serverUri !== Settings.JupyterServerLocalLaunch &&
            !this.configService.getSettings(this.owningResource).disableJupyterAutoStart
        ) {
            serverConnection = await this.notebookProvider.connect({
                disableUI: true,
                resource: this.owningResource,
                metadata: await this.getNotebookMetadata()
            });
        }
        let displayName =
            serverConnection?.displayName ||
            (!serverConnection?.localLaunch ? serverConnection?.url : undefined) ||
            (serverUri === Settings.JupyterServerLocalLaunch || !serverUri
                ? localize.DataScience.localJupyterServer()
                : localize.DataScience.serverNotStarted());

        if (serverConnection) {
            // Determine the connection URI of the connected server to display
            if (serverConnection.localLaunch) {
                displayName = localize.DataScience.localJupyterServer();
            } else {
                // Log this remote URI into our MRU list
                await this.serverStorage.addToUriList(
                    !isNil(serverConnection.url) ? serverConnection.url : serverConnection.displayName,
                    Date.now(),
                    serverConnection.displayName
                );
            }
        }

        return displayName;
    }

    private listenToNotebook(notebook: INotebook | undefined) {
        if (notebook && !this.notebookSignup.has(notebook)) {
            this.notebookSignup.add(notebook);
            const statusChangeHandler = async (status: ServerStatus) => {
                const connectionMetadata = notebook.getKernelConnection();
                const name = getDisplayNameOrNameOfKernelConnection(connectionMetadata);

                await this.postMessage(InteractiveWindowMessages.UpdateKernel, {
                    jupyterServerStatus: status,
                    serverName: await this.getServerDisplayName(notebook.connection),
                    kernelName: name,
                    language: translateKernelLanguageToMonaco(
                        getKernelConnectionLanguage(connectionMetadata) || PYTHON_LANGUAGE
                    )
                });
            };
            notebook.onSessionStatusChanged(statusChangeHandler);

            // Fire the status changed handler at least once (might have already been running and so won't show a status update)
            statusChangeHandler(notebook.status).ignoreErrors();
        }
    }

    private async getNotebook(getOnly: boolean): Promise<INotebook | undefined> {
        let notebook: INotebook | undefined;
        while (!notebook && this.owningResource) {
            try {
                notebook = await this.notebookProvider.getOrCreateNotebook({
                    getOnly,
                    identity: this.owningResource,
                    resource: this.owningResource,
                    metadata: await this.getNotebookMetadata(),
                    kernelConnection: await this.getKernelConnection(),
                    disableUI: getOnly
                });
                if (notebook) {
                    const executionActivation = { ...this.owningResource, owningResource: this.owningResource };
                    this.postMessageToListeners(
                        InteractiveWindowMessages.NotebookExecutionActivated,
                        executionActivation
                    );
                    this.listenToNotebook(notebook);
                } else if (getOnly) {
                    break;
                }
            } catch (e) {
                // If we get an invalid kernel error, make sure to ask the user to switch
                if (
                    e instanceof JupyterInvalidKernelError &&
                    this.configService.getSettings(this.owningResource).jupyterServerType ===
                        Settings.JupyterServerLocalLaunch
                ) {
                    // Ask the user for a new local kernel
                    const newKernel = await this.selector.askForLocalKernel(
                        this.owningResource,
                        undefined,
                        e.kernelConnectionMetadata
                    );
                    if (newKernel && kernelConnectionMetadataHasKernelSpec(newKernel) && newKernel.kernelSpec) {
                        this.commandManager
                            .executeCommand(
                                Commands.SetJupyterKernel,
                                newKernel,
                                this.owningResource,
                                this.owningResource
                            )
                            .then(noop, noop);
                    } else {
                        break;
                    }
                } else {
                    throw e;
                }
            }
        }
        return notebook;
    }

    private async restartKernel(_internal: boolean = false): Promise<void> {
        const notebook = await this.getNotebook(true);
        if (notebook && !this.restartingKernel) {
            this.restartingKernel = true;
            this.startProgress();

            try {
                if (await this.shouldAskForRestart()) {
                    // Ask the user if they want us to restart or not.
                    const message = localize.DataScience.restartKernelMessage();
                    const yes = localize.DataScience.restartKernelMessageYes();
                    const dontAskAgain = localize.DataScience.restartKernelMessageDontAskAgain();
                    const no = localize.DataScience.restartKernelMessageNo();

                    const v = await this.applicationShell.showInformationMessage(message, yes, dontAskAgain, no);
                    if (v === dontAskAgain) {
                        await this.disableAskForRestart();
                        await this.restartKernelInternal(notebook);
                    } else if (v === yes) {
                        await this.restartKernelInternal(notebook);
                    }
                } else {
                    await this.restartKernelInternal(notebook);
                }
            } finally {
                this.restartingKernel = false;
                this.stopProgress();
            }
        }
    }

    private async shouldAskForRestart(): Promise<boolean> {
        const settings = this.configuration.getSettings(this.owningResource);
        return settings && settings.askForKernelRestart === true;
    }

    private async disableAskForRestart(): Promise<void> {
        const settings = this.configuration.getSettings(this.owningResource);
        if (settings) {
            this.configuration
                .updateSetting('askForKernelRestart', false, undefined, ConfigurationTarget.Global)
                .ignoreErrors();
        }
    }

    private finishOutstandingCells() {
        if (this.owningResource) {
            this.unfinishedCells.forEach((c) => {
                c.state = CellState.error;
                this.postMessage(InteractiveWindowMessages.FinishCell, {
                    cell: c,
                    notebookIdentity: this.owningResource!
                }).ignoreErrors();
            });
            this.unfinishedCells = [];
            this.potentiallyUnfinishedStatus.forEach((s) => s.dispose());
            this.potentiallyUnfinishedStatus = [];
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private postMessageToListeners(message: string, payload: any) {
        if (this.listeners) {
            this.listeners.forEach((l) => l.onMessage(message, payload));
        }
    }

    // The active variable view notebook has executed a new cell so update the execution count in the variable view
    private async activeNotebookExecuted(args: { executionCount: number }) {
        this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
            executionCount: args.executionCount
        }).ignoreErrors();
    }

    private async activeEditorChanged(editor: NotebookEditor | undefined) {
        if (this.vscodeWebView) {
            this.vscodeWebView.title = editor
                ? localize.DataScience.scratchPadTitleFormat().format(path.basename(editor.document.uri.fsPath))
                : localize.DataScience.scratchPadTitleEmpty();
        }

        // If we had an existing owner, make sure to save its cells
        if (this.lastOwningResource) {
            this.getAllCellsPromise = createDeferred<ICell[]>();
            await this.postMessage(InteractiveWindowMessages.GetAllCells);
            const cells = await this.getAllCellsPromise.promise;
            this.notebookCellMap.set(this.lastOwningResource.toString(), cells[0]);
            this.getAllCellsPromise = undefined;
        }
        this.lastOwningResource = this.owningResource;

        // Reset the cell to whatever was last seen for this notebook
        if (this.owningResource) {
            const cell = this.notebookCellMap.get(this.owningResource.toString()) || {
                id: '1',
                file: Identifiers.EmptyFileName,
                line: 0,
                state: CellState.finished,
                data: createCodeCell('')
            };
            await this.postMessage(InteractiveWindowMessages.LoadAllCells, {
                cells: [cell],
                isNotebookTrusted: true
            });

            // Update our map
            this.notebookCellMap.set(this.owningResource.toString(), cell);
        }

        // Tell each listener our new identity
        if (this.owningResource) {
            this.listeners.forEach((l) =>
                l.onMessage(InteractiveWindowMessages.NotebookIdentity, {
                    resource: this.owningResource,
                    type: 'native'
                })
            );
        }

        // Update the state of the control based on editor
        await this.postMessage(InteractiveWindowMessages.HideUI, editor === undefined);
    }

    // The active notebook has changed, so force a refresh on the view to pick up the new info
    private async activeNotebookChanged(arg: { notebook?: INotebook; executionCount?: number }) {
        // Sign up for notebook changes if we haven't already.
        if (arg.notebook) {
            this.listenToNotebook(arg.notebook);
        } else if (!arg.notebook && this.owningResource) {
            // Editor doesn't have a notebook, but likely still has a server status
            this.kernelChanged().ignoreErrors();
        }
    }

    private async kernelChanged() {
        if (this.owningResource) {
            const kernel = await this.kernelProvider.get(this.owningResource);
            const notebook = await this.getNotebook(true);
            if (kernel?.kernelConnectionMetadata) {
                const name = getDisplayNameOrNameOfKernelConnection(kernel?.kernelConnectionMetadata);

                await this.postMessage(InteractiveWindowMessages.UpdateKernel, {
                    jupyterServerStatus: notebook ? notebook.status : ServerStatus.Idle,
                    serverName: await this.getServerDisplayName(notebook?.connection),
                    kernelName: name,
                    language: translateKernelLanguageToMonaco(
                        getKernelConnectionLanguage(kernel?.kernelConnectionMetadata) || PYTHON_LANGUAGE
                    )
                });
            }
        }
    }

    private async activeNotebookRestarted() {
        this.postMessage(InteractiveWindowMessages.RestartKernel).ignoreErrors();
    }

    public async interruptKernel(): Promise<void> {
        const notebook = await this.getNotebook(true);
        if (notebook && !this.restartingKernel) {
            const status = this.statusProvider.set(
                localize.DataScience.interruptKernelStatus(),
                true,
                undefined,
                undefined,
                this
            );

            try {
                const settings = this.configuration.getSettings(this.owningResource);
                const interruptTimeout = settings.jupyterInterruptTimeout;

                const result = await notebook.interruptKernel(interruptTimeout);
                status.dispose();

                // We timed out, ask the user if they want to restart instead.
                if (result === InterruptResult.TimedOut && !this.restartingKernel) {
                    const message = localize.DataScience.restartKernelAfterInterruptMessage();
                    const yes = localize.DataScience.restartKernelMessageYes();
                    const no = localize.DataScience.restartKernelMessageNo();
                    const v = await this.applicationShell.showInformationMessage(message, yes, no);
                    if (v === yes) {
                        await this.restartKernelInternal(notebook);
                    }
                }
            } catch (err) {
                status.dispose();
                traceError(err);
                this.applicationShell.showErrorMessage(err).then(noop, noop);
            }
        }
    }

    private async requestTmLanguage(languageId: string) {
        // Get the contents of the appropriate tmLanguage file.
        traceInfo('Request for tmlanguage file.');
        const languageJson = await this.themeFinder.findTmLanguage(languageId);
        const languageConfiguration = serializeLanguageConfiguration(
            await this.themeFinder.findLanguageConfiguration(languageId)
        );
        const extensions = languageId === PYTHON_LANGUAGE ? ['.py'] : [];
        const scopeName = `scope.${languageId}`; // This works for python, not sure about c# etc.
        this.postMessage(InteractiveWindowMessages.LoadTmLanguageResponse, {
            languageJSON: languageJson ?? '',
            languageConfiguration,
            extensions,
            scopeName,
            languageId
        }).ignoreErrors();
    }

    private async requestOnigasm(): Promise<void> {
        // Look for the file next or our current file (this is where it's installed in the vsix)
        let filePath = path.join(__dirname, 'node_modules', 'onigasm', 'lib', 'onigasm.wasm');
        traceInfo(`Request for onigasm file at ${filePath}`);
        if (await fsextra.pathExists(filePath)) {
            const contents = await fsextra.readFile(filePath);
            this.postMessage(InteractiveWindowMessages.LoadOnigasmAssemblyResponse, contents).ignoreErrors();
        } else {
            // During development it's actually in the node_modules folder
            filePath = path.join(EXTENSION_ROOT_DIR, 'node_modules', 'onigasm', 'lib', 'onigasm.wasm');
            traceInfo(`Backup request for onigasm file at ${filePath}`);
            if (await fsextra.pathExists(filePath)) {
                const contents = await fsextra.readFile(filePath);
                this.postMessage(InteractiveWindowMessages.LoadOnigasmAssemblyResponse, contents).ignoreErrors();
            } else {
                traceWarning('Onigasm file not found. Colorization will not be available.');
                this.postMessage(InteractiveWindowMessages.LoadOnigasmAssemblyResponse).ignoreErrors();
            }
        }
    }

    private async restartKernelInternal(notebook: INotebook | undefined): Promise<void> {
        this.restartingKernel = true;

        // First we need to finish all outstanding cells.
        this.finishOutstandingCells();

        // Set our status
        const status = this.statusProvider.set(
            localize.DataScience.restartingKernelStatus(),
            true,
            undefined,
            undefined,
            this
        );

        try {
            if (notebook) {
                await notebook.restartKernel((await this.generateDataScienceExtraSettings()).jupyterInterruptTimeout);

                // Compute if dark or not.
                const knownDark = await this.isDark();

                // Before we run any cells, update the dark setting
                await notebook.setMatplotLibStyle(knownDark);
            }
        } catch (exc) {
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server
            if (exc instanceof JupyterKernelPromiseFailedError && notebook) {
                await notebook.dispose();
            } else {
                // Show the error message
                this.applicationShell.showErrorMessage(exc).then(noop, noop);
                traceError(exc);
            }
        } finally {
            status.dispose();
            this.restartingKernel = false;
        }
    }
}
