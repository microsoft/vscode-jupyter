// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type { nbformat } from '@jupyterlab/coreutils';
import * as path from 'path';
import * as uuid from 'uuid';
import { CancellationToken, Event, EventEmitter, Memento, Uri, ViewColumn } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IWebviewPanelProvider,
    IWorkspaceService
} from '../../common/application/types';
import { ContextKey } from '../../common/contextKey';
import '../../common/extensions';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';

import {
    IConfigurationService,
    IDisposableRegistry,
    InteractiveWindowMode,
    IPersistentStateFactory,
    Resource
} from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { EXTENSION_ROOT_DIR } from '../../constants';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Commands, defaultNotebookFormat, EditorContexts, Identifiers, Telemetry } from '../constants';
import { IDataViewerFactory } from '../data-viewing/types';
import { ExportFormat, IExportDialog } from '../export/types';
import { InteractiveBase } from '../interactive-common/interactiveBase';
import {
    INotebookIdentity,
    InteractiveWindowMessages,
    ISubmitNewCell,
    NotebookModelChange,
    SysInfoReason
} from '../interactive-common/interactiveWindowTypes';
import { KernelSelector } from '../jupyter/kernels/kernelSelector';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { updateNotebookMetadata } from '../notebookStorage/baseModel';
import {
    ICell,
    ICodeCssGenerator,
    IDataScienceErrorHandler,
    IInteractiveWindow,
    IInteractiveWindowInfo,
    IInteractiveWindowListener,
    IInteractiveWindowLoadable,
    IJupyterDebugger,
    IJupyterServerUriStorage,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    INotebookExporter,
    INotebookProvider,
    IStatusProvider,
    IThemeFinder,
    WebViewViewChangeEventArgs
} from '../types';
import { createInteractiveIdentity, getInteractiveWindowTitle } from './identity';

const historyReactDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'notebook');

export class InteractiveWindow extends InteractiveBase implements IInteractiveWindowLoadable {
    public get onDidChangeViewState(): Event<void> {
        return this._onDidChangeViewState.event;
    }
    public get visible(): boolean {
        return this.viewState.visible;
    }
    public get active(): boolean {
        return this.viewState.active;
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
    private waitingForExportCells: boolean = false;
    private trackedJupyterStart: boolean = false;
    private _owner: Uri | undefined;
    private _identity: Uri = createInteractiveIdentity();
    private _submitters: Uri[] = [];
    private pendingHasCell = new Map<string, Deferred<boolean>>();
    private mode: InteractiveWindowMode = 'multiple';
    private loadPromise: Promise<void>;
    private _kernelConnection?: KernelConnectionMetadata;

    constructor(
        listeners: IInteractiveWindowListener[],
        applicationShell: IApplicationShell,
        documentManager: IDocumentManager,
        statusProvider: IStatusProvider,
        provider: IWebviewPanelProvider,
        disposables: IDisposableRegistry,
        cssGenerator: ICodeCssGenerator,
        themeFinder: IThemeFinder,
        fs: IFileSystem,
        configuration: IConfigurationService,
        commandManager: ICommandManager,
        jupyterExporter: INotebookExporter,
        workspaceService: IWorkspaceService,
        dataExplorerFactory: IDataViewerFactory,
        jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory,
        jupyterVariables: IJupyterVariables,
        jupyterDebugger: IJupyterDebugger,
        errorHandler: IDataScienceErrorHandler,
        private readonly stateFactory: IPersistentStateFactory,
        globalStorage: Memento,
        workspaceStorage: Memento,
        notebookProvider: INotebookProvider,
        useCustomEditorApi: boolean,
        owner: Resource,
        mode: InteractiveWindowMode,
        title: string | undefined,
        selector: KernelSelector,
        private readonly extensionChecker: IPythonExtensionChecker,
        serverStorage: IJupyterServerUriStorage,
        private readonly exportDialog: IExportDialog
    ) {
        super(
            listeners,
            applicationShell,
            documentManager,
            provider,
            disposables,
            cssGenerator,
            themeFinder,
            statusProvider,
            fs,
            configuration,
            jupyterExporter,
            workspaceService,
            dataExplorerFactory,
            jupyterVariableDataProviderFactory,
            jupyterVariables,
            jupyterDebugger,
            errorHandler,
            commandManager,
            globalStorage,
            workspaceStorage,
            historyReactDir,
            [
                path.join(historyReactDir, 'require.js'),
                path.join(historyReactDir, 'ipywidgets.js'),
                path.join(historyReactDir, 'monaco.bundle.js'),
                path.join(historyReactDir, 'commons.initial.bundle.js'),
                path.join(historyReactDir, 'interactiveWindow.js')
            ],
            localize.DataScience.interactiveWindowTitle(),
            ViewColumn.Two,
            notebookProvider,
            useCustomEditorApi,
            selector,
            serverStorage
        );

        // Send a telemetry event to indicate window is opening
        sendTelemetryEvent(Telemetry.OpenedInteractiveWindow);

        // Set our owner and first submitter
        this._owner = owner;
        this.mode = mode;
        if (owner) {
            this._submitters.push(owner);
        }

        // When opening we have to load the web panel.
        this.loadPromise = this.loadWebview(this.owner ? path.dirname(this.owner.fsPath) : process.cwd())
            .then(async () => {
                // Always load our notebook.
                await this.ensureConnectionAndNotebook();

                // Then the initial sys info
                await this.addSysInfo(SysInfoReason.Start);
            })
            .catch((e) => this.errorHandler.handleError(e));

        // Update the title if possible
        if (this.owner && mode === 'perFile') {
            this.setTitle(getInteractiveWindowTitle(this.owner));
        } else if (title) {
            this.setTitle(title);
        }
    }

    public async show(preserveFocus: boolean = true): Promise<void> {
        await this.loadPromise;
        return super.show(preserveFocus);
    }

    public dispose() {
        super.dispose();
        if (this.notebook) {
            this.notebook.dispose().ignoreErrors();
        }
        if (this.closedEvent) {
            this.closedEvent.fire(this);
        }
    }

    public addMessage(message: string): Promise<void> {
        this.addMessageImpl(message);
        return Promise.resolve();
    }

    public changeMode(mode: InteractiveWindowMode): void {
        if (this.mode !== mode) {
            this.mode = mode;
            if (this.owner && mode === 'perFile') {
                this.setTitle(getInteractiveWindowTitle(this.owner));
            }
        }
    }

    public async addCode(code: string, file: Uri, line: number): Promise<boolean> {
        return this.addOrDebugCode(code, file, line, false);
    }

    public exportCells() {
        // First ask for all cells. Set state to indicate waiting for result
        this.waitingForExportCells = true;

        // Telemetry will fire when the export function is called.
        this.postMessage(InteractiveWindowMessages.GetAllCells).ignoreErrors();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public onMessage(message: string, payload: any) {
        super.onMessage(message, payload);

        switch (message) {
            case InteractiveWindowMessages.Export:
                this.handleMessage(message, payload, this.export);
                break;

            case InteractiveWindowMessages.ReturnAllCells:
                this.handleMessage(message, payload, this.handleReturnAllCells);
                break;

            case InteractiveWindowMessages.UpdateModel:
                this.handleMessage(message, payload, this.handleModelChange);
                break;

            case InteractiveWindowMessages.ExportNotebookAs:
                this.handleMessage(message, payload, this.exportAs);
                break;

            case InteractiveWindowMessages.HasCellResponse:
                this.handleMessage(message, payload, this.handleHasCellResponse);
                break;

            default:
                break;
        }
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

    @captureTelemetry(Telemetry.ExpandAll)
    public expandAllCells() {
        this.postMessage(InteractiveWindowMessages.ExpandAll).ignoreErrors();
    }

    @captureTelemetry(Telemetry.CollapseAll)
    public collapseAllCells() {
        this.postMessage(InteractiveWindowMessages.CollapseAll).ignoreErrors();
    }

    @captureTelemetry(Telemetry.ScrolledToCell)
    public scrollToCell(id: string): void {
        this.show(false)
            .then(() => {
                return this.postMessage(InteractiveWindowMessages.ScrollToCell, { id });
            })
            .ignoreErrors();
    }

    public hasCell(id: string): Promise<boolean> {
        let deferred = this.pendingHasCell.get(id);
        if (!deferred) {
            deferred = createDeferred<boolean>();
            this.pendingHasCell.set(id, deferred);
            this.postMessage(InteractiveWindowMessages.HasCell, id).ignoreErrors();
        }
        return deferred.promise;
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

    protected async addSysInfo(reason: SysInfoReason): Promise<void> {
        await super.addSysInfo(reason);

        // If `reason == Start`, then this means UI has been updated with the last
        // pience of informaiotn (which was sys info), and now UI can be deemed as having been loaded.
        // Marking a UI as having been loaded is done by sending a message `LoadAllCells`, even though we're not loading any cells.
        // We're merely using existing messages (from NativeEditor).
        if (reason === SysInfoReason.Start) {
            this.postMessage(InteractiveWindowMessages.LoadAllCells, { cells: [] }).ignoreErrors();
        }
    }
    protected async onViewStateChanged(args: WebViewViewChangeEventArgs) {
        super.onViewStateChanged(args);
        this._onDidChangeViewState.fire();
    }

    @captureTelemetry(Telemetry.SubmitCellThroughInput, undefined, false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected submitNewCell(info: ISubmitNewCell) {
        // If there's any payload, it has the code and the id
        if (info && info.code && info.id) {
            // Send to ourselves.
            this.submitCode(info.code, Identifiers.EmptyFileName, 0, info.id).ignoreErrors();
        }
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
        // @ts-ignore (this code has been added becuase of the tests, in tests executeCommand can be null)
        if (this.commandManager && this.commandManager.executeCommand) {
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
    }

    protected async closeBecauseOfFailure(_exc: Error): Promise<void> {
        this.dispose();
    }

    protected async setFileInKernel(file: string, cancelToken: CancellationToken | undefined): Promise<void> {
        // If in perFile mode, set only once
        if (this.mode === 'perFile' && !this.fileInKernel && this.notebook && file !== Identifiers.EmptyFileName) {
            this.fileInKernel = file;
            await this.notebook.execute(
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
            this.notebook &&
            file !== Identifiers.EmptyFileName
        ) {
            // Otherwise we need to reset it every time
            this.fileInKernel = file;
            await this.notebook.execute(
                `__file__ = '${file.replace(/\\/g, '\\\\')}'`,
                file,
                0,
                uuid(),
                cancelToken,
                true
            );
        }
    }

    protected ensureConnectionAndNotebook(): Promise<void> {
        // Keep track of users who have used interactive window in a worksapce folder.
        // To be used if/when changing workflows related to startup of jupyter.
        if (!this.trackedJupyterStart) {
            this.trackedJupyterStart = true;
            const store = this.stateFactory.createGlobalPersistentState('INTERACTIVE_WINDOW_USED', false);
            store.updateValue(true).ignoreErrors();
        }
        return super.ensureConnectionAndNotebook();
    }

    private async addOrDebugCode(code: string, file: Uri, line: number, debug: boolean): Promise<boolean> {
        if (this.owner && !this.fs.areLocalPathsSame(file.fsPath, this.owner.fsPath)) {
            sendTelemetryEvent(Telemetry.NewFileForInteractiveWindow);
        }
        // Update the owner for this window if not already set
        if (!this._owner) {
            this._owner = file;

            // Update the title if we're in per file mode
            if (this.mode === 'perFile') {
                this.setTitle(getInteractiveWindowTitle(file));
            }
        }

        // Add to the list of 'submitters' for this window.
        if (!this._submitters.find((s) => this.fs.areLocalPathsSame(s.fsPath, file.fsPath))) {
            this._submitters.push(file);
        }

        // Make sure our web panel opens.
        await this.show();

        // Tell the webpanel about the new directory.
        this.updateCwd(path.dirname(file.fsPath));

        // Call the internal method.
        return this.submitCode(code, file.fsPath, line, undefined, undefined, debug ? { runByLine: false } : undefined);
    }

    @captureTelemetry(Telemetry.ExportNotebookInteractive, undefined, false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty,@typescript-eslint/no-empty-function
    public async export(cells: ICell[]) {
        // Export requires the python extension
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }

        // Should be an array of cells
        if (cells && this.exportDialog) {
            // Indicate busy
            this.startProgress();
            try {
                // Bring up the export file dialog box
                const uri = await this.exportDialog.showDialog(ExportFormat.ipynb, this.owningResource);
                if (uri) {
                    await this.jupyterExporter.exportToFile(cells, uri.fsPath);
                }
            } finally {
                this.stopProgress();
            }
        }
    }

    public async exportAs(cells: ICell[]) {
        // Export requires the python extension
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }

        // Pull out the metadata from our active notebook
        const metadata: nbformat.INotebookMetadata = { orig_nbformat: defaultNotebookFormat.major };
        if (this.notebook) {
            updateNotebookMetadata(metadata, this.notebook?.getKernelConnection());
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
                this.notebook?.getMatchingInterpreter()
            )
            .then(noop, noop);
    }

    private handleModelChange(update: NotebookModelChange) {
        // Send telemetry for delete and delete all. We don't send telemetry for the other updates yet
        if (update.source === 'user') {
            if (update.kind === 'remove_all') {
                sendTelemetryEvent(Telemetry.DeleteAllCells);
            } else if (update.kind === 'remove') {
                sendTelemetryEvent(Telemetry.DeleteCell);
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private handleReturnAllCells(cells: ICell[]) {
        // See what we're waiting for.
        if (this.waitingForExportCells) {
            this.export(cells).catch((ex) => traceError('Error exporting:', ex));
        }
    }

    private handleHasCellResponse(response: { id: string; result: boolean }) {
        const deferred = this.pendingHasCell.get(response.id);
        if (deferred) {
            deferred.resolve(response.result);
            this.pendingHasCell.delete(response.id);
        }
    }
}
