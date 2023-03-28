// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import * as path from '../platform/vscode-path/path';
import {
    Event,
    EventEmitter,
    NotebookCell,
    NotebookCellData,
    NotebookCellKind,
    NotebookDocument,
    NotebookRange,
    Uri,
    workspace,
    WorkspaceEdit,
    NotebookEditor,
    Disposable,
    window,
    NotebookEdit,
    NotebookEditorRevealType
} from 'vscode';
import { ICommandManager, IDocumentManager, IWorkspaceService } from '../platform/common/application/types';
import { Commands, defaultNotebookFormat, MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../platform/common/constants';
import { traceInfo, traceInfoIfCI, traceVerbose, traceWarning } from '../platform/logging';
import { IFileSystem } from '../platform/common/platform/types';
import uuid from 'uuid/v4';

import { IConfigurationService, InteractiveWindowMode, IsWebExtension, Resource } from '../platform/common/types';
import { noop } from '../platform/common/utils/misc';
import {
    IKernel,
    IKernelProvider,
    isLocalConnection,
    KernelConnectionMetadata,
    NotebookCellRunState
} from '../kernels/types';
import { chainable } from '../platform/common/utils/decorators';
import { InteractiveCellResultError } from '../platform/errors/interactiveCellResultError';
import { DataScience } from '../platform/common/utils/localize';
import { createDeferred } from '../platform/common/utils/async';
import { IServiceContainer } from '../platform/ioc/types';
import { createOutputWithErrorMessageForDisplay } from '../platform/errors/errorUtils';
import { INotebookExporter } from '../kernels/jupyter/types';
import { IExportDialog, ExportFormat } from '../notebooks/export/types';
import { generateCellsFromNotebookDocument } from './editor-integration/cellFactory';
import { CellMatcher } from './editor-integration/cellMatcher';
import {
    IInteractiveWindow,
    IInteractiveWindowDebugger,
    IInteractiveWindowDebuggingManager,
    InteractiveTab
} from './types';
import { generateInteractiveCode, isInteractiveInputTab } from './helpers';
import { getInteractiveCellMetadata } from './helpers';
import { getFilePath } from '../platform/common/platform/fs-paths';
import {
    ICodeGeneratorFactory,
    IGeneratedCodeStorageFactory,
    InteractiveCellMetadata
} from './editor-integration/types';
import { IDataScienceErrorHandler } from '../kernels/errors/types';
import { CellExecutionCreator } from '../kernels/execution/cellExecutionCreator';
import { updateNotebookMetadata } from '../kernels/execution/helpers';
import { chainWithPendingUpdates } from '../kernels/execution/notebookUpdater';
import { generateMarkdownFromCodeLines, parseForComments } from '../platform/common/utils';
import { KernelController } from '../kernels/kernelController';
import { splitLines } from '../platform/common/helpers';
import {
    InteractiveWindowController as InteractiveController,
    InteractiveControllerFactory
} from './InteractiveWindowController';
import { SystemInfoCell } from './systemInfoCell';

/**
 * ViewModel for an interactive window from the Jupyter extension's point of view.
 * Methods for talking to an Interactive Window are exposed here, but the actual UI is part of VS code core.
 */
export class InteractiveWindow implements IInteractiveWindow {
    public static lastRemoteSelected: KernelConnectionMetadata | undefined;

    public get onDidChangeViewState(): Event<void> {
        return this._onDidChangeViewState.event;
    }
    public get closed(): Event<void> {
        return this.closedEvent.event;
    }
    public get owner(): Resource {
        return this._owner;
    }
    public get submitters(): Uri[] {
        return this._submitters;
    }
    // todo: undefined if not initialized
    public get notebookDocument(): NotebookDocument {
        return workspace.notebookDocuments.find((nb) => nb.uri.toString() === this.notebookUri.toString())!;
    }
    public get kernelConnectionMetadata(): KernelConnectionMetadata | undefined {
        return this.controller?.metadata;
    }
    private _onDidChangeViewState = new EventEmitter<void>();
    private closedEvent = new EventEmitter<void>();
    private _submitters: Uri[] = [];
    private cellMatcher: CellMatcher;

    private internalDisposables: Disposable[] = [];

    public readonly notebookUri: Uri;

    private readonly documentManager: IDocumentManager;
    private readonly fs: IFileSystem;
    private readonly configuration: IConfigurationService;
    private readonly jupyterExporter: INotebookExporter;
    private readonly workspaceService: IWorkspaceService;
    private readonly exportDialog: IExportDialog;
    private readonly interactiveWindowDebugger: IInteractiveWindowDebugger | undefined;
    private readonly errorHandler: IDataScienceErrorHandler;
    private readonly codeGeneratorFactory: ICodeGeneratorFactory;
    private readonly storageFactory: IGeneratedCodeStorageFactory;
    private readonly debuggingManager: IInteractiveWindowDebuggingManager;
    private readonly isWebExtension: boolean;
    private readonly commandManager: ICommandManager;
    private readonly kernelProvider: IKernelProvider;
    private readonly controller: InteractiveController;
    constructor(
        private readonly serviceContainer: IServiceContainer,
        private _owner: Resource,
        controllerFactory: InteractiveControllerFactory,
        notebookEditorOrTab: NotebookEditor | InteractiveTab,
        public readonly inputUri: Uri
    ) {
        this.documentManager = this.serviceContainer.get<IDocumentManager>(IDocumentManager);
        this.commandManager = this.serviceContainer.get<ICommandManager>(ICommandManager);
        this.fs = this.serviceContainer.get<IFileSystem>(IFileSystem);
        this.configuration = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
        this.jupyterExporter = this.serviceContainer.get<INotebookExporter>(INotebookExporter);
        this.workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        this.exportDialog = this.serviceContainer.get<IExportDialog>(IExportDialog);
        this.interactiveWindowDebugger =
            this.serviceContainer.tryGet<IInteractiveWindowDebugger>(IInteractiveWindowDebugger);
        this.errorHandler = this.serviceContainer.get<IDataScienceErrorHandler>(IDataScienceErrorHandler);
        this.codeGeneratorFactory = this.serviceContainer.get<ICodeGeneratorFactory>(ICodeGeneratorFactory);
        this.storageFactory = this.serviceContainer.get<IGeneratedCodeStorageFactory>(IGeneratedCodeStorageFactory);
        this.kernelProvider = this.serviceContainer.get<IKernelProvider>(IKernelProvider);
        this.debuggingManager = this.serviceContainer.get<IInteractiveWindowDebuggingManager>(
            IInteractiveWindowDebuggingManager
        );
        this.isWebExtension = this.serviceContainer.get<boolean>(IsWebExtension);
        this.notebookUri = isInteractiveInputTab(notebookEditorOrTab)
            ? notebookEditorOrTab.input.uri
            : notebookEditorOrTab.notebook.uri;

        // Set our owner and first submitter
        if (this._owner) {
            this._submitters.push(this._owner);
        }
        this.controller = controllerFactory.create(this.errorHandler, this.kernelProvider, this._owner);

        window.onDidChangeActiveNotebookEditor((e) => {
            if (e?.notebook.uri.toString() === this.notebookUri.toString()) {
                this._onDidChangeViewState.fire();
            }
        }, this.internalDisposables);
        workspace.onDidCloseNotebookDocument((notebookDocument) => {
            if (notebookDocument.uri.toString() === this.notebookUri.toString()) {
                this.closedEvent.fire();
            }
        }, this.internalDisposables);

        if (window.activeNotebookEditor?.notebook.uri.toString() === this.notebookUri.toString()) {
            this._onDidChangeViewState.fire();
        }

        this.internalDisposables.push(this.controller.listenForControllerSelection());

        this.cellMatcher = new CellMatcher(this.configuration.getSettings(this.owningResource));
        if (this.notebookDocument) {
            this.codeGeneratorFactory.getOrCreate(this.notebookDocument);
        }
    }

    public async ensureInitialized() {
        if (!this.notebookDocument || !this.codeGeneratorFactory.get(this.notebookDocument)) {
            traceVerbose(`Showing Interactive editor to initialize codeGenerator from notebook document`);
            await this.showInteractiveEditor();
            this.codeGeneratorFactory.getOrCreate(this.notebookDocument);
        }

        this.controller.setController(this.notebookDocument);

        if (this.controller.controller) {
            this.controller.enableAutoStart();
            this.startKernel().catch(noop);
        } else {
            traceInfo('No controller selected for Interactive Window initilization');
            new SystemInfoCell(this.notebookDocument, DataScience.selectKernelForEditor);
        }
    }

    public async startKernel(): Promise<IKernel> {
        return this.controller.startKernel();
    }

    /**
     * Open the the editor for the interactive window, re-using the tab if it already exists.
     */
    public async showInteractiveEditor(): Promise<NotebookEditor> {
        let currentTab: InteractiveTab | undefined;
        window.tabGroups.all.find((group) => {
            group.tabs.find((tab) => {
                if (isInteractiveInputTab(tab) && tab.input.uri.toString() == this.notebookUri.toString()) {
                    currentTab = tab;
                }
            });
        });

        const notebook = this.notebookDocument || this.openNotebookDocument();
        const editor = await window.showNotebookDocument(notebook, {
            preserveFocus: true,
            viewColumn: currentTab?.group.viewColumn
        });

        return editor;
    }

    private async openNotebookDocument(): Promise<NotebookDocument> {
        traceVerbose(`Opening notebook document ${this.notebookUri}`);
        return await workspace.openNotebookDocument(this.notebookUri);
    }

    public dispose() {
        this.internalDisposables.forEach((d) => d.dispose());
        this.controller.disconnect();
    }

    @chainable()
    async addErrorMessage(message: string, notebookCell: NotebookCell): Promise<void> {
        const markdownCell = new NotebookCellData(NotebookCellKind.Markup, message, MARKDOWN_LANGUAGE);
        markdownCell.metadata = { isInteractiveWindowMessageCell: true };
        const insertionIndex =
            notebookCell && notebookCell.index >= 0 ? notebookCell.index : this.notebookDocument.cellCount;
        // If possible display the error message in the cell.
        const controller = this.controller.controller;
        const output = createOutputWithErrorMessageForDisplay(message);
        if (this.notebookDocument.cellCount === 0 || !controller || !output || !notebookCell) {
            const edit = new WorkspaceEdit();
            const nbEdit = NotebookEdit.insertCells(insertionIndex, [markdownCell]);
            edit.set(this.notebookDocument.uri, [nbEdit]);
            await workspace.applyEdit(edit);
        } else {
            const execution = CellExecutionCreator.getOrCreate(notebookCell, new KernelController(controller));
            if (!execution.started) {
                execution.start(notebookCell.executionSummary?.timing?.startTime);
            }
            execution.executionOrder = notebookCell.executionSummary?.executionOrder;
            execution
                .appendOutput(output)
                .then(noop, (err) => traceWarning(`Could not append error message "${output}" to cell: ${err}`));
            execution.end(false, notebookCell.executionSummary?.timing?.endTime);
        }
    }

    public changeMode(mode: InteractiveWindowMode): void {
        this.controller.updateMode(mode);
    }

    public async addCode(code: string, file: Uri, line: number): Promise<boolean> {
        return this.submitCode(code, file, line, false);
    }

    private useNewDebugMode(): boolean {
        const settings = this.configuration.getSettings(this.owner);
        return !!(
            settings.forceIPyKernelDebugger ||
            (this.controller.metadata && !isLocalConnection(this.controller.metadata))
        );
    }

    public async debugCode(code: string, fileUri: Uri, line: number): Promise<boolean> {
        let saved = true;
        // Make sure the file is saved before debugging
        const doc = this.documentManager.textDocuments.find((d) => this.fs.arePathsSame(d.uri, fileUri));
        if (!this.useNewDebugMode() && doc && doc.isUntitled) {
            // Before we start, get the list of documents
            const beforeSave = [...this.documentManager.textDocuments];

            saved = await doc.save();

            // If that worked, we have to open the new document. It should be
            // the new entry in the list
            if (saved) {
                const diff = this.documentManager.textDocuments.filter((f) => beforeSave.indexOf(f) === -1);
                if (diff && diff.length > 0) {
                    // The interactive window often opens at the same time. Avoid picking that one.
                    // Another unrelated window could open at the same time too.
                    const savedFileEditor =
                        diff.find((doc) => doc.languageId === 'python') ||
                        diff.find((doc) => !doc.fileName.endsWith('.interactive')) ||
                        diff[0];
                    fileUri = savedFileEditor.uri;

                    // Open the new document
                    await this.documentManager.openTextDocument(fileUri);
                }
            }
        }

        let result = true;

        // Call the internal method if we were able to save
        if (saved) {
            return this.submitCode(code, fileUri, line, true);
        }

        return result;
    }

    private async submitCode(code: string, fileUri: Uri, line: number, isDebug: boolean) {
        // Do not execute or render empty cells
        if (this.cellMatcher.isEmptyCell(code) || !this.controller.controller) {
            return true;
        }

        // Update the owner list ASAP (this is before we execute)
        this.updateOwners(fileUri);

        // Code may have markdown inside of it, if so, split into two cells
        const split = splitLines(code, { trim: false });
        const matcher = new CellMatcher(this.configuration.getSettings(fileUri));
        let firstNonMarkdown = -1;
        if (matcher.isMarkdown(split[0])) {
            parseForComments(
                split,
                (_s, _i) => noop(),
                (s, i) => {
                    // Make sure there's actually some code.
                    if (s && s.length > 0 && firstNonMarkdown === -1) {
                        firstNonMarkdown = i;
                    }
                }
            );
        }

        const cells =
            firstNonMarkdown > 0
                ? [split.slice(0, firstNonMarkdown).join('\n'), split.slice(firstNonMarkdown).join('\n')]
                : [code];

        // Multiple cells that have split our code.
        const promises = cells.map((c) => {
            const deferred = createDeferred<void>();
            this.controller.setPendingCellAdd(deferred.promise);
            // Add the cell first. We don't need to wait for this part as we want to add them
            // as quickly as possible
            const notebookCellPromise = this.addNotebookCell(c, fileUri, line);

            // Queue up execution
            const promise = this.createExecutionPromise(notebookCellPromise, isDebug);
            promise
                .catch((ex) => {
                    // If execution fails due to a failure in another cell, then log that error against the cell.
                    if (ex instanceof InteractiveCellResultError) {
                        notebookCellPromise
                            .then((cell) => {
                                if (ex.cell !== cell) {
                                    this.addErrorMessage(DataScience.cellStopOnErrorMessage, cell).then(noop, noop);
                                }
                            })
                            .catch(noop);
                    } else {
                        notebookCellPromise
                            .then((cell) =>
                                // If our cell result was a failure show an error
                                this.errorHandler
                                    .getErrorMessageForDisplayInCell(ex, 'execution', this.owningResource)
                                    .then((message) => this.addErrorMessage(message, cell))
                            )
                            .catch(noop);
                    }
                })
                .finally(() => {
                    deferred?.resolve();
                });
            return promise;
        });

        // Last promise should be when we're all done submitting.
        return promises[promises.length - 1];
    }

    @chainable()
    private async createExecutionPromise(notebookCellPromise: Promise<NotebookCell>, isDebug: boolean) {
        traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.start');
        // Kick of starting kernels early.
        const kernelPromise = this.startKernel();
        const cell = await notebookCellPromise;

        let success = true;
        let detachKernel = async () => noop();
        try {
            const kernel = await kernelPromise;
            await this.generateCodeAndAddMetadata(cell, isDebug, kernel);
            if (isDebug && this.useNewDebugMode()) {
                // New ipykernel 7 debugger using the Jupyter protocol.
                await this.debuggingManager.start(this.notebookDocument, cell);
            } else if (
                isDebug &&
                isLocalConnection(kernel.kernelConnectionMetadata) &&
                this.interactiveWindowDebugger
            ) {
                // Old ipykernel 6 debugger.
                // If debugging attach to the kernel but don't enable tracing just yet
                detachKernel = async () => this.interactiveWindowDebugger?.detach(kernel);
                await this.interactiveWindowDebugger.attach(kernel);
                await this.interactiveWindowDebugger.updateSourceMaps(
                    this.storageFactory.get({ notebook: cell.notebook })?.all || []
                );
                this.interactiveWindowDebugger.enable(kernel);
            }
            traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.kernel.executeCell');
            const iwCellMetadata = getInteractiveCellMetadata(cell);
            const execution = this.kernelProvider.getKernelExecution(kernel!);
            success =
                (await execution.executeCell(cell, iwCellMetadata?.generatedCode?.code)) !== NotebookCellRunState.Error;
            traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.kernel.executeCell.finished');
        } finally {
            await detachKernel();
            traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.end');
        }

        if (!success) {
            // Throw to break out of the promise chain
            throw new InteractiveCellResultError(cell);
        }
        return success;
    }

    public async expandAllCells() {
        await Promise.all(
            this.notebookDocument.getCells().map(async (_cell, index) => {
                await this.commandManager.executeCommand('notebook.cell.expandCellInput', {
                    ranges: [{ start: index, end: index + 1 }],
                    document: this.notebookUri
                });
            })
        );
    }

    public async collapseAllCells() {
        await Promise.all(
            this.notebookDocument.getCells().map(async (cell, index) => {
                if (cell.kind !== NotebookCellKind.Code) {
                    return;
                }
                await this.commandManager.executeCommand('notebook.cell.collapseCellInput', {
                    ranges: [{ start: index, end: index + 1 }],
                    document: this.notebookUri
                });
            })
        );
    }

    public async scrollToCell(id: string): Promise<void> {
        const editor = await this.showInteractiveEditor();
        const matchingCell = this.notebookDocument
            .getCells()
            .find((cell) => getInteractiveCellMetadata(cell)?.id === id);
        if (matchingCell) {
            const notebookRange = new NotebookRange(matchingCell.index, matchingCell.index + 1);
            editor.revealRange(notebookRange, NotebookEditorRevealType.Default);
            editor.selection = notebookRange;
        }
    }

    public async hasCell(id: string): Promise<boolean> {
        return this.notebookDocument.getCells().some((cell) => getInteractiveCellMetadata(cell)?.id === id);
    }

    public get owningResource(): Resource {
        if (this.owner) {
            return this.owner;
        }
        const root = this.workspaceService.rootFolder;
        if (root) {
            return root;
        }
        return undefined;
    }

    private updateOwners(file: Uri) {
        // Update the owner for this window if not already set
        if (!this._owner) {
            this._owner = file;
            this.controller.updateOwners(file);
        }

        // Add to the list of 'submitters' for this window.
        if (!this._submitters.find((s) => s.toString() == file.toString())) {
            this._submitters.push(file);
        }
    }

    private async addNotebookCell(code: string, file: Uri, line: number): Promise<NotebookCell> {
        const notebookDocument = this.notebookDocument;

        // Strip #%% and store it in the cell metadata so we can reconstruct the cell structure when exporting to Python files
        const settings = this.configuration.getSettings(this.owningResource);
        const isMarkdown = this.cellMatcher.getCellType(code) === MARKDOWN_LANGUAGE;
        const strippedCode = isMarkdown
            ? generateMarkdownFromCodeLines(splitLines(code)).join('')
            : generateInteractiveCode(code, settings, this.cellMatcher);
        const interactiveWindowCellMarker = this.cellMatcher.getFirstMarker(code);

        // Insert cell into NotebookDocument
        const language =
            workspace.textDocuments.find((document) => document.uri.toString() === this.owner?.toString())
                ?.languageId ?? PYTHON_LANGUAGE;
        const notebookCellData = new NotebookCellData(
            isMarkdown ? NotebookCellKind.Markup : NotebookCellKind.Code,
            strippedCode,
            isMarkdown ? MARKDOWN_LANGUAGE : language
        );
        const interactive = {
            uristring: file.toString(), // Has to be simple types
            lineIndex: line,
            originalSource: code
        };

        const metadata: InteractiveCellMetadata = {
            interactiveWindowCellMarker,
            interactive,
            id: uuid()
        };
        notebookCellData.metadata = metadata;
        await chainWithPendingUpdates(notebookDocument, (edit) => {
            const nbEdit = NotebookEdit.insertCells(notebookDocument.cellCount, [notebookCellData]);
            edit.set(notebookDocument.uri, [nbEdit]);
        });
        const newCellIndex = notebookDocument.cellCount - 1;
        return notebookDocument.cellAt(newCellIndex);
    }
    private async generateCodeAndAddMetadata(cell: NotebookCell, isDebug: boolean, kernel: IKernel) {
        const metadata = getInteractiveCellMetadata(cell);
        if (!metadata) {
            return;
        }
        const forceIPyKernelDebugger =
            !isLocalConnection(kernel.kernelConnectionMetadata) ||
            this.configuration.getSettings(undefined).forceIPyKernelDebugger;

        const generatedCode = await this.codeGeneratorFactory
            .getOrCreate(this.notebookDocument)
            .generateCode(metadata, cell.index, isDebug, forceIPyKernelDebugger);

        const newMetadata: typeof metadata = {
            ...metadata,
            generatedCode
        };

        const edit = new WorkspaceEdit();
        const cellEdit = NotebookEdit.updateCellMetadata(cell.index, newMetadata);
        edit.set(cell.notebook.uri, [cellEdit]);
        await workspace.applyEdit(edit);
    }

    public async export() {
        const { magicCommandsAsComments } = this.configuration.getSettings(this.owningResource);
        const cells = generateCellsFromNotebookDocument(this.notebookDocument, magicCommandsAsComments);

        // Should be an array of cells
        if (cells && this.exportDialog) {
            // Bring up the export file dialog box
            const uri = await this.exportDialog.showDialog(ExportFormat.ipynb, this.owningResource);
            if (uri) {
                await this.jupyterExporter?.exportToFile(cells, getFilePath(uri));
            }
        }
    }

    public async exportAs() {
        const kernel = await this.startKernel();

        // Pull out the metadata from our active notebook
        const metadata: nbformat.INotebookMetadata = { orig_nbformat: defaultNotebookFormat.major };
        if (kernel) {
            await updateNotebookMetadata(metadata, kernel.kernelConnectionMetadata);
        }

        let defaultFileName;
        if (this.submitters && this.submitters.length) {
            const lastSubmitter = this.submitters[this.submitters.length - 1];
            lastSubmitter;
            defaultFileName = path.basename(lastSubmitter.path, path.extname(lastSubmitter.path));
        }

        // Then run the export command with these contents
        if (this.isWebExtension) {
            // In web, we currently only support exporting as python script
            this.commandManager
                .executeCommand(
                    Commands.ExportAsPythonScript,
                    this.notebookDocument,
                    kernel?.kernelConnectionMetadata.interpreter
                )
                .then(noop, noop);
        } else {
            this.commandManager
                .executeCommand(
                    Commands.Export,
                    this.notebookDocument,
                    defaultFileName,
                    kernel?.kernelConnectionMetadata.interpreter
                )
                .then(noop, noop);
        }
    }
}
