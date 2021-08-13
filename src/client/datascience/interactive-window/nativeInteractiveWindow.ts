// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type { nbformat } from '@jupyterlab/coreutils';
import * as path from 'path';
import {
    ConfigurationTarget,
    Event,
    EventEmitter,
    NotebookCell,
    NotebookCellData,
    NotebookCellKind,
    NotebookDocument,
    NotebookEditorRevealType,
    NotebookRange,
    Uri,
    workspace,
    WorkspaceEdit,
    notebooks,
    Position,
    Range,
    Selection,
    commands,
    TextEditorRevealType,
    ViewColumn,
    NotebookEditor
} from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IWorkspaceService
} from '../../common/application/types';
import { JVSC_EXTENSION_ID, MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../common/constants';
import { ContextKey } from '../../common/contextKey';
import '../../common/extensions';
import { traceError, traceInfo } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import * as uuid from 'uuid/v4';

import {
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    InteractiveWindowMode,
    Resource
} from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { generateCellsFromNotebookDocument } from '../cellFactory';
import { CellMatcher } from '../cellMatcher';
import { Commands, defaultNotebookFormat, EditorContexts, Identifiers } from '../constants';
import { ExportFormat, IExportDialog } from '../export/types';
import {
    INotebookIdentity,
    InteractiveWindowMessages,
    ISubmitNewCell
} from '../interactive-common/interactiveWindowTypes';
import { JupyterKernelPromiseFailedError } from '../jupyter/kernels/jupyterKernelPromiseFailedError';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { INotebookControllerManager } from '../notebook/types';
import { VSCodeNotebookController } from '../notebook/vscodeNotebookController';
import { updateNotebookMetadata } from '../notebookStorage/baseModel';
import {
    CellState,
    ICellHashProvider,
    IInteractiveWindow,
    IInteractiveWindowInfo,
    IInteractiveWindowLoadable,
    IJupyterDebugger,
    INotebookExporter,
    InterruptResult,
    IStatusProvider,
    WebViewViewChangeEventArgs
} from '../types';
import { createInteractiveIdentity, getInteractiveWindowTitle } from './identity';
import { generateMarkdownFromCodeLines } from '../../../datascience-ui/common';
import { chainWithPendingUpdates } from '../notebook/helpers/notebookUpdater';
import { LineQueryRegex, linkCommandAllowList } from '../interactive-common/linkProvider';
import { INativeInteractiveWindow } from './types';

export class NativeInteractiveWindow implements IInteractiveWindowLoadable {
    public get onDidChangeViewState(): Event<void> {
        return this._onDidChangeViewState.event;
    }
    // Promise that resolves when the interactive window is ready to handle code execution.
    public get readyPromise(): Promise<NotebookEditor> {
        return this._editorReadyPromise;
    }

    public get closed(): Event<IInteractiveWindow> {
        return this.closedEvent.event;
    }
    public get owner(): Resource {
        return this._owner;
    }
    public get submitters(): Uri[] {
        return this._submitters;
    }
    public get identity(): Uri {
        return this._identity;
    }
    public get notebookUri(): Uri | undefined {
        return this.notebookDocument?.uri;
    }
    public notebookController: VSCodeNotebookController | undefined;
    private _onDidChangeViewState = new EventEmitter<void>();
    private closedEvent: EventEmitter<IInteractiveWindow> = new EventEmitter<IInteractiveWindow>();
    private _owner: Uri | undefined;
    private _identity: Uri = createInteractiveIdentity();
    private _submitters: Uri[] = [];
    private mode: InteractiveWindowMode = 'multiple';
    private _kernelConnection?: KernelConnectionMetadata;
    protected fileInKernel: string | undefined;

    private isDisposed = false;
    private restartingKernel = false;
    private kernel: IKernel | undefined;
    private kernelLoadPromise: Promise<void> | undefined;
    private initialControllerSelected: Deferred<void>;
    private _editorReadyPromise: Promise<NotebookEditor>;
    private notebookDocument: NotebookDocument | undefined;
    private executionPromise: Promise<boolean> | undefined;

    constructor(
        private readonly applicationShell: IApplicationShell,
        private readonly documentManager: IDocumentManager,
        private readonly statusProvider: IStatusProvider,
        private readonly fs: IFileSystem,
        private readonly configuration: IConfigurationService,
        private readonly commandManager: ICommandManager,
        private readonly jupyterExporter: INotebookExporter,
        private readonly workspaceService: IWorkspaceService,
        owner: Resource,
        mode: InteractiveWindowMode,
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly exportDialog: IExportDialog,
        private readonly notebookControllerManager: INotebookControllerManager,
        private readonly kernelProvider: IKernelProvider,
        private readonly disposables: IDisposableRegistry,
        private readonly jupyterDebugger: IJupyterDebugger,
        private readonly cellHashProvider: ICellHashProvider
    ) {
        // Set our owner and first submitter
        this._owner = owner;
        this.mode = mode;
        if (owner) {
            this._submitters.push(owner);
        }

        // Wait for a controller to get selected
        this.initialControllerSelected = createDeferred<void>();

        // Request creation of the interactive window from VS Code
        this._editorReadyPromise = this.createReadyPromise();

        workspace.onDidCloseNotebookDocument((notebookDocument) => {
            if (notebookDocument === this.notebookDocument) {
                this.closedEvent.fire(this);
            }
        });
    }

    private async createReadyPromise(): Promise<NotebookEditor> {
        const preferredController = await this.notebookControllerManager.getInteractiveController();
        const controllerId = preferredController ? `${JVSC_EXTENSION_ID}/${preferredController.id}` : undefined;
        const hasOwningFile = this.owner !== undefined;
        const { notebookEditor } = ((await this.commandManager.executeCommand(
            'interactive.open',
            // Keep focus on the owning file if there is one
            { viewColumn: ViewColumn.Beside, preserveFocus: hasOwningFile },
            undefined,
            controllerId,
            this.owner && this.mode === 'perFile' ? getInteractiveWindowTitle(this.owner) : undefined
        )) as unknown) as INativeInteractiveWindow;
        if (!notebookEditor) {
            // This means VS Code failed to create an interactive window.
            // This should never happen.
            throw new Error('Failed to request creation of interactive window from VS Code.');
        }
        this.notebookDocument = notebookEditor.document;
        this.loadController(notebookEditor.document);
        this.initializeRendererCommunication();
        return notebookEditor;
    }

    private initializeRendererCommunication() {
        const messageChannel = notebooks.createRendererMessaging('jupyter-error-renderer');
        this.disposables.push(
            messageChannel.onDidReceiveMessage(async (e) => {
                const message = e.message;
                if (message.message === InteractiveWindowMessages.OpenLink) {
                    const href = message.payload;
                    if (href.startsWith('file')) {
                        await this.openFile(href);
                    } else if (href.startsWith('https://command:')) {
                        const temp: string = href.split(':')[2];
                        const params: string[] = temp.includes('/?') ? temp.split('/?')[1].split(',') : [];
                        let command = temp.split('/?')[0];
                        if (command.endsWith('/')) {
                            command = command.substring(0, command.length - 1);
                        }
                        if (linkCommandAllowList.includes(command)) {
                            await commands.executeCommand(command, params);
                        }
                    } else {
                        this.applicationShell.openUrl(href);
                    }
                }
            })
        );
    }

    private async openFile(fileUri: string) {
        const uri = Uri.parse(fileUri);
        let selection: Range = new Range(new Position(0, 0), new Position(0, 0));
        if (uri.query) {
            // Might have a line number query on the file name
            const lineMatch = LineQueryRegex.exec(uri.query);
            if (lineMatch) {
                const lineNumber = parseInt(lineMatch[1], 10);
                selection = new Range(new Position(lineNumber, 0), new Position(lineNumber, 0));
            }
        }

        // Show the matching editor if there is one
        let editor = this.documentManager.visibleTextEditors.find((e) => this.fs.arePathsSame(e.document.uri, uri));
        if (editor) {
            return this.documentManager
                .showTextDocument(editor.document, { selection, viewColumn: editor.viewColumn })
                .then((e) => {
                    e.revealRange(selection, TextEditorRevealType.InCenter);
                });
        } else {
            // Not a visible editor, try opening otherwise
            return this.commandManager.executeCommand('vscode.open', uri).then(() => {
                // See if that opened a text document
                editor = this.documentManager.visibleTextEditors.find((e) => this.fs.arePathsSame(e.document.uri, uri));
                if (editor) {
                    // Force the selection to change
                    editor.revealRange(selection);
                    editor.selection = new Selection(selection.start, selection.start);
                }
            });
        }
    }

    private loadController(notebookDocument: NotebookDocument) {
        // Immediately try to find a selected controller for our NotebookDocument,
        // as it's possible that a selection event fired before our ctor was able to run
        const controller = this.notebookControllerManager.getSelectedNotebookController(notebookDocument);
        if (controller !== undefined) {
            this.registerKernel(notebookDocument, controller);
            this.initialControllerSelected.resolve();
        }

        // Ensure we hear about any controller changes so we can update our cache accordingly
        this.notebookControllerManager.onNotebookControllerSelected(
            (e: { notebook: NotebookDocument; controller: VSCodeNotebookController }) => {
                if (e.notebook !== notebookDocument) {
                    return;
                }

                // Clear cached kernel when the selected controller for this document changes
                const controllerChangeListener = (
                    this.notebookController || e.controller
                ).controller.onDidChangeSelectedNotebooks(
                    (selectedEvent: { notebook: NotebookDocument; selected: boolean }) => {
                        // Controller was deselected for this InteractiveWindow's NotebookDocument
                        if (selectedEvent.selected === false && selectedEvent.notebook === notebookDocument) {
                            this.kernelLoadPromise = undefined;
                            this.kernel = undefined;
                            this.notebookController = undefined;
                            controllerChangeListener.dispose();
                        }
                    },
                    this,
                    this.disposables
                );

                this.registerKernel(e.notebook, e.controller);
                this.initialControllerSelected.resolve();
            },
            this,
            this.disposables
        );
    }

    private registerKernel(notebookDocument: NotebookDocument, controller: VSCodeNotebookController) {
        const kernel = this.kernelProvider.getOrCreate(notebookDocument, {
            metadata: controller.connection,
            controller: controller.controller,
            resourceUri: this.owner
        });
        this.kernelLoadPromise = kernel?.start({ disableUI: false, document: notebookDocument });
        this.kernel = kernel;
        this.notebookController = controller;
    }

    public async show(): Promise<void> {
        await this.commandManager.executeCommand(
            'interactive.open',
            { preserveFocus: true },
            this.notebookUri,
            undefined,
            undefined
        );
    }

    public dispose() {
        if (this.kernel) {
            this.kernel.dispose().ignoreErrors();
        }
        if (this.closedEvent) {
            this.closedEvent.fire(this);
        }
        this.isDisposed = true;
    }

    // Add message to the notebook document in a markdown cell
    public async addMessage(message: string): Promise<void> {
        const notebookEditor = await this._editorReadyPromise;
        const edit = new WorkspaceEdit();
        const markdownCell = new NotebookCellData(NotebookCellKind.Markup, message, MARKDOWN_LANGUAGE);
        markdownCell.metadata = { isInteractiveWindowMessageCell: true };
        edit.replaceNotebookCells(
            notebookEditor.document.uri,
            new NotebookRange(notebookEditor.document.cellCount, notebookEditor.document.cellCount),
            [markdownCell]
        );
        await workspace.applyEdit(edit);
    }

    public changeMode(mode: InteractiveWindowMode): void {
        if (this.mode !== mode) {
            this.mode = mode;
        }
    }

    public async addCode(code: string, file: Uri, line: number): Promise<boolean> {
        return this.submitCodeImpl(code, file, line, false);
    }

    public async debugCode(code: string, fileUri: Uri, line: number): Promise<boolean> {
        let saved = true;
        const file = fileUri.fsPath;
        // Make sure the file is saved before debugging
        const doc = this.documentManager.textDocuments.find((d) => this.fs.areLocalPathsSame(d.fileName, file));
        if (doc && doc.isUntitled) {
            // Before we start, get the list of documents
            const beforeSave = [...this.documentManager.textDocuments];

            saved = await doc.save();

            // If that worked, we have to open the new document. It should be
            // the new entry in the list
            if (saved) {
                const diff = this.documentManager.textDocuments.filter((f) => beforeSave.indexOf(f) === -1);
                if (diff && diff.length > 0) {
                    fileUri = diff[0].uri;

                    // Open the new document
                    await this.documentManager.openTextDocument(fileUri);
                }
            }
        }

        let result = true;

        // Call the internal method if we were able to save
        if (saved) {
            return this.submitCodeImpl(code, fileUri, line, true);
        }

        return result;
    }

    private async submitCodeImpl(code: string, fileUri: Uri, line: number, isDebug: boolean) {
        // Do not execute or render empty cells
        const cellMatcher = new CellMatcher(this.configuration.getSettings(this.owningResource));
        if (cellMatcher.stripFirstMarker(code).length === 0) {
            return true;
        }
        // Chain execution promises so that cells are executed in the right order
        if (this.executionPromise) {
            this.executionPromise = this.executionPromise.then(() =>
                this.createExecutionPromise(code, fileUri, line, isDebug)
            );
        } else {
            this.executionPromise = this.createExecutionPromise(code, fileUri, line, isDebug);
        }
        return this.executionPromise;
    }

    private async createExecutionPromise(code: string, fileUri: Uri, line: number, isDebug: boolean) {
        const notebookEditor = await this._editorReadyPromise;
        await this.updateOwners(fileUri);
        const id = uuid();

        // Compute isAtBottom based on last notebook cell before adding a notebook cell,
        // since the notebook cell we're going to add is by definition not visible
        const isLastCellVisible = notebookEditor?.visibleRanges.find((r) => {
            return r.end === notebookEditor.document.cellCount - 1;
        });
        const notebookCell = await this.addNotebookCell(notebookEditor.document, code, fileUri, line, id);
        const settings = this.configuration.getSettings();
        // The default behavior is to scroll to the last cell if the user is already at the bottom
        // of the history, but not to scroll if the user has scrolled somewhere in the middle
        // of the history. The jupyter.alwaysScrollOnNewCell setting overrides this to always scroll
        // to newly-inserted cells.
        if (settings.alwaysScrollOnNewCell || isLastCellVisible) {
            this.revealCell(notebookCell, notebookEditor);
        }

        const notebook = this.kernel?.notebook;
        if (!notebook) {
            return false;
        }
        const file = fileUri.fsPath;
        let result = true;
        try {
            // Before we try to execute code make sure that we have an initial directory set
            // Normally set via the workspace, but we might not have one here if loading a single loose file
            if (file !== Identifiers.EmptyFileName) {
                await notebook.setLaunchingFile(file);
            }

            if (isDebug) {
                await this.kernel!.executeHidden(
                    `import os;os.environ["IPYKERNEL_CELL_NAME"] = '${file.replace(/\\/g, '\\\\')}'`,
                    file,
                    notebookEditor.document
                );
                await this.jupyterDebugger.startDebugging(notebook);
            }

            // If the file isn't unknown, set the active kernel's __file__ variable to point to that same file.
            await this.setFileInKernel(file, notebookEditor.document);

            await this.cellHashProvider.addCellHash(notebookCell);
            await this.kernel!.executeCell(notebookCell);

            traceInfo(`Finished execution for ${id}`);
        } finally {
            if (isDebug) {
                await this.jupyterDebugger.stopDebugging(notebook);
            }
        }
        return result;
    }

    // TODO Migrate all of this code into a common command handler
    public async interruptKernel(): Promise<void> {
        // trackKernelResourceInformation(this._notebook?.resource, { interruptKernel: true });
        const notebookEditor = await this._editorReadyPromise;
        if (this.kernel && !this.restartingKernel) {
            const status = this.statusProvider.set(
                localize.DataScience.interruptKernelStatus(),
                true,
                undefined,
                undefined,
                this
            );

            try {
                const result = await this.kernel.interrupt(notebookEditor.document);
                status.dispose();

                // We timed out, ask the user if they want to restart instead.
                if (result === InterruptResult.TimedOut && !this.restartingKernel) {
                    const message = localize.DataScience.restartKernelAfterInterruptMessage();
                    const yes = localize.DataScience.restartKernelMessageYes();
                    const no = localize.DataScience.restartKernelMessageNo();
                    const v = await this.applicationShell.showInformationMessage(message, { modal: true }, yes, no);
                    if (v === yes) {
                        await this.restartKernelInternal();
                    }
                } else if (result === InterruptResult.Restarted) {
                    // Uh-oh, keyboard interrupt crashed the kernel.
                    // this.addSysInfo(SysInfoReason.Interrupt).ignoreErrors(); // This should be handled in kernel.ts
                }
            } catch (err) {
                status.dispose();
                traceError(err);
                this.applicationShell.showErrorMessage(err).then(noop, noop);
            }
        }
    }

    // TODO Migrate all of this code into a common command handler
    public async restartKernel(): Promise<void> {
        if (this.kernel && !this.restartingKernel) {
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
                        await this.restartKernelInternal();
                    } else if (v === yes) {
                        await this.restartKernelInternal();
                    }
                } else {
                    await this.restartKernelInternal();
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

    private async restartKernelInternal(): Promise<void> {
        this.restartingKernel = true;
        const notebookEditor = await this._editorReadyPromise;

        // Set our status
        const status = this.statusProvider.set(
            localize.DataScience.restartingKernelStatus(),
            true,
            undefined,
            undefined,
            this
        );

        try {
            if (this.kernel && notebookEditor) {
                await this.kernel.restart(notebookEditor.document);

                // Reset our file in the kernel.
                const fileInKernel = this.fileInKernel;
                this.fileInKernel = undefined;
                if (fileInKernel) {
                    // TODO this should really be done in the IKernel itself
                    await this.setFileInKernel(fileInKernel, notebookEditor.document);
                }

                // // Compute if dark or not.
                // const knownDark = await this.isDark();

                // // Before we run any cells, update the dark setting
                // await this.kernel?.notebook?.setMatplotLibStyle(knownDark);
            }
        } catch (exc) {
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server
            if (exc instanceof JupyterKernelPromiseFailedError && this.kernel) {
                await this.kernel.dispose();
                await this.kernel.restart(notebookEditor.document);
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

    public undoCells() {
        throw new Error('Method not implemented.');
    }

    public redoCells() {
        throw new Error('Method not implemented.');
    }

    public removeAllCells() {
        throw new Error('Method not implemented.');
    }

    public async exportCells() {
        throw new Error('Method not implemented.');
    }

    public async expandAllCells() {
        const notebookEditor = await this._editorReadyPromise;
        const edit = new WorkspaceEdit();
        notebookEditor.document.getCells().forEach((cell, index) => {
            const metadata = {
                ...(cell.metadata || {}),
                inputCollapsed: false,
                outputCollapsed: false
            };
            edit.replaceNotebookCellMetadata(notebookEditor.document.uri, index, metadata);
        });
        await workspace.applyEdit(edit);
    }

    public async collapseAllCells() {
        const notebookEditor = await this._editorReadyPromise;
        const edit = new WorkspaceEdit();
        notebookEditor.document.getCells().forEach((cell, index) => {
            if (cell.kind !== NotebookCellKind.Code) {
                return;
            }
            const metadata = { ...(cell.metadata || {}), inputCollapsed: true, outputCollapsed: false };
            edit.replaceNotebookCellMetadata(notebookEditor.document.uri, index, metadata);
        });
        await workspace.applyEdit(edit);
    }

    public async scrollToCell(id: string): Promise<void> {
        const notebookEditor = await this._editorReadyPromise;
        const matchingCell = notebookEditor.document.getCells().find((cell) => cell.metadata.executionId === id);
        if (matchingCell) {
            this.revealCell(matchingCell, notebookEditor);
        }
    }

    private revealCell(notebookCell: NotebookCell, notebookEditor: NotebookEditor) {
        const notebookRange = new NotebookRange(notebookCell.index, notebookCell.index + 1);
        // This will always try to reveal the whole cell--input + output combined
        setTimeout(() => {
            notebookEditor.revealRange(notebookRange, NotebookEditorRevealType.Default);
        }, 200); // Rendering output is async so the output is not guaranteed to immediately exist
    }

    // TODO this does not need to be async since we no longer need to roundtrip to the UI
    public async hasCell(id: string): Promise<boolean> {
        const notebookEditor = await this._editorReadyPromise;
        if (!notebookEditor) {
            return false;
        }
        return notebookEditor.document.getCells().find((cell) => cell.metadata.executionId === id) !== undefined;
    }

    public get owningResource(): Resource {
        if (this.owner) {
            return this.owner;
        }
        const root = this.workspaceService.rootPath;
        if (root) {
            return Uri.file(root);
        }
        return undefined;
    }

    protected async onViewStateChanged(_args: WebViewViewChangeEventArgs) {
        this._onDidChangeViewState.fire();
    }

    protected get notebookMetadata(): Readonly<nbformat.INotebookMetadata> | undefined {
        return undefined;
    }

    protected get kernelConnection(): Readonly<KernelConnectionMetadata> | undefined {
        return this._kernelConnection;
    }

    protected async updateNotebookOptions(kernelConnection: KernelConnectionMetadata): Promise<void> {
        this._kernelConnection = kernelConnection;
    }

    protected get notebookIdentity(): INotebookIdentity {
        // Use this identity for the lifetime of the notebook
        return {
            resource: this._identity,
            type: 'interactive'
        };
    }

    protected updateContexts(info: IInteractiveWindowInfo | undefined) {
        // This should be called by the python interactive window every
        // time state changes. We use this opportunity to update our
        // extension contexts
        const interactiveContext = new ContextKey(EditorContexts.HaveInteractive, this.commandManager);
        interactiveContext.set(!this.isDisposed).catch(noop);
        const interactiveCellsContext = new ContextKey(EditorContexts.HaveInteractiveCells, this.commandManager);
        const redoableContext = new ContextKey(EditorContexts.HaveRedoableCells, this.commandManager);
        const hasCellSelectedContext = new ContextKey(EditorContexts.HaveCellSelected, this.commandManager);
        if (info) {
            interactiveCellsContext.set(info.cellCount > 0).catch(noop);
            redoableContext.set(info.redoCount > 0).catch(noop);
            hasCellSelectedContext.set(info.selectedCell ? true : false).catch(noop);
        } else {
            interactiveCellsContext.set(false).catch(noop);
            redoableContext.set(false).catch(noop);
            hasCellSelectedContext.set(false).catch(noop);
        }
    }

    protected async setFileInKernel(file: string, notebookDocument: NotebookDocument): Promise<void> {
        // If in perFile mode, set only once
        if (this.mode === 'perFile' && !this.fileInKernel && this.kernel && file !== Identifiers.EmptyFileName) {
            this.fileInKernel = file;
            await this.kernel.executeHidden(`__file__ = '${file.replace(/\\/g, '\\\\')}'`, file, notebookDocument);
        } else if (
            (!this.fileInKernel || !this.fs.areLocalPathsSame(this.fileInKernel, file)) &&
            this.mode !== 'perFile' &&
            this.kernel &&
            file !== Identifiers.EmptyFileName
        ) {
            // Otherwise we need to reset it every time
            this.fileInKernel = file;
            await this.kernel.executeHidden(`__file__ = '${file.replace(/\\/g, '\\\\')}'`, file, notebookDocument);
        }
    }

    private async updateOwners(file: Uri) {
        // Update the owner for this window if not already set
        if (!this._owner) {
            this._owner = file;
        }

        // Add to the list of 'submitters' for this window.
        if (!this._submitters.find((s) => this.fs.areLocalPathsSame(s.fsPath, file.fsPath))) {
            this._submitters.push(file);
        }

        // Make sure our web panel opens.
        await this.show();
    }

    private async addNotebookCell(
        notebookDocument: NotebookDocument,
        code: string,
        file: Uri,
        line: number,
        id: string
    ): Promise<NotebookCell> {
        // Ensure we have a controller to execute code against
        if (!this.notebookController) {
            await this.commandManager.executeCommand('notebook.selectKernel');
        }
        await this.initialControllerSelected.promise;
        await this.kernelLoadPromise;

        // ensure editor is opened but not focused
        await this.commandManager.executeCommand(
            'interactive.open',
            { preserveFocus: true },
            notebookDocument.uri,
            this.notebookController?.id,
            undefined
        );

        // Strip #%% and store it in the cell metadata so we can reconstruct the cell structure when exporting to Python files
        const settings = this.configuration.getSettings();
        const cellMatcher = new CellMatcher(settings);
        const isMarkdown = cellMatcher.getCellType(code) === MARKDOWN_LANGUAGE;
        const strippedCode = isMarkdown
            ? generateMarkdownFromCodeLines(code.splitLines()).join('\n')
            : cellMatcher.stripFirstMarker(code).trim();
        const interactiveWindowCellMarker = cellMatcher.getFirstMarker(code);

        // Insert cell into NotebookDocument
        const language =
            workspace.textDocuments.find((document) => document.uri.toString() === this.owner?.toString())
                ?.languageId ?? PYTHON_LANGUAGE;
        const notebookCellData = new NotebookCellData(
            isMarkdown ? NotebookCellKind.Markup : NotebookCellKind.Code,
            strippedCode,
            isMarkdown ? MARKDOWN_LANGUAGE : language
        );
        notebookCellData.metadata = {
            inputCollapsed: !isMarkdown && settings.collapseCellInputCodeByDefault,
            interactiveWindowCellMarker,
            interactive: {
                file: file.fsPath,
                line: line
            },
            executionId: id
        };
        await chainWithPendingUpdates(notebookDocument, (edit) => {
            edit.replaceNotebookCells(
                notebookDocument.uri,
                new NotebookRange(notebookDocument.cellCount, notebookDocument.cellCount),
                [notebookCellData]
            );
        });
        return notebookDocument.cellAt(notebookDocument.cellCount - 1);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty,@typescript-eslint/no-empty-function
    public async export() {
        const notebookEditor = await this._editorReadyPromise;
        // Export requires the python extension
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }

        const { magicCommandsAsComments } = this.configuration.getSettings();
        const cells = generateCellsFromNotebookDocument(notebookEditor.document, magicCommandsAsComments);

        // Should be an array of cells
        if (cells && this.exportDialog) {
            // Bring up the export file dialog box
            const uri = await this.exportDialog.showDialog(ExportFormat.ipynb, this.owningResource);
            if (uri) {
                await this.jupyterExporter.exportToFile(cells, uri.fsPath);
            }
        }
    }

    public async exportAs() {
        const notebookEditor = await this._editorReadyPromise;
        // Export requires the python extension
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }

        const { magicCommandsAsComments } = this.configuration.getSettings();
        const cells = generateCellsFromNotebookDocument(notebookEditor.document, magicCommandsAsComments);

        // Pull out the metadata from our active notebook
        const metadata: nbformat.INotebookMetadata = { orig_nbformat: defaultNotebookFormat.major };
        if (this.kernel) {
            updateNotebookMetadata(metadata, this.kernel.kernelConnectionMetadata);
        }

        // Turn the cells into a json object
        const json = await this.jupyterExporter.translateToNotebook(cells, undefined, metadata.kernelspec);

        // Turn this into a string
        const contents = JSON.stringify(json, undefined, 4);

        let defaultFileName;
        if (this.submitters && this.submitters.length) {
            const lastSubmitter = this.submitters[this.submitters.length - 1];
            defaultFileName = path.basename(lastSubmitter.fsPath, path.extname(lastSubmitter.fsPath));
        }

        // Then run the export command with these contents
        this.commandManager
            .executeCommand(
                Commands.Export,
                contents,
                this.owningResource,
                defaultFileName,
                this.kernel?.kernelConnectionMetadata.interpreter
            )
            .then(noop, noop);
    }

    /// The following are implemented only for compliance with the IInteractiveWindow
    /// interface and can be deleted once the native notebooks API migration is complete.

    public get title() {
        return '';
    }

    public startProgress() {
        noop();
    }

    public stopProgress() {
        noop();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public onMessage(_message: string, _payload: any) {
        noop();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected async submitNewCell(_info: ISubmitNewCell) {
        noop();
    }

    public createWebviewCellButton(
        _buttonId: string,
        _callback: (cell: NotebookCell, isInteractive: boolean, resource: Uri) => Promise<void>,
        _codicon: string,
        _statusToEnable: CellState[],
        _tooltip: string
    ): IDisposable {
        return { dispose: noop };
    }
}
