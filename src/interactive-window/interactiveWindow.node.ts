// Copyright (c) Microsoft Corporation. All rights reserved.
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
    NotebookEditorRevealType,
    NotebookRange,
    Uri,
    Range,
    workspace,
    WorkspaceEdit,
    notebooks,
    NotebookEditor,
    Disposable,
    window,
    ThemeColor,
    NotebookController
} from 'vscode';
import { IPythonExtensionChecker } from '../platform/api/types';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IWorkspaceService
} from '../platform/common/application/types';
import { Commands, defaultNotebookFormat, MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../platform/common/constants';
import '../platform/common/extensions';
import { traceInfoIfCI } from '../platform/logging';
import { IFileSystem } from '../platform/common/platform/types.node';
import * as uuid from 'uuid/v4';

import { IConfigurationService, InteractiveWindowMode, Resource } from '../platform/common/types';
import { noop } from '../platform/common/utils/misc';
import { IKernel, KernelAction, KernelConnectionMetadata, NotebookCellRunState } from '../kernels/types';
import { INotebookControllerManager } from '../notebooks/types';
import { generateMarkdownFromCodeLines, parseForComments } from '../webviews/webview-side/common';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../telemetry/telemetry';
import { chainable } from '../platform/common/utils/decorators';
import { InteractiveCellResultError } from '../platform/errors/interactiveCellResultError';
import { DataScience } from '../platform/common/utils/localize';
import { createDeferred, Deferred } from '../platform/common/utils/async';
import { IServiceContainer } from '../platform/ioc/types';
import { SysInfoReason } from '../platform/messageTypes';
import { chainWithPendingUpdates } from '../notebooks/execution/notebookUpdater';
import { updateNotebookMetadata } from '../notebooks/helpers';
import { CellExecutionCreator } from '../notebooks/execution/cellExecutionCreator';
import { createOutputWithErrorMessageForDisplay } from '../platform/errors/errorUtils';
import { INotebookExporter } from '../kernels/jupyter/types';
import { IDataScienceErrorHandler } from '../platform/errors/types';
import { IExportDialog, ExportFormat } from '../platform/export/types';
import { generateCellsFromNotebookDocument } from './editor-integration/cellFactory';
import { CellMatcher } from './editor-integration/cellMatcher';
import { IInteractiveWindowLoadable, IInteractiveWindowDebugger } from './types';
import { generateInteractiveCode } from './helpers';
import { IVSCodeNotebookController } from '../notebooks/controllers/types';
import { DisplayOptions } from '../kernels/displayOptions';
import { getInteractiveCellMetadata, InteractiveCellMetadata } from './helpers';
import { KernelConnector } from '../kernels/kernelConnector';
import { getFilePath } from '../platform/common/platform/fs-paths';

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
    public get notebookUri(): Uri {
        return this.notebookEditor.document.uri;
    }
    public get notebookDocument(): NotebookDocument {
        return this.notebookEditor.document;
    }
    public get kernelConnectionMetadata(): KernelConnectionMetadata | undefined {
        return this.currentKernelInfo.metadata;
    }
    private _onDidChangeViewState = new EventEmitter<void>();
    private closedEvent = new EventEmitter<void>();
    private _submitters: Uri[] = [];
    private fileInKernel: string | undefined;
    private cellMatcher;

    private internalDisposables: Disposable[] = [];
    private kernelDisposables: Disposable[] = [];
    private _insertSysInfoPromise: Promise<NotebookCell> | undefined;
    private currentKernelInfo: {
        kernel?: Deferred<IKernel>;
        controller?: NotebookController;
        metadata?: KernelConnectionMetadata;
    } = {};
    private pendingNotebookScrolls: NotebookRange[] = [];

    constructor(
        private readonly documentManager: IDocumentManager,
        private readonly fs: IFileSystem,
        private readonly configuration: IConfigurationService,
        private readonly commandManager: ICommandManager,
        private readonly jupyterExporter: INotebookExporter,
        private readonly workspaceService: IWorkspaceService,
        private _owner: Resource,
        private mode: InteractiveWindowMode,
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly exportDialog: IExportDialog,
        private readonly notebookControllerManager: INotebookControllerManager,
        private readonly serviceContainer: IServiceContainer,
        private readonly interactiveWindowDebugger: IInteractiveWindowDebugger,
        private readonly errorHandler: IDataScienceErrorHandler,
        preferredController: IVSCodeNotebookController | undefined,
        public readonly notebookEditor: NotebookEditor,
        public readonly inputUri: Uri,
        public readonly appShell: IApplicationShell
    ) {
        // Set our owner and first submitter
        if (this._owner) {
            this._submitters.push(this._owner);
        }
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
        if (preferredController) {
            // Also start connecting to our kernel but don't wait for it to finish
            this.startKernel(preferredController.controller, preferredController.connection).ignoreErrors();
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
        if (this.currentKernelInfo.kernel) {
            return this.currentKernelInfo.kernel.promise;
        }
        const kernelPromise = createDeferred<IKernel>();
        this.currentKernelInfo = { controller, metadata, kernel: kernelPromise };

        const sysInfoCell = this.insertSysInfoMessage(metadata, SysInfoReason.Start);
        try {
            // Try creating a kernel
            initializeInteractiveOrNotebookTelemetryBasedOnUserAction(this.owner, metadata);

            const onStartKernel = (action: KernelAction, k: IKernel) => {
                if (action !== 'start' && action !== 'restart') {
                    return;
                }
                // Id may be different if the user switched controllers
                this.currentKernelInfo.controller = k.controller;
                this.currentKernelInfo.metadata = k.kernelConnectionMetadata;
                this.updateSysInfoMessage(
                    this.getSysInfoMessage(k.kernelConnectionMetadata, SysInfoReason.Start),
                    false,
                    sysInfoCell
                );
            };
            // When connecting, we need to update the sys info message
            this.updateSysInfoMessage(this.getSysInfoMessage(metadata, SysInfoReason.Start), false, sysInfoCell);
            const kernel = await KernelConnector.connectToKernel(
                controller,
                metadata,
                this.serviceContainer,
                { resource: this.owner, notebook: this.notebookDocument },
                new DisplayOptions(false),
                this.internalDisposables,
                'jupyterExtension',
                onStartKernel
            );
            this.currentKernelInfo.controller = kernel.controller;
            this.currentKernelInfo.metadata = kernel.kernelConnectionMetadata;

            const kernelEventHookForRestart = async (ev: 'willRestart' | 'willInterrupt') => {
                if (ev === 'willRestart' && this.notebookDocument && this.currentKernelInfo.metadata) {
                    this._insertSysInfoPromise = undefined;
                    // If we're about to restart, insert a 'restarting' message as it happens
                    void this.insertSysInfoMessage(this.currentKernelInfo.metadata, SysInfoReason.Restart);
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
            kernelPromise.resolve(kernel);
            return kernel;
        } catch (ex) {
            kernelPromise.reject(ex);
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
        if (!this._insertSysInfoPromise) {
            const func = async () => {
                const message = this.getSysInfoMessage(kernelMetadata, reason);
                await chainWithPendingUpdates(this.notebookDocument, (edit) => {
                    const markdownCell = new NotebookCellData(NotebookCellKind.Markup, message, MARKDOWN_LANGUAGE);
                    markdownCell.metadata = { isInteractiveWindowMessageCell: true, isPlaceholder: true };
                    edit.replaceNotebookCells(
                        this.notebookDocument.uri,
                        new NotebookRange(this.notebookDocument.cellCount, this.notebookDocument.cellCount),
                        [markdownCell]
                    );
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
                            edit.replaceNotebookCellMetadata(this.notebookDocument!.uri, cell.index, {
                                isInteractiveWindowMessageCell: true,
                                isPlaceholder: !finish
                            });
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
                            edit.replaceNotebookCells(
                                cell.notebook.uri,
                                new NotebookRange(cell.index, cell.index + 1),
                                []
                            );
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
        let message = await this.errorHandler.getErrorMessageForDisplayInCell(error, 'start');
        // As message is displayed in markdown, ensure linebreaks are formatted accordingly.
        message = message.split('\n').join('  \n');
        this.updateSysInfoMessage(message, true, cellPromise);
    }
    private registerControllerChangeListener(controller: IVSCodeNotebookController) {
        const controllerChangeListener = controller.controller.onDidChangeSelectedNotebooks(
            (selectedEvent: { notebook: NotebookDocument; selected: boolean }) => {
                // Controller was deselected for this InteractiveWindow's NotebookDocument
                if (selectedEvent.selected === false && selectedEvent.notebook === this.notebookEditor.document) {
                    controllerChangeListener.dispose();
                    this.disconnectKernel();
                }
            },
            this,
            this.internalDisposables
        );
    }

    private listenForControllerSelection() {
        const controller = this.notebookControllerManager.getSelectedNotebookController(this.notebookEditor.document);
        if (controller !== undefined) {
            this.registerControllerChangeListener(controller);
        }

        // Ensure we hear about any controller changes so we can update our cached promises
        this.notebookControllerManager.onNotebookControllerSelected(
            (e: { notebook: NotebookDocument; controller: IVSCodeNotebookController }) => {
                if (e.notebook !== this.notebookEditor.document) {
                    return;
                }

                // Clear cached kernel when the selected controller for this document changes
                this.registerControllerChangeListener(e.controller);
                if (e.controller.id !== this.currentKernelInfo.controller?.id) {
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
            notebookCell && notebookCell.index >= 0 ? notebookCell.index : this.notebookEditor.document.cellCount;
        // If possible display the error message in the cell.
        const controller = this.notebookControllerManager.getSelectedNotebookController(this.notebookEditor.document);
        const output = createOutputWithErrorMessageForDisplay(message);
        if (this.notebookEditor.document.cellCount === 0 || !controller || !output || !notebookCell) {
            const edit = new WorkspaceEdit();
            edit.replaceNotebookCells(
                this.notebookEditor.document.uri,
                new NotebookRange(insertionIndex, insertionIndex),
                [markdownCell]
            );
            await workspace.applyEdit(edit);
        } else {
            const execution = CellExecutionCreator.getOrCreate(notebookCell, controller.controller);
            if (!execution.started) {
                execution.start(notebookCell.executionSummary?.timing?.startTime);
            }
            execution.executionOrder = notebookCell.executionSummary?.executionOrder;
            void execution.appendOutput(output);
            void execution.end(false, notebookCell.executionSummary?.timing?.endTime);
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
        const file = getFilePath(fileUri);
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
        if (this.cellMatcher.isEmptyCell(code)) {
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
            // Add the cell first. We don't need to wait for this part as we want to add them
            // as quickly as possible
            const notebookCellPromise = this.addNotebookCell(c, fileUri, line);

            // Queue up execution
            const promise = this.createExecutionPromise(notebookCellPromise, isDebug);
            promise.catch((ex) => {
                // If execution fails due to a failure in another cell, then log that error against the cell.
                if (ex instanceof InteractiveCellResultError) {
                    void notebookCellPromise.then((cell) => {
                        if (ex.cell !== cell.cell) {
                            void this.addErrorMessage(DataScience.cellStopOnErrorMessage(), cell.cell);
                        }
                    });
                } else {
                    void notebookCellPromise.then((cell) =>
                        // If our cell result was a failure show an error
                        this.errorHandler
                            .getErrorMessageForDisplayInCell(ex, 'execution')
                            .then((message) => this.addErrorMessage(message, cell.cell))
                    );
                }
            });
            return promise;
        });

        // Last promise should be when we're all done submitting.
        return promises[promises.length - 1];
    }

    private disconnectKernel() {
        this.kernelDisposables.forEach((d) => d.dispose());
        this.kernelDisposables = [];
        this.currentKernelInfo.kernel = undefined;
    }

    @chainable()
    private async createExecutionPromise(
        notebookCellPromise: Promise<{ cell: NotebookCell; wasScrolled: boolean }>,
        isDebug: boolean
    ) {
        traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.start');
        // Kick of starting kernels early.
        const kernelPromise = this.startKernel();
        const { cell, wasScrolled } = await notebookCellPromise;

        let success = true;
        let kernelBeginDisposable = undefined;

        // Scroll if the initial placement of this cell was scrolled as well
        const settings = this.configuration.getSettings(this.owningResource);
        if (settings.alwaysScrollOnNewCell || wasScrolled) {
            this.revealCell(cell, false);
        }

        let detachKernel = async () => noop();
        try {
            const kernel = await kernelPromise;
            if (
                kernel.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel' ||
                kernel.kernelConnectionMetadata.kind === 'startUsingRemoteKernelSpec'
            ) {
                void this.appShell.showErrorMessage(DataScience.remoteDebuggerNotSupported());
                isDebug = false;
            }
            detachKernel = async () => {
                if (isDebug) {
                    await this.interactiveWindowDebugger.detach(kernel!);
                }
            };

            // If debugging attach to the kernel but don't enable tracing just yet
            if (isDebug) {
                await this.interactiveWindowDebugger.attach(kernel);

                // Enable has to happen after the hidden code so that we don't hit breakpoints from previous cells
                // Example:
                // User has breakpoint on previous cell with name <ipython-2-hashystuff>
                // We turn on tracing
                // Hidden cell executes to set next cell to name <ipython-3-hashyotherstuff>
                // Breakpoint fires in <ipython-2-hashystuff> because hidden cell inherits that value.
                // So we have to enable tracing after we send the hidden cell.
                kernelBeginDisposable = kernel.onPreExecute((c) => {
                    if (c === cell) {
                        this.interactiveWindowDebugger.enable(kernel);
                    }
                });
            }
            traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.kernel.executeCell');
            success = (await kernel!.executeCell(cell)) !== NotebookCellRunState.Error;
            traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.kernel.executeCell.finished');

            // After execution see if we need to scroll to this cell or not.
            if (settings.alwaysScrollOnNewCell || wasScrolled) {
                this.revealCell(cell, false);
            }
        } finally {
            await detachKernel();
            if (kernelBeginDisposable) {
                kernelBeginDisposable.dispose();
            }
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
        await this.setFileInKernel(getFilePath(fileUri), kernel!);
        traceInfoIfCI('file in kernel set for IW');
    }

    public async expandAllCells() {
        await Promise.all(
            this.notebookEditor.document.getCells().map(async (_cell, index) => {
                await this.commandManager.executeCommand('notebook.cell.expandCellInput', {
                    ranges: [{ start: index, end: index + 1 }],
                    document: this.notebookEditor.document.uri
                });
            })
        );
    }

    public async collapseAllCells() {
        await Promise.all(
            this.notebookEditor.document.getCells().map(async (cell, index) => {
                if (cell.kind !== NotebookCellKind.Code) {
                    return;
                }
                await this.commandManager.executeCommand('notebook.cell.collapseCellInput', {
                    ranges: [{ start: index, end: index + 1 }],
                    document: this.notebookEditor.document.uri
                });
            })
        );
    }

    public async scrollToCell(id: string): Promise<void> {
        await this.show();
        const matchingCell = this.notebookEditor.document
            .getCells()
            .find((cell) => getInteractiveCellMetadata(cell)?.id === id);
        if (matchingCell) {
            this.revealCell(matchingCell, true);
        }
    }

    private revealCell(notebookCell: NotebookCell, useDecoration: boolean) {
        const notebookRange = new NotebookRange(notebookCell.index, notebookCell.index + 1);
        this.pendingNotebookScrolls.push(notebookRange);
        const decorationType = useDecoration
            ? notebooks.createNotebookEditorDecorationType({
                  backgroundColor: new ThemeColor('peekViewEditor.background'),
                  top: {}
              })
            : undefined;
        // This will always try to reveal the whole cell--input + output combined
        setTimeout(() => {
            this.notebookEditor.revealRange(notebookRange, NotebookEditorRevealType.Default);

            // No longer pending
            this.pendingNotebookScrolls.shift();

            // Also add a decoration to make it look highlighted (peek background color)
            if (decorationType) {
                this.notebookEditor.setDecorations(decorationType, notebookRange);

                // Fire another timeout to dispose of the decoration
                setTimeout(() => {
                    decorationType.dispose();
                }, 2000);
            }
        }, 200); // Rendering output is async so the output is not guaranteed to immediately exist
    }

    public async hasCell(id: string): Promise<boolean> {
        return this.notebookEditor.document.getCells().some((cell) => getInteractiveCellMetadata(cell)?.id === id);
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

    private async setFileInKernel(file: string, kernel: IKernel): Promise<void> {
        // If in perFile mode, set only once
        if (this.mode === 'perFile' && !this.fileInKernel) {
            traceInfoIfCI(`Initializing __file__ in setFileInKernel with ${file} for mode ${this.mode}`);
            this.fileInKernel = file;
            await kernel.executeHidden(`__file__ = '${file.replace(/\\/g, '\\\\')}'`);
        } else if (
            (!this.fileInKernel || !this.fs.areLocalPathsSame(this.fileInKernel, file)) &&
            this.mode !== 'perFile'
        ) {
            traceInfoIfCI(`Initializing __file__ in setFileInKernel with ${file} for mode ${this.mode}`);
            // Otherwise we need to reset it every time
            this.fileInKernel = file;
            await kernel.executeHidden(`__file__ = '${file.replace(/\\/g, '\\\\')}'`);
        } else {
            traceInfoIfCI(
                `Not Initializing __file__ in setFileInKernel with ${file} for mode ${this.mode} currently ${this.fileInKernel}`
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

    @chainable()
    private async addNotebookCell(
        code: string,
        file: Uri,
        line: number
    ): Promise<{ cell: NotebookCell; wasScrolled: boolean }> {
        const notebookDocument = this.notebookEditor.document;

        // Compute if we should scroll based on last notebook cell before adding a notebook cell,
        // since the notebook cell we're going to add is by definition not visible
        const shouldScroll =
            this.notebookEditor.visibleRanges.find((r) => {
                return r.end === this.notebookEditor.document.cellCount;
            }) != undefined ||
            this.pendingNotebookScrolls.find((r) => r.end == this.notebookEditor.document.cellCount - 1) != undefined;

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
        notebookCellData.metadata = <InteractiveCellMetadata>{
            interactiveWindowCellMarker,
            interactive: {
                uristring: file.toString(), // Has to be simple types
                line: line,
                originalSource: code
            },
            id: uuid()
        };
        await chainWithPendingUpdates(notebookDocument, (edit) => {
            edit.replaceNotebookCells(
                notebookDocument.uri,
                new NotebookRange(notebookDocument.cellCount, notebookDocument.cellCount),
                [notebookCellData]
            );
        });
        const cell = notebookDocument.cellAt(notebookDocument.cellCount - 1);

        // The default behavior is to scroll to the last cell if the user is already at the bottom
        // of the history, but not to scroll if the user has scrolled somewhere in the middle
        // of the history. The jupyter.alwaysScrollOnNewCell setting overrides this to always scroll
        // to newly-inserted cells.
        if (settings.alwaysScrollOnNewCell || shouldScroll) {
            this.revealCell(cell, false);
        }

        return { cell, wasScrolled: shouldScroll };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty,@typescript-eslint/no-empty-function
    public async export() {
        // Export requires the python extension
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }

        const { magicCommandsAsComments } = this.configuration.getSettings(this.owningResource);
        const cells = generateCellsFromNotebookDocument(this.notebookEditor.document, magicCommandsAsComments);

        // Should be an array of cells
        if (cells && this.exportDialog) {
            // Bring up the export file dialog box
            const uri = await this.exportDialog.showDialog(ExportFormat.ipynb, this.owningResource);
            if (uri) {
                await this.jupyterExporter.exportToFile(cells, getFilePath(uri));
            }
        }
    }

    public async exportAs() {
        const kernel = await this.startKernel();
        // Export requires the python extension
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }

        // Pull out the metadata from our active notebook
        const metadata: nbformat.INotebookMetadata = { orig_nbformat: defaultNotebookFormat.major };
        if (kernel) {
            updateNotebookMetadata(metadata, kernel.kernelConnectionMetadata);
        }

        let defaultFileName;
        if (this.submitters && this.submitters.length) {
            const lastSubmitter = this.submitters[this.submitters.length - 1];
            defaultFileName = path.basename(lastSubmitter.fsPath, path.extname(lastSubmitter.fsPath));
        }

        // Then run the export command with these contents
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
