// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type * as nbformat from '@jupyterlab/nbformat';
import * as path from 'path';
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
    ViewColumn,
    NotebookEditor,
    Disposable,
    window,
    ThemeColor
} from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { ICommandManager, IDocumentManager, IWorkspaceService } from '../../common/application/types';
import { JVSC_EXTENSION_ID, MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../common/constants';
import '../../common/extensions';
import { traceInfo, traceInfoIfCI } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import * as uuid from 'uuid/v4';

import { IConfigurationService, InteractiveWindowMode, Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { generateCellsFromNotebookDocument } from '../cellFactory';
import { CellMatcher } from '../cellMatcher';
import { Commands, defaultNotebookFormat } from '../constants';
import { ExportFormat, IExportDialog } from '../export/types';
import { IKernel, KernelConnectionMetadata, NotebookCellRunState } from '../jupyter/kernels/types';
import { INotebookControllerManager } from '../notebook/types';
import { VSCodeNotebookController } from '../notebook/vscodeNotebookController';
import { updateNotebookMetadata } from '../notebookStorage/baseModel';
import { IInteractiveWindowLoadable, IInteractiveWindowDebugger, INotebookExporter } from '../types';
import { getInteractiveWindowTitle } from './identity';
import { generateMarkdownFromCodeLines, parseForComments } from '../../../datascience-ui/common';
import { chainWithPendingUpdates } from '../notebook/helpers/notebookUpdater';
import { INativeInteractiveWindow } from './types';
import { generateInteractiveCode } from '../../../datascience-ui/common/cellFactory';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../telemetry/telemetry';
import { InteractiveWindowView } from '../notebook/constants';
import { chainable } from '../../common/utils/decorators';
import { InteractiveCellResultError } from '../errors/interactiveCellResultError';
import { DataScience } from '../../common/utils/localize';
import { SysInfoReason } from '../interactive-common/interactiveWindowTypes';
import { createDeferred } from '../../common/utils/async';
import { connectToKernel } from '../jupyter/kernels/helpers';
import { IServiceContainer } from '../../ioc/types';

type InteractiveCellMetadata = {
    interactiveWindowCellMarker: string;
    interactive: {
        uristring: string;
        line: number;
        originalSource: string;
    };
    id: string;
};
export function getInteractiveCellMetadata(cell: NotebookCell): InteractiveCellMetadata | undefined {
    if (cell.metadata.interactive !== undefined) {
        return cell.metadata as InteractiveCellMetadata;
    }
}
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
    public get notebookUri(): Uri | undefined {
        return this._notebookDocument?.uri;
    }
    public get notebookEditor(): NotebookEditor | undefined {
        return this._notebookEditor;
    }
    public get notebookDocument(): NotebookDocument | undefined {
        return this._notebookDocument;
    }
    private _onDidChangeViewState = new EventEmitter<void>();
    private closedEvent = new EventEmitter<void>();
    private _owner: Uri | undefined;
    private _submitters: Uri[] = [];
    private mode: InteractiveWindowMode = 'multiple';
    private fileInKernel: string | undefined;
    private cellMatcher;

    private internalDisposables: Disposable[] = [];
    private kernelDisposables: Disposable[] = [];
    private _editorReadyPromise: Promise<NotebookEditor>;
    private _insertSysInfoPromise: Promise<NotebookCell | undefined> | undefined;
    private _kernelPromise = createDeferred<IKernel>();
    private _kernelConnectionId: string | undefined;
    private _notebookDocument: NotebookDocument | undefined;
    private _notebookEditor: NotebookEditor | undefined;
    private _inputUri: Uri | undefined;
    private pendingNotebookScrolls: NotebookRange[] = [];
    private _kernelEventHook: ((event: 'willInterrupt' | 'willRestart') => Promise<void>) | undefined;

    constructor(
        private readonly documentManager: IDocumentManager,
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
        private readonly serviceContainer: IServiceContainer,
        private readonly interactiveWindowDebugger: IInteractiveWindowDebugger,
        public readonly originalConnection?: KernelConnectionMetadata
    ) {
        // Set our owner and first submitter
        this._owner = owner;
        this.mode = mode;
        if (owner) {
            this._submitters.push(owner);
        }

        // Setup our 'ready' promise
        this._editorReadyPromise = this.createReadyPromise(originalConnection);

        workspace.onDidCloseNotebookDocument((notebookDocument) => {
            if (notebookDocument === this._notebookDocument) {
                this.closedEvent.fire();
            }
        }, this.internalDisposables);

        this.cellMatcher = new CellMatcher(this.configuration.getSettings(this.owningResource));
    }

    private async createReadyPromise(
        originalConnection: KernelConnectionMetadata | undefined
    ): Promise<NotebookEditor> {
        // Find our preferred controller
        const preferredController = await this.getPreferredController(originalConnection);

        // Create our editor using that controller
        const editor = await this.createEditor(preferredController);

        // If that worked, insert our first sys info message
        if (editor && preferredController) {
            await this.insertSysInfoMessage(editor.document, preferredController.connection, SysInfoReason.Start);

            // Also start connecting to our kernel but don't wait for it to finish
            this.startKernel(editor.document, preferredController).ignoreErrors();
        }

        return editor;
    }

    private async startKernel(notebook: NotebookDocument, controller: VSCodeNotebookController): Promise<void> {
        if (controller.id !== this._kernelConnectionId) {
            this._kernelConnectionId = controller.id;

            const sysInfoCell = this.insertSysInfoMessage(notebook, controller.connection, SysInfoReason.Start);
            try {
                // Try creating a kernel
                initializeInteractiveOrNotebookTelemetryBasedOnUserAction(this.owner, controller.connection);
                const kernel = await connectToKernel(controller, this.serviceContainer, this.owner, notebook);
                // Hook pre interrupt so we can stick in a message
                this._kernelEventHook = this.kernelEventHook.bind(this, kernel);
                kernel.addEventHook(this._kernelEventHook);
                this.kernelDisposables.push({
                    dispose: () => {
                        if (this._kernelEventHook) {
                            kernel.removeEventHook(this._kernelEventHook);
                            this._kernelEventHook = undefined;
                        }
                    }
                });

                // When restart finishes, rerun our initialization code
                kernel.onRestarted(
                    async () => {
                        traceInfoIfCI('Restart event handled in IW');
                        this.fileInKernel = undefined;
                        const cellPromise = Promise.resolve(notebook?.cellAt(notebook.cellCount - 1));
                        try {
                            await this.runInitialization(kernel, this.owner);
                        } finally {
                            this.updateSysInfoMessage(kernel, cellPromise, SysInfoReason.Restart);
                        }
                    },
                    this,
                    this.kernelDisposables
                );
                this.kernelDisposables.push(kernel);
                this.fileInKernel = undefined;
                await this.runInitialization(kernel, this.owner);
                this.updateSysInfoMessage(kernel, sysInfoCell, SysInfoReason.Start);
                this._kernelPromise.resolve(kernel);
            } catch (ex) {
                this.updateSysInfoMessage(ex, sysInfoCell, SysInfoReason.Start);
                this._kernelPromise.resolve(undefined);
                this.disconnectKernel();
            }
        }
    }

    private async kernelEventHook(kernel: IKernel, ev: 'willRestart' | 'willInterrupt') {
        if (ev === 'willRestart' && this._notebookDocument) {
            this._insertSysInfoPromise = undefined;
            // If we're about to restart, insert a 'restarting' message as it happens
            void this.insertSysInfoMessage(
                this._notebookDocument,
                kernel.kernelConnectionMetadata,
                SysInfoReason.Restart
            );
        }
    }

    private async insertSysInfoMessage(
        notebookDocument: NotebookDocument,
        kernelMetadata: KernelConnectionMetadata,
        reason: SysInfoReason
    ): Promise<NotebookCell | undefined> {
        if (!this._insertSysInfoPromise) {
            const func = async () => {
                const kernelName = kernelMetadata.interpreter?.displayName;
                const message =
                    reason === SysInfoReason.Restart
                        ? kernelName
                            ? DataScience.restartingKernelCustomHeader().format(kernelName)
                            : DataScience.restartingKernelHeader()
                        : kernelName
                        ? DataScience.startingNewKernelCustomHeader().format(kernelName)
                        : DataScience.startingNewKernelHeader();
                await chainWithPendingUpdates(notebookDocument, (edit) => {
                    const markdownCell = new NotebookCellData(NotebookCellKind.Markup, message, MARKDOWN_LANGUAGE);
                    markdownCell.metadata = { isInteractiveWindowMessageCell: true, isPlaceholder: true };
                    edit.replaceNotebookCells(
                        notebookDocument.uri,
                        new NotebookRange(notebookDocument.cellCount, notebookDocument.cellCount),
                        [markdownCell]
                    );
                });
                // This should be the cell we just inserted into the document
                return notebookDocument.cellAt(notebookDocument.cellCount - 1);
            };
            this._insertSysInfoPromise = func();
        }
        return this._insertSysInfoPromise;
    }

    private updateSysInfoMessage(
        kernelOrError: IKernel | Error,
        cellPromise: Promise<NotebookCell | undefined>,
        reason: SysInfoReason
    ) {
        cellPromise
            .then((cell) =>
                chainWithPendingUpdates(this._notebookDocument!, (edit) => {
                    if (cell !== undefined && cell.index >= 0) {
                        if (
                            cell.kind === NotebookCellKind.Markup &&
                            cell.metadata.isInteractiveWindowMessageCell &&
                            cell.metadata.isPlaceholder
                        ) {
                            const kernelName =
                                'info' in kernelOrError
                                    ? kernelOrError.kernelConnectionMetadata.interpreter?.displayName
                                    : '';
                            const kernelInfo =
                                'info' in kernelOrError && kernelOrError.info?.status === 'ok'
                                    ? kernelOrError.info
                                    : undefined;
                            const banner = kernelInfo
                                ? kernelInfo.banner.split('\n').join('  \n')
                                : kernelOrError.toString();
                            const message =
                                reason == SysInfoReason.Restart
                                    ? DataScience.restartedKernelHeader().format(kernelName || '')
                                    : banner;
                            edit.replace(cell.document.uri, new Range(0, 0, cell.document.lineCount, 0), message);
                            edit.replaceNotebookCellMetadata(this._notebookDocument!.uri, cell.index, {
                                isInteractiveWindowMessageCell: true,
                                isPlaceholder: false
                            });
                            return;
                        }
                    }
                })
            )
            .ignoreErrors();
    }

    private async getPreferredController(
        connection?: KernelConnectionMetadata
    ): Promise<VSCodeNotebookController | undefined> {
        const preferredController = connection
            ? this.notebookControllerManager.getControllerForConnection(connection, 'interactive')
            : await this.notebookControllerManager.getActiveInterpreterOrDefaultController(
                  InteractiveWindowView,
                  this.owner
              );
        return preferredController;
    }

    private async createEditor(preferredController: VSCodeNotebookController | undefined): Promise<NotebookEditor> {
        const controllerId = preferredController ? `${JVSC_EXTENSION_ID}/${preferredController.id}` : undefined;
        traceInfo(`Starting interactive window with controller ID ${controllerId}`);
        const hasOwningFile = this.owner !== undefined;
        const { inputUri, notebookEditor } = ((await this.commandManager.executeCommand(
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
        this._notebookEditor = notebookEditor;
        this._notebookDocument = notebookEditor.document;
        this._inputUri = inputUri;
        this.internalDisposables.push(
            window.onDidChangeActiveNotebookEditor((e) => {
                if (e === this._notebookEditor) {
                    this._onDidChangeViewState.fire();
                }
            })
        );

        if (window.activeNotebookEditor === this._notebookEditor) {
            this._onDidChangeViewState.fire();
        }

        this.listenForControllerSelection(notebookEditor.document);
        return notebookEditor;
    }

    private registerControllerChangeListener(controller: VSCodeNotebookController, notebookDocument: NotebookDocument) {
        const controllerChangeListener = controller.controller.onDidChangeSelectedNotebooks(
            (selectedEvent: { notebook: NotebookDocument; selected: boolean }) => {
                // Controller was deselected for this InteractiveWindow's NotebookDocument
                if (selectedEvent.selected === false && selectedEvent.notebook === notebookDocument) {
                    controllerChangeListener.dispose();
                    this.disconnectKernel();
                }
            },
            this,
            this.internalDisposables
        );
    }

    private listenForControllerSelection(notebookDocument: NotebookDocument) {
        const controller = this.notebookControllerManager.getSelectedNotebookController(notebookDocument);
        if (controller !== undefined) {
            this.registerControllerChangeListener(controller, notebookDocument);
        }

        // Ensure we hear about any controller changes so we can update our cached promises
        this.notebookControllerManager.onNotebookControllerSelected(
            (e: { notebook: NotebookDocument; controller: VSCodeNotebookController }) => {
                if (e.notebook !== notebookDocument) {
                    return;
                }

                // Clear cached kernel when the selected controller for this document changes
                this.registerControllerChangeListener(e.controller, notebookDocument);
                if (e.controller.id !== this._kernelConnectionId) {
                    this.disconnectKernel();
                    this.startKernel(e.notebook, e.controller).ignoreErrors();
                }
            },
            this,
            this.internalDisposables
        );
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

    public get inputUri() {
        return this._inputUri;
    }

    public dispose() {
        this.internalDisposables.forEach((d) => d.dispose());
        this.disconnectKernel();
    }

    // Add message to the notebook document in a markdown cell
    @chainable()
    public async addMessage(message: string, getIndex?: (editor: NotebookEditor) => number): Promise<void> {
        const notebookEditor = await this._editorReadyPromise;
        const edit = new WorkspaceEdit();
        const markdownCell = new NotebookCellData(NotebookCellKind.Markup, message, MARKDOWN_LANGUAGE);
        markdownCell.metadata = { isInteractiveWindowMessageCell: true };
        const index = getIndex ? getIndex(notebookEditor) : -1;
        const insertionIndex = index >= 0 ? index : notebookEditor.document.cellCount;
        edit.replaceNotebookCells(notebookEditor.document.uri, new NotebookRange(insertionIndex, insertionIndex), [
            markdownCell
        ]);
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
        if (this.cellMatcher.stripFirstMarker(code).trim().length === 0) {
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
            return this.createExecutionPromise(notebookCellPromise, isDebug);
        });

        // Last promise should be when we're all done submitting.
        return promises[promises.length - 1];
    }

    private disconnectKernel() {
        this.kernelDisposables.forEach((d) => d.dispose());
        this.kernelDisposables = [];
        if (this._kernelPromise.resolved) {
            this._kernelPromise = createDeferred<IKernel>();
        }
        this._kernelConnectionId = undefined;
    }

    @chainable()
    private async createExecutionPromise(
        notebookCellPromise: Promise<{ cell: NotebookCell; wasScrolled: boolean }>,
        isDebug: boolean
    ) {
        traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.start');
        const [kernel, { cell, wasScrolled }, editor] = await Promise.all([
            this._kernelPromise.promise,
            notebookCellPromise,
            this._editorReadyPromise
        ]);
        if (!kernel) {
            return false;
        }
        let result = true;
        let kernelBeginDisposable = undefined;

        // Scroll if the initial placement of this cell was scrolled as well
        const settings = this.configuration.getSettings(this.owningResource);
        if (settings.alwaysScrollOnNewCell || wasScrolled) {
            this.revealCell(cell, editor, false);
        }

        try {
            // If debugging attach to the kernel but don't enable tracing just yet
            if (isDebug) {
                await this.interactiveWindowDebugger.attach(kernel!);

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
            result = (await kernel!.executeCell(cell)) !== NotebookCellRunState.Error;
            traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.kernel.executeCell.finished');

            // After execution see if we need to scroll to this cell or not.
            if (settings.alwaysScrollOnNewCell || wasScrolled) {
                this.revealCell(cell, editor, false);
            }
        } finally {
            if (isDebug) {
                await this.interactiveWindowDebugger.detach(kernel!);
            }
            if (kernelBeginDisposable) {
                kernelBeginDisposable.dispose();
            }
            traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.end');
        }

        if (!result) {
            // Throw to break out of the promise chain
            throw new InteractiveCellResultError();
        }
        return result;
    }

    private async runInitialization(kernel: IKernel, fileUri: Resource) {
        if (!fileUri) {
            traceInfoIfCI('Unable to run initialization for IW');
            return;
        }

        // If the file isn't unknown, set the active kernel's __file__ variable to point to that same file.
        await this.setFileInKernel(fileUri.fsPath, kernel!);
        traceInfoIfCI('file in kernel set for IW');
    }

    public async expandAllCells() {
        const notebookEditor = await this._editorReadyPromise;
        await Promise.all(
            notebookEditor.document.getCells().map(async (_cell, index) => {
                await this.commandManager.executeCommand('notebook.cell.expandCellInput', {
                    ranges: [{ start: index, end: index + 1 }],
                    document: notebookEditor.document.uri
                });
            })
        );
    }

    public async collapseAllCells() {
        const notebookEditor = await this._editorReadyPromise;
        await Promise.all(
            notebookEditor.document.getCells().map(async (cell, index) => {
                if (cell.kind !== NotebookCellKind.Code) {
                    return;
                }
                await this.commandManager.executeCommand('notebook.cell.collapseCellInput', {
                    ranges: [{ start: index, end: index + 1 }],
                    document: notebookEditor.document.uri
                });
            })
        );
    }

    public async scrollToCell(id: string): Promise<void> {
        const notebookEditor = await this._editorReadyPromise;
        await this.show();
        const matchingCell = notebookEditor.document
            .getCells()
            .find((cell) => getInteractiveCellMetadata(cell)?.id === id);
        if (matchingCell) {
            this.revealCell(matchingCell, notebookEditor, true);
        }
    }

    private revealCell(notebookCell: NotebookCell, notebookEditor: NotebookEditor, useDecoration: boolean) {
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
            notebookEditor.revealRange(notebookRange, NotebookEditorRevealType.Default);

            // No longer pending
            this.pendingNotebookScrolls.shift();

            // Also add a decoration to make it look highlighted (peek background color)
            if (decorationType) {
                notebookEditor.setDecorations(decorationType, notebookRange);

                // Fire another timeout to dispose of the decoration
                setTimeout(() => {
                    decorationType.dispose();
                }, 2000);
            }
        }, 200); // Rendering output is async so the output is not guaranteed to immediately exist
    }

    public async hasCell(id: string): Promise<boolean> {
        const notebookEditor = await this._editorReadyPromise;
        if (!notebookEditor) {
            return false;
        }
        return notebookEditor.document.getCells().some((cell) => getInteractiveCellMetadata(cell)?.id === id);
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
        // Wait for the editor to be ready.
        const editor = await this._editorReadyPromise;
        const notebookDocument = editor.document;

        // Compute if we should scroll based on last notebook cell before adding a notebook cell,
        // since the notebook cell we're going to add is by definition not visible
        const shouldScroll =
            editor?.visibleRanges.find((r) => {
                return r.end === editor.document.cellCount - 1;
            }) != undefined ||
            this.pendingNotebookScrolls.find((r) => r.end == editor.document.cellCount - 1) != undefined;

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
            this.revealCell(cell, editor, false);
        }

        return { cell, wasScrolled: shouldScroll };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty,@typescript-eslint/no-empty-function
    public async export() {
        const notebookEditor = await this._editorReadyPromise;
        // Export requires the python extension
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        }

        const { magicCommandsAsComments } = this.configuration.getSettings(this.owningResource);
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
        const kernel = await this._kernelPromise.promise;
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
