// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { injectable, unmanaged } from 'inversify';
import * as path from 'path';
import {
    Disposable,
    NotebookEditor,
    TextEditor,
    TextEditorSelectionChangeEvent,
    WebviewView as vscodeWebviewView
} from 'vscode';

import {
    ICommandManager,
    IDocumentManager,
    IVSCodeNotebook,
    IWebviewViewProvider,
    IWorkspaceService
} from '../../../common/application/types';
import { EXTENSION_ROOT_DIR, isTestExecution } from '../../../common/constants';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../../../common/types';
import { IInteractiveWindowMapping, InteractiveWindowMessages } from '../../interactive-common/interactiveWindowTypes';
import {
    CellState,
    ICell,
    ICodeCssGenerator,
    IJupyterServerUriStorage,
    INotebook,
    INotebookProvider,
    INotebookProviderConnection,
    INotebookStorage,
    IProgress,
    IContextualHelp,
    IStatusProvider,
    IThemeFinder
} from '../../types';
import { WebviewViewHost } from '../../webviews/webviewViewHost';
import { SimpleMessageListener } from '../../interactive-common/simpleMessageListener';
import { traceError } from '../../../common/logger';
import { Commands, Identifiers, Settings } from '../../constants';
import { createCodeCell } from '../../../../datascience-ui/common/cellFactory';
import * as localize from '../../../common/utils/localize';
import { SharedMessages } from '../../messages';
import { isNotebookCell, noop } from '../../../common/utils/misc';
import { nbformat } from '@jupyterlab/coreutils';
import { isNil } from 'lodash';
import { JupyterInvalidKernelError } from '../../jupyter/jupyterInvalidKernelError';
import { kernelConnectionMetadataHasKernelSpec } from '../../jupyter/kernels/helpers';
import { KernelSelector } from '../../jupyter/kernels/kernelSelector';
import { IKernelProvider, KernelConnectionMetadata } from '../../jupyter/kernels/types';

const root = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');

// This is the client side host for the scratch pad (shown in the jupyter tab)
@injectable()
export class ContextualHelp extends WebviewViewHost<IInteractiveWindowMapping>
    implements IDisposable, IProgress, IContextualHelp {
    private vscodeWebView: vscodeWebviewView | undefined;
    private unfinishedCells: ICell[] = [];
    private potentiallyUnfinishedStatus: Disposable[] = [];
    private notebookCellMap = new Map<string, ICell>();

    protected get owningResource(): Resource {
        if (this.vscNotebooks.activeNotebookEditor?.document) {
            return this.vscNotebooks.activeNotebookEditor.document.uri;
        }
        return undefined;
    }
    constructor(
        @unmanaged() readonly configuration: IConfigurationService,
        @unmanaged() cssGenerator: ICodeCssGenerator,
        @unmanaged() themeFinder: IThemeFinder,
        @unmanaged() workspaceService: IWorkspaceService,
        @unmanaged() provider: IWebviewViewProvider,
        @unmanaged() private readonly disposables: IDisposableRegistry,
        @unmanaged() private readonly vscNotebooks: IVSCodeNotebook,
        @unmanaged() private statusProvider: IStatusProvider,
        @unmanaged() private readonly notebookProvider: INotebookProvider,
        @unmanaged() private readonly notebookStorage: INotebookStorage,
        @unmanaged() private readonly serverStorage: IJupyterServerUriStorage,
        @unmanaged() private readonly selector: KernelSelector,
        @unmanaged() private readonly commandManager: ICommandManager,
        @unmanaged() private readonly kernelProvider: IKernelProvider,
        @unmanaged() private readonly documentManager: IDocumentManager
    ) {
        super(
            configuration,
            cssGenerator,
            themeFinder,
            workspaceService,
            (c, d) => new SimpleMessageListener(c, d),
            provider,
            root,
            [path.join(root, 'commons.initial.bundle.js'), path.join(root, 'contextualHelp.js')]
        );

        // Sign up if the active variable view notebook is changed, restarted or updated
        this.vscNotebooks.onDidChangeActiveNotebookEditor(this.activeEditorChanged, this, this.disposables);
        this.documentManager.onDidChangeTextEditorSelection(this.activeSelectionChanged, this, this.disposables);
    }

    // Used to identify this webview in telemetry, not shown to user so no localization
    // for webview views
    public get title(): string {
        return 'contextualHelp';
    }

    public showHelp(editor: TextEditor) {
        // Compute the text for the inspect request
        const range = editor.document.getWordRangeAtPosition(editor.selection.active);
        const text = editor.document.getText(range);

        // Make our inspect request
        this.inspect(text).ignoreErrors();
    }

    public async load(codeWebview: vscodeWebviewView) {
        this.vscodeWebView = codeWebview;
        await super.loadWebview(process.cwd(), codeWebview).catch(traceError);

        // Set the title if there is an active notebook
        if (this.vscodeWebView) {
            await this.activeEditorChanged(this.vscNotebooks.activeNotebookEditor);
        }

        // The UI requires us to say we have cells.
        this.postMessage(InteractiveWindowMessages.LoadAllCells, {
            cells: [],
            isNotebookTrusted: true
        }).ignoreErrors();
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
            case InteractiveWindowMessages.Started:
                // Send the first settings message
                this.onDataScienceSettingsChanged().ignoreErrors();

                // Send the loc strings (skip during testing as it takes up a lot of memory)
                const locStrings = isTestExecution() ? '{}' : localize.getCollectionJSON();
                this.postMessageInternal(SharedMessages.LocInit, locStrings).ignoreErrors();
                break;
            default:
                break;
        }

        // Pass onto our base class.
        super.onMessage(message, payload);
    }

    protected postMessage<M extends IInteractiveWindowMapping, T extends keyof M>(
        type: T,
        payload?: M[T]
    ): Promise<void> {
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

    protected setStatus = (message: string, showInWebView: boolean): Disposable => {
        const result = this.statusProvider.set(message, showInWebView, undefined, undefined, this);
        this.potentiallyUnfinishedStatus.push(result);
        return result;
    };

    protected async inspect(code: string): Promise<boolean> {
        let result = true;
        // Skip if notebook not set
        if (!this.owningResource) {
            return result;
        }

        // Start a status item
        const status = this.setStatus(localize.DataScience.executingCode(), false);

        try {
            // Make sure we're loaded first.
            const notebook = await this.getNotebook();

            if (notebook) {
                const result = await notebook.inspect(code);

                // Turn this into a cell (shortcut to displaying it)
                const cell: ICell = {
                    id: '1',
                    file: Identifiers.EmptyFileName,
                    line: 0,
                    state: CellState.finished,
                    data: createCodeCell([''], (result as unknown) as nbformat.IOutput[])
                };

                // Then send the combined output to the UI
                this.sendCellsToWebView([cell]);
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

    private async getNotebook(): Promise<INotebook | undefined> {
        let notebook: INotebook | undefined;
        if (this.owningResource) {
            try {
                notebook = await this.notebookProvider.getOrCreateNotebook({
                    getOnly: false,
                    identity: this.owningResource,
                    resource: this.owningResource,
                    metadata: await this.getNotebookMetadata(),
                    kernelConnection: await this.getKernelConnection(),
                    disableUI: true
                });
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
                    }
                } else {
                    throw e;
                }
            }
        }
        return notebook;
    }

    private async activeEditorChanged(editor: NotebookEditor | undefined) {
        // Update the state of the control based on editor
        await this.postMessage(InteractiveWindowMessages.HideUI, editor === undefined);

        // Show help right now if the active text editor is a notebook cell
        if (this.documentManager.activeTextEditor && isNotebookCell(this.documentManager.activeTextEditor.document)) {
            this.showHelp(this.documentManager.activeTextEditor);
        }
    }
    private async activeSelectionChanged(e: TextEditorSelectionChangeEvent) {
        if (isNotebookCell(e.textEditor.document)) {
            this.showHelp(e.textEditor);
        }
    }
}
