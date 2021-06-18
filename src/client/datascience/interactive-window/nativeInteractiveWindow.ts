// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type { nbformat } from '@jupyterlab/coreutils';
import * as path from 'path';
import * as uuid from 'uuid';
import { CancellationToken, ConfigurationTarget, Event, EventEmitter, NotebookCell, NotebookCellData, NotebookCellKind, NotebookDocument, NotebookRange, Uri, ViewColumn, workspace, WorkspaceEdit } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IWorkspaceService
} from '../../common/application/types';
import { ContextKey } from '../../common/contextKey';
import '../../common/extensions';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';

import {
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    InteractiveWindowMode,
    Resource
} from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { generateCellsFromDocument } from '../cellFactory';
import { Commands, defaultNotebookFormat, EditorContexts, Identifiers } from '../constants';
import { ExportFormat, IExportDialog } from '../export/types';
import {
    INotebookIdentity,
    ISubmitNewCell
} from '../interactive-common/interactiveWindowTypes';
import { JupyterKernelPromiseFailedError } from '../jupyter/kernels/jupyterKernelPromiseFailedError';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { InteractiveWindowView } from '../notebook/constants';
import { chainWithPendingUpdates } from '../notebook/helpers/notebookUpdater';
import { INotebookControllerManager } from '../notebook/types';
import { updateNotebookMetadata } from '../notebookStorage/baseModel';
import {
    CellState,
    ICell,
    IInteractiveWindow,
    IInteractiveWindowInfo,
    IInteractiveWindowLoadable,
    INotebookExporter,
    InterruptResult,
    IStatusProvider,
    WebViewViewChangeEventArgs
} from '../types';
import { createInteractiveIdentity } from './identity';
import { INativeInteractiveWindow } from './types';

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
    public isInteractive = true;
    private _onDidChangeViewState = new EventEmitter<void>();
    private closedEvent: EventEmitter<IInteractiveWindow> = new EventEmitter<IInteractiveWindow>();
    private _owner: Uri | undefined;
    private _identity: Uri = createInteractiveIdentity();
    private _submitters: Uri[] = [];
    private mode: InteractiveWindowMode = 'multiple';
    private _kernelConnection?: KernelConnectionMetadata;
    protected fileInKernel: string | undefined;

    private loadPromise: Thenable<INativeInteractiveWindow>;
    private kernel: IKernel | undefined;
    private isDisposed = false;
    private restartingKernel = false;

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
        private readonly kernelProvider: IKernelProvider
    ) {
        // Set our owner and first submitter
        this._owner = owner;
        this.mode = mode;
        if (owner) {
            this._submitters.push(owner);
        }

        // For now, VS Code returns us the NotebookDocument URI and the InputEditor URI from this command
        this.loadPromise = this.commandManager.executeCommand('interactive.open', ViewColumn.Beside) as Thenable<INativeInteractiveWindow>;
    }

    // Until we get an InteractiveEditor instance back from VS Code we
    // can't know when the InteractiveEditor is disposed except at the
    // point when we try to access it. Calling this method may cause this
    // InteractiveWindow object to dispose itself
    private async tryGetMatchingNotebookDocument(): Promise<NotebookDocument | undefined> {
        const { notebookUri } = await this.loadPromise;
        const notebookDocument = workspace.notebookDocuments.find((document) => notebookUri.toString() === document.uri.toString());
        if (notebookDocument === undefined) {
            this.dispose();
            return undefined;
        }
        return notebookDocument;
    }

    public async show(): Promise<void> {
        await this.loadPromise;
        return;
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
        const notebookDocument = await this.tryGetMatchingNotebookDocument();
        if (!notebookDocument) {
            return;
        }
        edit.replaceNotebookCells(notebookDocument.uri, new NotebookRange(notebookDocument.cellCount, notebookDocument.cellCount), [
            new NotebookCellData(NotebookCellKind.Markup, message, 'markdown')
        ])
        await workspace.applyEdit(edit);
    }

    public changeMode(mode: InteractiveWindowMode): void {
        if (this.mode !== mode) {
            this.mode = mode;
        }
    }

    private async getOrCreateInteractiveEditor(): Promise<NotebookDocument> {
        // Ensure all notebook controllers are loaded so that
        // interactive window execution requests are properly handled
        await this.notebookControllerManager.loadNotebookControllers();

        let { notebookUri } = await this.loadPromise;

        const loadKernelPromise = new Promise<void>(resolve => {
            const listener = this.notebookControllerManager.onNotebookControllerSelected(async e => {
                const { notebook } = e;
                if (notebook.notebookType !== InteractiveWindowView) {
                    return;
                }

                // Ensure the controller was selected for our notebook
                const notebookDocument = await this.tryGetMatchingNotebookDocument();
                if (notebookDocument !== notebook) {
                    return;
                }

                // Update the cached kernel for this controller
                const kernel = this.kernelProvider.getOrCreate(notebookDocument.uri, {
                    metadata: e.controller.connection,
                    controller: e.controller.controller
                });

                await kernel?.start({ disableUI: false, document: notebookDocument });
                this.kernel = kernel;
                resolve();
                listener.dispose();
            });
        });

        let notebookDocument = workspace.notebookDocuments.find((document) => notebookUri.toString() === document.uri.toString());

        // User closed the previous interactive window. Make a new one
        // TODO here we should just dispose ourselves
        if (!notebookDocument) {
            this.loadPromise = this.commandManager.executeCommand('interactive.open', ViewColumn.Beside) as Thenable<INativeInteractiveWindow>;
            ({ notebookUri } = await this.loadPromise);
            notebookDocument = workspace.notebookDocuments.find((document) => notebookUri.toString() === document.uri.toString());
        }

        // We should never get here--this means VS Code failed to create an interactive window
        if (!notebookDocument) {
            throw new Error('Failed to get or create interactive window.');
        }

        if (!this.kernel || this.kernel.notebook?.resource?.toString() !== notebookDocument.uri.toString()) {
            // Make sure our kernel has started before we try to put stuff 
            await loadKernelPromise;
        }

        return notebookDocument;
    }

    public async addCode(code: string, file: Uri, line: number): Promise<boolean> {
        return this.addOrDebugCode(code, file, line, false);
    }

    public async debugCode(code: string, file: Uri, line: number): Promise<boolean> {
        let saved = true;
        // Make sure the file is saved before debugging
        const doc = this.documentManager.textDocuments.find((d) => this.fs.areLocalPathsSame(d.fileName, file.fsPath));
        if (doc && doc.isUntitled) {
            // Before we start, get the list of documents
            const beforeSave = [...this.documentManager.textDocuments];

            saved = await doc.save();

            // If that worked, we have to open the new document. It should be
            // the new entry in the list
            if (saved) {
                const diff = this.documentManager.textDocuments.filter((f) => beforeSave.indexOf(f) === -1);
                if (diff && diff.length > 0) {
                    file = diff[0].uri;

                    // Open the new document
                    await this.documentManager.openTextDocument(file);
                }
            }
        }

        // Call the internal method if we were able to save
        if (saved) {
            return this.addOrDebugCode(code, file, line, true);
        }

        return false;
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
                const notebookDocument = await this.tryGetMatchingNotebookDocument();
                if (!notebookDocument) {
                    return;
                }

                const result = await this.kernel.interrupt(notebookDocument);
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
        if (this.kernel?.notebook && !this.restartingKernel) {
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
        const notebookDocument = await this.tryGetMatchingNotebookDocument();

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
                    await this.setFileInKernel(fileInKernel, undefined);
                }

                // // Compute if dark or not.
                // const knownDark = await this.isDark();

                // // Before we run any cells, update the dark setting
                // await this.kernel?.notebook?.setMatplotLibStyle(knownDark);
            }
        } catch (exc) {
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server
            if (exc instanceof JupyterKernelPromiseFailedError && this.kernel?.notebook) {
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
        this.tryGetMatchingNotebookDocument().then((notebookDocument) => {
            if (notebookDocument) {
                return chainWithPendingUpdates(notebookDocument, (edit) => {
                    notebookDocument.getCells().forEach((cell, index) => {
                        const metadata = { ...(cell.metadata || {}), inputCollapsed: false, outputCollapsed: false };
                        edit.replaceNotebookCellMetadata(notebookDocument.uri, index, metadata);
                    });
                })
            }
        }).then(noop, noop);
    }

    public collapseAllCells() {
        this.tryGetMatchingNotebookDocument().then((notebookDocument) => {
            if (notebookDocument) {
                return chainWithPendingUpdates(notebookDocument, (edit) => {
                    notebookDocument.getCells().forEach((cell, index) => {
                        const metadata = { ...(cell.metadata || {}), inputCollapsed: true, outputCollapsed: false };
                        edit.replaceNotebookCellMetadata(notebookDocument.uri, index, metadata);
                    });
                })
            }
        }).then(noop, noop);
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

    protected async submitCode(
        code: string,
        _file: string,
        _line: number,
        _id?: string,
        _data?: nbformat.ICodeCell | nbformat.IRawCell | nbformat.IMarkdownCell,
        _debugInfo?: { runByLine: boolean; hashFileName?: string },
        _cancelToken?: CancellationToken
    ): Promise<boolean> {
        // Ensure we always have a notebook document to submit code to
        const notebookDocument = await this.getOrCreateInteractiveEditor();

        // Insert code cell into NotebookDocument
        const edit = new WorkspaceEdit();
        const notebookCell = new NotebookCellData(NotebookCellKind.Code, code, 'python'); // Look at document.languageId
        notebookCell.metadata = { inputCollapsed: true }; // Hide the input because code is already visible on the left
        edit.replaceNotebookCells(notebookDocument.uri, new NotebookRange(notebookDocument.cellCount, notebookDocument.cellCount), [
            notebookCell // TODO generalize to arbitrary languages and cell types
        ]);
        await workspace.applyEdit(edit);

        // Request execution
        await this.commandManager.executeCommand('notebook.cell.execute', { ranges: [{ start: notebookDocument.cellCount - 1, end: notebookDocument.cellCount }], document: notebookDocument.uri, autoReveal: true });
        return true;
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

    protected async closeBecauseOfFailure(_exc: Error): Promise<void> {
        this.dispose();
    }

    protected async setFileInKernel(file: string, cancelToken: CancellationToken | undefined): Promise<void> {
        // If in perFile mode, set only once
        if (this.mode === 'perFile' && !this.fileInKernel && this.kernel && file !== Identifiers.EmptyFileName) {
            this.fileInKernel = file;
            await this.kernel.notebook?.execute(
                `__file__ = '${file.replace(/\\/g, '\\\\')}'`,
                file,
                0,
                uuid(),
                cancelToken,
                true
            );
        } else if (
            (!this.fileInKernel || !this.fs.areLocalPathsSame(this.fileInKernel, file)) &&
            this.mode !== 'perFile' &&
            this.kernel &&
            file !== Identifiers.EmptyFileName
        ) {
            // Otherwise we need to reset it every time
            this.fileInKernel = file;
            await this.kernel.notebook?.execute(
                `__file__ = '${file.replace(/\\/g, '\\\\')}'`,
                file,
                0,
                uuid(),
                cancelToken,
                true
            );
        }
    }

    private async addOrDebugCode(code: string, file: Uri, line: number, debug: boolean): Promise<boolean> {
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

        // Call the internal method.
        return this.submitCode(code, file.fsPath, line, undefined, undefined, debug ? { runByLine: false } : undefined);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty,@typescript-eslint/no-empty-function
    public async export() {
        // Export requires the python extension
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }

        const notebookDocument = await this.tryGetMatchingNotebookDocument();
        if (!notebookDocument) {
            return;
        }

        const cells = notebookDocument.getCells().reduce((cells: ICell[], cell) => cells.concat(generateCellsFromDocument(cell.document)), []);

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

        const notebookDocument = await this.tryGetMatchingNotebookDocument();
        if (!notebookDocument) {
            return;
        }

        const cells = notebookDocument.getCells().reduce((cells: ICell[], cell) => cells.concat(generateCellsFromDocument(cell.document)), []);

        // Pull out the metadata from our active notebook
        const metadata: nbformat.INotebookMetadata = { orig_nbformat: defaultNotebookFormat.major };
        if (this.kernel) {
            updateNotebookMetadata(metadata, this.kernel.notebook?.getKernelConnection());
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
                this.kernel?.notebook?.getMatchingInterpreter()
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
