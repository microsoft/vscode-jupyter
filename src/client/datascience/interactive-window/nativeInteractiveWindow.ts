// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type { nbformat } from '@jupyterlab/coreutils';
import * as path from 'path';
import {
    CancellationError,
    ConfigurationTarget,
    Event,
    EventEmitter,
    NotebookCell,
    NotebookCellData,
    NotebookCellKind,
    NotebookDocument,
    NotebookRange,
    Uri,
    workspace,
    WorkspaceEdit
} from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IWorkspaceService
} from '../../common/application/types';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../common/constants';
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
import { INotebookIdentity, ISubmitNewCell } from '../interactive-common/interactiveWindowTypes';
import { JupyterKernelPromiseFailedError } from '../jupyter/kernels/jupyterKernelPromiseFailedError';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { INotebookControllerManager } from '../notebook/types';
import { VSCodeNotebookController } from '../notebook/vscodeNotebookController';
import { updateNotebookMetadata } from '../notebookStorage/baseModel';
import {
    CellState,
    ICell,
    IInteractiveWindow,
    IInteractiveWindowInfo,
    IInteractiveWindowLoadable,
    IJupyterDebugger,
    INotebookExporter,
    InterruptResult,
    IStatusProvider,
    WebViewViewChangeEventArgs
} from '../types';
import { createInteractiveIdentity } from './identity';
import { cellOutputToVSCCellOutput } from '../notebook/helpers/helpers';
import { generateMarkdownFromCodeLines } from '../../../datascience-ui/common';

export class NativeInteractiveWindow implements IInteractiveWindowLoadable {
    public get onDidChangeViewState(): Event<void> {
        return this._onDidChangeViewState.event;
    }
    public get visible(): boolean {
        return true; // TODO VS Code needs to provide an API for this
    }
    public get active(): boolean {
        return true; // TODO VS Code needs to provide an API for this
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
    public get notebookUri(): Uri {
        return this.notebookDocument.uri;
    }
    public isInteractive = true;
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
        private notebookDocument: NotebookDocument, // This remains the same for the lifetime of the InteractiveWindow object
        private readonly notebookControllerManager: INotebookControllerManager,
        private readonly kernelProvider: IKernelProvider,
        private readonly disposables: IDisposableRegistry,
        private readonly jupyterDebugger: IJupyterDebugger
    ) {
        // Set our owner and first submitter
        this._owner = owner;
        this.mode = mode;
        if (owner) {
            this._submitters.push(owner);
        }

        this.initialControllerSelected = createDeferred<void>();

        // Immediately try to find a selected controller for our NotebookDocument,
        // as it's possible that a selection event fired before our ctor was able to run
        const controller = this.notebookControllerManager.getSelectedNotebookController(this.notebookDocument);
        if (controller !== undefined) {
            this.registerKernel(this.notebookDocument, controller);
            this.initialControllerSelected.resolve();
        }

        // Ensure we hear about any controller changes so we can update our cache accordingly
        this.notebookControllerManager.onNotebookControllerSelected(
            (e: { notebook: NotebookDocument; controller: VSCodeNotebookController }) => {
                if (e.notebook !== this.notebookDocument) {
                    return;
                }

                // Clear cached kernel when the selected controller for this document changes
                const controllerChangeListener = (
                    this.notebookController || e.controller
                ).controller.onDidChangeSelectedNotebooks(
                    (selectedEvent: { notebook: NotebookDocument; selected: boolean }) => {
                        // Controller was deselected for this InteractiveWindow's NotebookDocument
                        if (selectedEvent.selected === false && selectedEvent.notebook === this.notebookDocument) {
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

        workspace.onDidCloseNotebookDocument((notebookDocument) => {
            if (notebookDocument === this.notebookDocument) {
                this.closedEvent.fire(this);
            }
        });
    }

    private registerKernel(notebookDocument: NotebookDocument, controller: VSCodeNotebookController) {
        const kernel = this.kernelProvider.getOrCreate(notebookDocument.uri, {
            metadata: controller.connection,
            controller: controller.controller
        });
        this.kernelLoadPromise = kernel?.start({ disableUI: false, document: notebookDocument });
        this.kernel = kernel;
        this.notebookController = controller;
    }

    public async show(): Promise<void> {
        noop(); // TODO VS Code needs to provide an API for this
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

    public async addMessage(message: string): Promise<void> {
        // Add message to the notebook document
        const edit = new WorkspaceEdit();
        const notebookDocument = this.notebookDocument;
        edit.replaceNotebookCells(
            notebookDocument.uri,
            new NotebookRange(notebookDocument.cellCount, notebookDocument.cellCount),
            [new NotebookCellData(NotebookCellKind.Markup, message, MARKDOWN_LANGUAGE)]
        );
        await workspace.applyEdit(edit);
    }

    public changeMode(mode: InteractiveWindowMode): void {
        if (this.mode !== mode) {
            this.mode = mode;
        }
    }

    public async addCode(code: string, file: Uri): Promise<boolean> {
        await this.updateOwners(file);
        await this.addNotebookCell(code);
        try {
            await this.commandManager.executeCommand('notebook.cell.execute', {
                ranges: [{ start: this.notebookDocument.cellCount - 2, end: this.notebookDocument.cellCount }],
                document: this.notebookDocument.uri,
                autoReveal: true
            });
            return true;
        } catch (e) {
            traceError(e);
            return false;
        }
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
            await this.updateOwners(fileUri);
            const notebookCell = await this.addNotebookCell(code);
            const notebook = this.kernel?.notebook;
            if (!notebook) {
                return false;
            }
            try {
                const finishedAddingCode = createDeferred<void>();

                // Before we try to execute code make sure that we have an initial directory set
                // Normally set via the workspace, but we might not have one here if loading a single loose file
                if (file !== Identifiers.EmptyFileName) {
                    await notebook.setLaunchingFile(file);
                }

                await this.jupyterDebugger.startDebugging(notebook);

                // If the file isn't unknown, set the active kernel's __file__ variable to point to that same file.
                await this.setFileInKernel(file, this.notebookDocument);

                const owningResource = this.owningResource;
                const id = uuid();
                const observable = this.kernel!.notebook!.executeObservable(code, file, line, id, false);
                const temporaryExecution = this.notebookController!.controller.createNotebookCellExecution(
                    notebookCell
                );
                temporaryExecution?.start();

                // Sign up for cell changes
                observable.subscribe(
                    async (cells: ICell[]) => {
                        // Then send the combined output to the UI
                        const converted = (cells[0].data as nbformat.ICodeCell).outputs.map(cellOutputToVSCCellOutput);
                        await temporaryExecution.replaceOutput(converted);

                        // Any errors will move our result to false (if allowed)
                        if (this.configuration.getSettings(owningResource).stopOnError) {
                            result = result && cells.find((c) => c.state === CellState.error) === undefined;
                        }
                    },
                    (error) => {
                        traceError(`Error executing a cell: `, error);
                        if (!(error instanceof CancellationError)) {
                            this.applicationShell.showErrorMessage(error.toString()).then(noop, noop);
                        }
                    },
                    () => {
                        temporaryExecution.end(result);
                        finishedAddingCode.resolve();
                    }
                );

                // Wait for the cell to finish
                await finishedAddingCode.promise;
                traceInfo(`Finished execution for ${id}`);
            } finally {
                await this.jupyterDebugger.stopDebugging(notebook);
            }
        }

        return result;
    }

    // TODO Migrate all of this code into a common command handler
    public async interruptKernel(): Promise<void> {
        // trackKernelResourceInformation(this._notebook?.resource, { interruptKernel: true });
        if (this.kernel && !this.restartingKernel) {
            const status = this.statusProvider.set(
                localize.DataScience.interruptKernelStatus(),
                true,
                undefined,
                undefined,
                this
            );

            try {
                const result = await this.kernel.interrupt(this.notebookDocument);
                status.dispose();

                // We timed out, ask the user if they want to restart instead.
                if (result === InterruptResult.TimedOut && !this.restartingKernel) {
                    const message = localize.DataScience.restartKernelAfterInterruptMessage();
                    const yes = localize.DataScience.restartKernelMessageYes();
                    const no = localize.DataScience.restartKernelMessageNo();
                    const v = await this.applicationShell.showInformationMessage(message, yes, no);
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
        const notebookDocument = this.notebookDocument;

        // Set our status
        const status = this.statusProvider.set(
            localize.DataScience.restartingKernelStatus(),
            true,
            undefined,
            undefined,
            this
        );

        try {
            if (this.kernel && notebookDocument) {
                await this.kernel.restart(notebookDocument);

                // Reset our file in the kernel.
                const fileInKernel = this.fileInKernel;
                this.fileInKernel = undefined;
                if (fileInKernel) {
                    // TODO this should really be done in the IKernel itself
                    await this.setFileInKernel(fileInKernel, notebookDocument);
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
                await this.kernel.restart(notebookDocument!);
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

    public expandAllCells() {
        const edit = new WorkspaceEdit();
        this.notebookDocument.getCells().forEach((cell, index) => {
            const metadata = {
                ...(cell.metadata || {}),
                inputCollapsed: false,
                outputCollapsed: false
            };
            edit.replaceNotebookCellMetadata(this.notebookDocument.uri, index, metadata);
        });
        return workspace.applyEdit(edit);
    }

    public collapseAllCells() {
        const edit = new WorkspaceEdit();
        this.notebookDocument.getCells().forEach((cell, index) => {
            const metadata = { ...(cell.metadata || {}), inputCollapsed: true, outputCollapsed: false };
            edit.replaceNotebookCellMetadata(this.notebookDocument.uri, index, metadata);
        });
        return workspace.applyEdit(edit);
    }

    public scrollToCell(_id: string): void {
        throw new Error('Method not implemented.');
    }

    public hasCell(_id: string): Promise<boolean> {
        throw new Error('Method not implemented.');
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

    private async addNotebookCell(code: string): Promise<NotebookCell> {
        // Ensure we have a controller to execute code against
        // and a NotebookDocument to add the NotebookCell to
        const notebookDocument = this.notebookDocument;
        await this.initialControllerSelected.promise;
        await this.kernelLoadPromise;

        // ensure editor is opened/focused
        await this.commandManager.executeCommand('interactive.open', undefined, notebookDocument.uri);

        // Strip #%% and store it in the cell metadata so we can reconstruct the cell structure when exporting to Python files
        const settings = this.configuration.getSettings();
        const cellMatcher = new CellMatcher(settings);
        const isMarkdown = cellMatcher.getCellType(code) === MARKDOWN_LANGUAGE;
        const strippedCode = isMarkdown
            ? generateMarkdownFromCodeLines(code.splitLines()).join('\n')
            : cellMatcher.stripFirstMarker(code).trimStart();
        const interactiveWindowCellMarker = cellMatcher.getFirstMarker(code);

        // Insert code cell into NotebookDocument
        const edit = new WorkspaceEdit();
        const language =
            workspace.textDocuments.find((document) => document.uri.toString() === this.owner?.toString())
                ?.languageId ?? PYTHON_LANGUAGE;
        const notebookCellData = new NotebookCellData(
            isMarkdown ? NotebookCellKind.Markup : NotebookCellKind.Code,
            strippedCode,
            isMarkdown ? MARKDOWN_LANGUAGE : language
        );
        notebookCellData.metadata = { interactiveWindowCellMarker };
        edit.replaceNotebookCells(
            notebookDocument.uri,
            new NotebookRange(notebookDocument.cellCount, notebookDocument.cellCount),
            [
                notebookCellData // TODO generalize to arbitrary languages and cell types
            ]
        );
        await workspace.applyEdit(edit);
        return notebookDocument.cellAt(notebookDocument.cellCount - 1);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty,@typescript-eslint/no-empty-function
    public async export() {
        // Export requires the python extension
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }

        const { magicCommandsAsComments } = this.configuration.getSettings();
        const cells = generateCellsFromNotebookDocument(this.notebookDocument, magicCommandsAsComments);

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
        // Export requires the python extension
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }

        const { magicCommandsAsComments } = this.configuration.getSettings();
        const cells = generateCellsFromNotebookDocument(this.notebookDocument, magicCommandsAsComments);

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
