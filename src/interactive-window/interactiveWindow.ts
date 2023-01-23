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
    Range,
    workspace,
    WorkspaceEdit,
    NotebookEditor,
    Disposable,
    window,
    NotebookController,
    NotebookEdit
} from 'vscode';
import { ICommandManager, IDocumentManager, IWorkspaceService } from '../platform/common/application/types';
import { Commands, defaultNotebookFormat, MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../platform/common/constants';
import '../platform/common/extensions';
import { traceError, traceInfoIfCI } from '../platform/logging';
import { IFileSystem } from '../platform/common/platform/types';
import uuid from 'uuid/v4';

import { IConfigurationService, InteractiveWindowMode, IsWebExtension, Resource } from '../platform/common/types';
import { noop } from '../platform/common/utils/misc';
import {
    IKernel,
    IKernelProvider,
    isLocalConnection,
    KernelAction,
    KernelConnectionMetadata,
    NotebookCellRunState
} from '../kernels/types';
import { chainable } from '../platform/common/utils/decorators';
import { InteractiveCellResultError } from '../platform/errors/interactiveCellResultError';
import { DataScience } from '../platform/common/utils/localize';
import { createDeferred, Deferred } from '../platform/common/utils/async';
import { SysInfoReason } from '../messageTypes';
import { createOutputWithErrorMessageForDisplay } from '../platform/errors/errorUtils';
import { INotebookExporter } from '../kernels/jupyter/types';
import { IExportDialog, ExportFormat } from '../notebooks/export/types';
import { generateCellsFromNotebookDocument } from './editor-integration/cellFactory';
import { CellMatcher } from './editor-integration/cellMatcher';
import {
    IInteractiveWindowLoadable,
    IInteractiveWindowDebugger,
    IInteractiveWindowDebuggingManager,
    InteractiveTab
} from './types';
import { generateInteractiveCode, getInteractiveCellMetadata, isInteractiveInputTab } from './helpers';
import {
    IControllerRegistration,
    IControllerSelection,
    IVSCodeNotebookController
} from '../notebooks/controllers/types';
import { DisplayOptions } from '../kernels/displayOptions';
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
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../kernels/telemetry/helper';
import { generateMarkdownFromCodeLines, parseForComments } from '../platform/common/utils';
import { IServiceContainer } from '../platform/ioc/types';

/**
 * ViewModel for an interactive window from the Jupyter extension's point of view.
 * Methods for talking to an Interactive Window are exposed here, but the actual UI is part of VS code core.
 */
export class InteractiveWindow implements IInteractiveWindowLoadable {
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
    public get notebookDocument(): NotebookDocument {
        return this.notebookEditor.notebook;
    }
    public get kernelConnectionMetadata(): KernelConnectionMetadata | undefined {
        return this.currentKernelInfo.metadata;
    }
    private _onDidChangeViewState = new EventEmitter<void>();
    private closedEvent = new EventEmitter<void>();
    private _submitters: Uri[] = [];
    private fileInKernel: Uri | undefined;
    private cellMatcher: CellMatcher;
    private pendingCellAdd: Promise<void> | undefined;

    private internalDisposables: Disposable[] = [];
    private kernelDisposables: Disposable[] = [];
    private _insertSysInfoPromise: Promise<NotebookCell> | undefined;
    private currentKernelInfo: {
        kernelStarted?: Deferred<void>;
        kernel?: IKernel;
        controller?: NotebookController;
        metadata?: KernelConnectionMetadata;
    } = {};
    private pendingNotebookScrolls: NotebookRange[] = [];

    private _notebookEditor!: NotebookEditor;
    public get notebookEditor(): NotebookEditor {
        return this._notebookEditor;
    }

    private _notebookUri: Uri;
    public get notebookUri(): Uri {
        return this._notebookUri;
    }

    private readonly documentManager: IDocumentManager;
    private readonly fs: IFileSystem;
    private readonly configuration: IConfigurationService;
    private readonly jupyterExporter: INotebookExporter;
    private readonly workspaceService: IWorkspaceService;
    private readonly exportDialog: IExportDialog;
    private readonly notebookControllerSelection: IControllerSelection;
    private readonly interactiveWindowDebugger: IInteractiveWindowDebugger | undefined;
    private readonly errorHandler: IDataScienceErrorHandler;
    private readonly codeGeneratorFactory: ICodeGeneratorFactory;
    private readonly storageFactory: IGeneratedCodeStorageFactory;
    private readonly debuggingManager: IInteractiveWindowDebuggingManager;
    private readonly isWebExtension: boolean;
    private readonly commandManager: ICommandManager;
    private readonly kernelProvider: IKernelProvider;
    private readonly controllerRegistration: IControllerRegistration;
    constructor(
        private readonly serviceContainer: IServiceContainer,
        private _owner: Resource,
        public mode: InteractiveWindowMode,
        private preferredController: IVSCodeNotebookController | undefined,
        private readonly notebookEditorOrTab: NotebookEditor | InteractiveTab,
        public readonly inputUri: Uri
    ) {
        this.documentManager = this.serviceContainer.get<IDocumentManager>(IDocumentManager);
        this.commandManager = this.serviceContainer.get<ICommandManager>(ICommandManager);
        this.fs = this.serviceContainer.get<IFileSystem>(IFileSystem);
        this.configuration = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
        this.jupyterExporter = this.serviceContainer.get<INotebookExporter>(INotebookExporter);
        this.workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        this.exportDialog = this.serviceContainer.get<IExportDialog>(IExportDialog);
        this.notebookControllerSelection = this.serviceContainer.get<IControllerSelection>(IControllerSelection);
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
        this.controllerRegistration = this.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        this._notebookUri = isInteractiveInputTab(notebookEditorOrTab)
            ? notebookEditorOrTab.input.uri
            : notebookEditorOrTab.notebook.uri;
        if (!isInteractiveInputTab(notebookEditorOrTab)) {
            this._notebookEditor = notebookEditorOrTab;
        }

        // Set our owner and first submitter
        if (this._owner) {
            this._submitters.push(this._owner);
        }
    }

    public start() {
        window.onDidChangeActiveNotebookEditor((e) => {
            if (e === this.notebookEditor) {
                this._onDidChangeViewState.fire();
            }
        }, this.internalDisposables);
        workspace.onDidCloseNotebookDocument((notebookDocument) => {
            if (notebookDocument === this.notebookDocument) {
                this.closedEvent.fire();
            }
        }, this.internalDisposables);

        this.cellMatcher = new CellMatcher(this.configuration.getSettings(this.owningResource));
        if (window.activeNotebookEditor === this.notebookEditor) {
            this._onDidChangeViewState.fire();
        }

        this.listenForControllerSelection();
        if (this.preferredController) {
            // Also start connecting to our kernel but don't wait for it to finish
            this.startKernel(this.preferredController.controller, this.preferredController.connection).ignoreErrors();
        } else if (this.isWebExtension) {
            this.insertInfoMessage(DataScience.noKernelsSpecifyRemote()).ignoreErrors();
        }

        // Create the code generator right away to start watching the notebook
        this.codeGeneratorFactory.getOrCreate(this.notebookDocument);
    }

    public async restore(preferredController: IVSCodeNotebookController | undefined) {
        if (preferredController) {
            this.preferredController = preferredController;
        }
        if (!this.notebookEditor) {
            if (isInteractiveInputTab(this.notebookEditorOrTab)) {
                const document = await workspace.openNotebookDocument(this.notebookEditorOrTab.input.uri);
                const editor = await window.showNotebookDocument(document, {
                    viewColumn: this.notebookEditorOrTab.group.viewColumn
                });
                this._notebookEditor = editor;
            } else {
                this._notebookEditor = this.notebookEditorOrTab;
            }
        }

        this.start();
    }

    /**
     * Inform the controller that a cell is being added and it should wait before adding any others to the execution queue.
     * @param cellAddedPromise - Promise that resolves when the cell execution has been queued
     */
    private setPendingCellAdd(cellAddedPromise: Promise<void>) {
        if (this.kernelConnectionMetadata) {
            this.pendingCellAdd = cellAddedPromise;
            const controller = this.controllerRegistration.get(this.kernelConnectionMetadata, 'interactive');
            controller?.setPendingCellAddition(this.notebookDocument, cellAddedPromise);
        }
    }

    private async startKernel(
        controller: NotebookController | undefined = this.currentKernelInfo.controller,
        metadata: KernelConnectionMetadata | undefined = this.currentKernelInfo.metadata
    ): Promise<IKernel> {
        if (!controller || !metadata) {
            // This cannot happen, but we need to make typescript happy.
            throw new Error('Controller not selected');
        }
        if (this.currentKernelInfo.kernelStarted) {
            await this.currentKernelInfo.kernelStarted.promise;
            return this.currentKernelInfo.kernel!;
        }
        const vscController = this.controllerRegistration.registered.find(
            (item) => item.controller.id === controller.id
        );
        if (!vscController) {
            // This cannot happen, but we need to make typescript happy.
            throw new Error('VSCController not available');
        }
        const kernelStarted = createDeferred<void>();
        kernelStarted.promise.catch(noop);
        this.currentKernelInfo = { controller, metadata, kernelStarted };

        const sysInfoCell = this.insertSysInfoMessage(metadata, SysInfoReason.Start);
        try {
            // Try creating a kernel
            await initializeInteractiveOrNotebookTelemetryBasedOnUserAction(this.owner, metadata);

            const onKernelStarted = async (action: KernelAction, k: IKernel) => {
                if (action !== 'start' && action !== 'restart') {
                    return;
                }
                // Id may be different if the user switched controllers
                this.currentKernelInfo.kernel = k;
                !!this.pendingCellAdd && this.setPendingCellAdd(this.pendingCellAdd);
                this.updateSysInfoMessage(
                    this.getSysInfoMessage(k.kernelConnectionMetadata, SysInfoReason.Start),
                    false,
                    sysInfoCell
                );
            };
            const onKernelStartCompleted = async (action: KernelAction, _: unknown, k: IKernel) => {
                if (action !== 'start' && action !== 'restart') {
                    return;
                }
                // Id may be different if the user switched controllers
                this.currentKernelInfo.controller = k.controller;
                this.currentKernelInfo.metadata = k.kernelConnectionMetadata;
            };
            // When connecting, we need to update the sys info message
            this.updateSysInfoMessage(this.getSysInfoMessage(metadata, SysInfoReason.Start), false, sysInfoCell);
            const kernel = await vscController.connectToKernel(
                { resource: this.owner, notebook: this.notebookDocument },
                new DisplayOptions(false),
                onKernelStarted,
                onKernelStartCompleted
            );
            this.currentKernelInfo.controller = kernel.controller;
            this.currentKernelInfo.metadata = kernel.kernelConnectionMetadata;

            const kernelEventHookForRestart = async (ev: 'willRestart' | 'willInterrupt') => {
                if (ev === 'willRestart' && this.notebookDocument && this.currentKernelInfo.metadata) {
                    this._insertSysInfoPromise = undefined;
                    // If we're about to restart, insert a 'restarting' message as it happens
                    this.insertSysInfoMessage(this.currentKernelInfo.metadata, SysInfoReason.Restart).then(noop, noop);
                }
            };
            // Hook pre interrupt so we can stick in a message
            kernel.addEventHook(kernelEventHookForRestart);
            this.kernelDisposables.push(new Disposable(() => kernel.removeEventHook(kernelEventHookForRestart)));

            // When restart finishes, rerun our initialization code
            kernel.onRestarted(
                async () => {
                    traceInfoIfCI('Restart event handled in IW');
                    this.fileInKernel = undefined;
                    const cellPromise = Promise.resolve(
                        this.notebookDocument.cellAt(this.notebookDocument.cellCount - 1)
                    );
                    try {
                        await this.runInitialization(kernel, this.owner);
                    } catch (ex) {
                        traceError(`Failed to run initialization after restarting`);
                    } finally {
                        this.finishSysInfoMessage(kernel, cellPromise, SysInfoReason.Restart);
                    }
                },
                this,
                this.kernelDisposables
            );
            this.kernelDisposables.push(kernel);

            this.fileInKernel = undefined;
            await this.runInitialization(kernel, this.owner);
            this.finishSysInfoMessage(kernel, sysInfoCell, SysInfoReason.Start);
            kernelStarted.resolve();
            return kernel;
        } catch (ex) {
            kernelStarted.reject(ex);
            this.currentKernelInfo.kernelStarted = undefined;
            this.currentKernelInfo.kernel = undefined;
            this.disconnectKernel();
            if (this.owner) {
                // The actual error will be displayed in the cell, hence no need to display the actual
                // error here, else we'd just be duplicating the error messages.
                await this.deleteSysInfoCell(sysInfoCell);
            } else {
                // We don't have a cell when starting IW without an *.py file,
                // hence display error where the sysinfo is displayed.
                await this.finishSysInfoWithFailureMessage(ex, sysInfoCell);
            }
            throw ex;
        }
    }

    private getSysInfoMessage(kernelMetadata: KernelConnectionMetadata, reason: SysInfoReason) {
        const kernelName = kernelMetadata.interpreter?.displayName;
        return reason === SysInfoReason.Restart
            ? kernelName
                ? DataScience.restartingKernelCustomHeader().format(kernelName)
                : DataScience.restartingKernelHeader()
            : kernelName
            ? DataScience.startingNewKernelCustomHeader().format(kernelName)
            : DataScience.startingNewKernelHeader();
    }

    private async insertSysInfoMessage(
        kernelMetadata: KernelConnectionMetadata,
        reason: SysInfoReason
    ): Promise<NotebookCell> {
        const message = this.getSysInfoMessage(kernelMetadata, reason);
        return this.insertInfoMessage(message);
    }

    private async insertInfoMessage(message: string): Promise<NotebookCell> {
        if (!this._insertSysInfoPromise) {
            const func = async () => {
                await chainWithPendingUpdates(this.notebookDocument, (edit) => {
                    const markdownCell = new NotebookCellData(NotebookCellKind.Markup, message, MARKDOWN_LANGUAGE);
                    markdownCell.metadata = { isInteractiveWindowMessageCell: true, isPlaceholder: true };
                    const nbEdit = NotebookEdit.insertCells(this.notebookDocument.cellCount, [markdownCell]);
                    edit.set(this.notebookDocument.uri, [nbEdit]);
                });
                // This should be the cell we just inserted into the document
                return this.notebookDocument.cellAt(this.notebookDocument.cellCount - 1);
            };
            this._insertSysInfoPromise = func();
        }
        return this._insertSysInfoPromise;
    }

    private updateSysInfoMessage(newMessage: string, finish: boolean, cellPromise: Promise<NotebookCell>) {
        if (finish) {
            this._insertSysInfoPromise = undefined;
        }
        cellPromise
            .then((cell) =>
                chainWithPendingUpdates(this.notebookDocument, (edit) => {
                    if (cell.index >= 0) {
                        if (
                            cell.kind === NotebookCellKind.Markup &&
                            cell.metadata.isInteractiveWindowMessageCell &&
                            cell.metadata.isPlaceholder
                        ) {
                            edit.replace(cell.document.uri, new Range(0, 0, cell.document.lineCount, 0), newMessage);
                            edit.set(this.notebookDocument!.uri, [
                                NotebookEdit.updateCellMetadata(cell.index, {
                                    isInteractiveWindowMessageCell: true,
                                    isPlaceholder: !finish
                                })
                            ]);
                            return;
                        }
                    }
                })
            )
            .ignoreErrors();
    }

    private deleteSysInfoCell(cellPromise: Promise<NotebookCell>) {
        this._insertSysInfoPromise = undefined;
        cellPromise
            .then((cell) =>
                chainWithPendingUpdates(this.notebookDocument, (edit) => {
                    if (cell.index >= 0) {
                        if (
                            cell.kind === NotebookCellKind.Markup &&
                            cell.metadata.isInteractiveWindowMessageCell &&
                            cell.metadata.isPlaceholder
                        ) {
                            const nbEdit = NotebookEdit.deleteCells(new NotebookRange(cell.index, cell.index + 1));
                            edit.set(this.notebookDocument.uri, [nbEdit]);
                            return;
                        }
                    }
                })
            )
            .ignoreErrors();
    }

    private finishSysInfoMessage(kernel: IKernel, cellPromise: Promise<NotebookCell>, reason: SysInfoReason) {
        const kernelName = 'info' in kernel ? kernel.kernelConnectionMetadata.interpreter?.displayName : '';
        const kernelInfo = 'info' in kernel && kernel.info?.status === 'ok' ? kernel.info : undefined;
        const banner = kernelInfo ? kernelInfo.banner.split('\n').join('  \n') : kernel.toString();
        const message =
            reason == SysInfoReason.Restart ? DataScience.restartedKernelHeader().format(kernelName || '') : banner;
        this.updateSysInfoMessage(message, true, cellPromise);
    }

    private async finishSysInfoWithFailureMessage(error: Error, cellPromise: Promise<NotebookCell>) {
        let message = await this.errorHandler.getErrorMessageForDisplayInCell(error, 'start', this.owningResource);
        // As message is displayed in markdown, ensure linebreaks are formatted accordingly.
        message = message.split('\n').join('  \n');
        this.updateSysInfoMessage(message, true, cellPromise);
    }

    private listenForControllerSelection() {
        // Ensure we hear about any controller changes so we can update our cached promises
        this.notebookControllerSelection.onControllerSelected(
            (e: { notebook: NotebookDocument; controller: IVSCodeNotebookController }) => {
                if (e.notebook !== this.notebookEditor.notebook) {
                    return;
                }

                // Clear cached kernel when the selected controller for this document changes
                const kernel = this.kernelProvider.get(this.notebookDocument.uri);
                const isControllerAttachedToTheSameKernel =
                    kernel && this.currentKernelInfo.kernel && kernel === this.currentKernelInfo.kernel;
                if (
                    e.controller.connection.id !== this.currentKernelInfo.kernel?.kernelConnectionMetadata.id &&
                    !isControllerAttachedToTheSameKernel
                ) {
                    this.disconnectKernel();
                    this.startKernel(e.controller.controller, e.controller.connection).ignoreErrors();
                }
            },
            this,
            this.internalDisposables
        );
    }

    public async show(preserveFocus = true): Promise<void> {
        await this.commandManager.executeCommand(
            'interactive.open',
            { preserveFocus },
            this.notebookUri,
            undefined,
            undefined
        );
    }

    public dispose() {
        this.internalDisposables.forEach((d) => d.dispose());
        this.disconnectKernel();
    }

    @chainable()
    public async addErrorMessage(message: string, notebookCell: NotebookCell): Promise<void> {
        const markdownCell = new NotebookCellData(NotebookCellKind.Markup, message, MARKDOWN_LANGUAGE);
        markdownCell.metadata = { isInteractiveWindowMessageCell: true };
        const insertionIndex =
            notebookCell && notebookCell.index >= 0 ? notebookCell.index : this.notebookEditor.notebook.cellCount;
        // If possible display the error message in the cell.
        const controller = this.notebookControllerSelection.getSelected(this.notebookEditor.notebook);
        const output = createOutputWithErrorMessageForDisplay(message);
        if (this.notebookEditor.notebook.cellCount === 0 || !controller || !output || !notebookCell) {
            const edit = new WorkspaceEdit();
            const nbEdit = NotebookEdit.insertCells(insertionIndex, [markdownCell]);
            edit.set(this.notebookDocument.uri, [nbEdit]);
            await workspace.applyEdit(edit);
        } else {
            const execution = CellExecutionCreator.getOrCreate(notebookCell, controller.controller);
            if (!execution.started) {
                execution.start(notebookCell.executionSummary?.timing?.startTime);
            }
            execution.executionOrder = notebookCell.executionSummary?.executionOrder;
            execution.appendOutput(output).then(noop, noop);
            execution.end(false, notebookCell.executionSummary?.timing?.endTime);
        }
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
        // Make sure the file is saved before debugging
        const doc = this.documentManager.textDocuments.find((d) => this.fs.arePathsSame(d.uri, fileUri));
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
        if (this.cellMatcher.isEmptyCell(code) || !this.currentKernelInfo.controller) {
            return true;
        }

        // Update the owner list ASAP (this is before we execute)
        this.updateOwners(fileUri);

        // Code may have markdown inside of it, if so, split into two cells
        const split = code.splitLines({ trim: false });
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
            this.setPendingCellAdd(deferred.promise);
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
                                    this.addErrorMessage(DataScience.cellStopOnErrorMessage(), cell).then(noop, noop);
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

    private disconnectKernel() {
        this.kernelDisposables.forEach((d) => d.dispose());
        this.kernelDisposables = [];
        this.currentKernelInfo.kernelStarted = undefined;
        this.currentKernelInfo.kernel = undefined;
    }

    @chainable()
    private async createExecutionPromise(notebookCellPromise: Promise<NotebookCell>, isDebug: boolean) {
        traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.start');
        // Kick of starting kernels early.
        const kernelPromise = this.startKernel();
        kernelPromise.then(noop, noop);
        const cell = await notebookCellPromise;

        let success = true;
        let detachKernel = async () => noop();
        try {
            const kernel = await kernelPromise;
            const settings = this.configuration.getSettings(this.owner);
            await this.generateCodeAndAddMetadata(cell, isDebug, kernel);
            if (isDebug && (settings.forceIPyKernelDebugger || !isLocalConnection(kernel.kernelConnectionMetadata))) {
                // New ipykernel 7 debugger using the Jupyter protocol.
                await this.debuggingManager.start(this.notebookEditor, cell);
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
            success =
                (await kernel!.executeCell(cell, iwCellMetadata?.generatedCode?.code)) !== NotebookCellRunState.Error;
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

    private async runInitialization(kernel: IKernel, fileUri: Resource) {
        if (!fileUri) {
            traceInfoIfCI('Unable to run initialization for IW');
            return;
        }

        // If the file isn't unknown, set the active kernel's __file__ variable to point to that same file.
        await this.setFileInKernel(fileUri, kernel!);
        traceInfoIfCI('file in kernel set for IW');
    }

    public async expandAllCells() {
        await Promise.all(
            this.notebookEditor.notebook.getCells().map(async (_cell, index) => {
                await this.commandManager.executeCommand('notebook.cell.expandCellInput', {
                    ranges: [{ start: index, end: index + 1 }],
                    document: this.notebookEditor.notebook.uri
                });
            })
        );
    }

    public async collapseAllCells() {
        await Promise.all(
            this.notebookEditor.notebook.getCells().map(async (cell, index) => {
                if (cell.kind !== NotebookCellKind.Code) {
                    return;
                }
                await this.commandManager.executeCommand('notebook.cell.collapseCellInput', {
                    ranges: [{ start: index, end: index + 1 }],
                    document: this.notebookEditor.notebook.uri
                });
            })
        );
    }

    public async scrollToCell(id: string): Promise<void> {
        await this.show();
        const matchingCell = this.notebookEditor.notebook
            .getCells()
            .find((cell) => getInteractiveCellMetadata(cell)?.id === id);
        if (matchingCell) {
            this.revealCell(matchingCell);
        }
    }

    private revealCell(notebookCell: NotebookCell) {
        const notebookRange = new NotebookRange(notebookCell.index, notebookCell.index + 1);
        this.pendingNotebookScrolls.push(notebookRange);
    }

    public async hasCell(id: string): Promise<boolean> {
        return this.notebookEditor.notebook.getCells().some((cell) => getInteractiveCellMetadata(cell)?.id === id);
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

    private async setFileInKernel(file: Uri, kernel: IKernel): Promise<void> {
        // If in perFile mode, set only once
        const path = getFilePath(file);
        if (this.mode === 'perFile' && !this.fileInKernel) {
            traceInfoIfCI(`Initializing __file__ in setFileInKernel with ${file} for mode ${this.mode}`);
            this.fileInKernel = file;
            await kernel.executeHidden(`__file__ = '${path.replace(/\\/g, '\\\\')}'`);
        } else if ((!this.fileInKernel || !this.fs.arePathsSame(this.fileInKernel, file)) && this.mode !== 'perFile') {
            traceInfoIfCI(`Initializing __file__ in setFileInKernel with ${file} for mode ${this.mode}`);
            // Otherwise we need to reset it every time
            this.fileInKernel = file;
            await kernel.executeHidden(`__file__ = '${path.replace(/\\/g, '\\\\')}'`);
        } else {
            traceInfoIfCI(
                `Not Initializing __file__ in setFileInKernel with ${path} for mode ${this.mode} currently ${this.fileInKernel}`
            );
        }
    }

    private updateOwners(file: Uri) {
        // Update the owner for this window if not already set
        if (!this._owner) {
            this._owner = file;
        }

        // Add to the list of 'submitters' for this window.
        if (!this._submitters.find((s) => s.toString() == file.toString())) {
            this._submitters.push(file);
        }
    }

    private async addNotebookCell(code: string, file: Uri, line: number): Promise<NotebookCell> {
        const notebookDocument = this.notebookEditor.notebook;

        // Strip #%% and store it in the cell metadata so we can reconstruct the cell structure when exporting to Python files
        const settings = this.configuration.getSettings(this.owningResource);
        const isMarkdown = this.cellMatcher.getCellType(code) === MARKDOWN_LANGUAGE;
        const strippedCode = isMarkdown
            ? generateMarkdownFromCodeLines(code.splitLines()).join('')
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
        return notebookDocument.cellAt(notebookDocument.cellCount - 1);
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
        const cells = generateCellsFromNotebookDocument(this.notebookEditor.notebook, magicCommandsAsComments);

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
