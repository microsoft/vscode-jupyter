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
    workspace,
    WorkspaceEdit,
    notebooks,
    Position,
    Range,
    Selection,
    commands,
    TextEditorRevealType,
    ViewColumn,
    NotebookEditor,
    Disposable,
    window,
    ThemeColor
} from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IWorkspaceService
} from '../../common/application/types';
import { JVSC_EXTENSION_ID, MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../common/constants';
import '../../common/extensions';
import { traceInfo, traceInfoIfCI } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import * as uuid from 'uuid/v4';

import { IConfigurationService, IDisposableRegistry, InteractiveWindowMode, Resource } from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import { noop } from '../../common/utils/misc';
import { generateCellsFromNotebookDocument } from '../cellFactory';
import { CellMatcher } from '../cellMatcher';
import { Commands, defaultNotebookFormat } from '../constants';
import { ExportFormat, IExportDialog } from '../export/types';
import { InteractiveWindowMessages } from '../interactive-common/interactiveWindowTypes';
import { IKernel, IKernelProvider, NotebookCellRunState } from '../jupyter/kernels/types';
import { INotebookControllerManager } from '../notebook/types';
import { VSCodeNotebookController } from '../notebook/vscodeNotebookController';
import { updateNotebookMetadata } from '../notebookStorage/baseModel';
import { IInteractiveWindowLoadable, IInteractiveWindowDebugger, INotebookExporter } from '../types';
import { getInteractiveWindowTitle } from './identity';
import { generateMarkdownFromCodeLines } from '../../../datascience-ui/common';
import { chainWithPendingUpdates } from '../notebook/helpers/notebookUpdater';
import { LineQueryRegex, linkCommandAllowList } from '../interactive-common/linkProvider';
import { INativeInteractiveWindow } from './types';
import { generateInteractiveCode } from '../../../datascience-ui/common/cellFactory';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from '../telemetry/telemetry';
import { InteractiveWindowView } from '../notebook/constants';

type InteractiveCellMetadata = {
    inputCollapsed: boolean;
    interactiveWindowCellMarker: string;
    interactive: {
        file: string;
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
    // Promise that resolves when the interactive window is ready to handle code execution.
    public get readyPromise(): Promise<void> {
        return Promise.all([this._editorReadyPromise, this._kernelReadyPromise]).then(noop, noop);
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
    private _editorReadyPromise: Promise<NotebookEditor>;
    private _controllerReadyPromise: Deferred<VSCodeNotebookController>;
    private _kernelReadyPromise: Promise<IKernel> | undefined;
    private _notebookDocument: NotebookDocument | undefined;
    private executionPromise: Promise<boolean> | undefined;
    private _notebookEditor: NotebookEditor | undefined;
    private _inputUri: Uri | undefined;

    constructor(
        private readonly applicationShell: IApplicationShell,
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
        private readonly kernelProvider: IKernelProvider,
        private readonly disposables: IDisposableRegistry,
        private readonly interactiveWindowDebugger: IInteractiveWindowDebugger
    ) {
        // Set our owner and first submitter
        this._owner = owner;
        this.mode = mode;
        if (owner) {
            this._submitters.push(owner);
        }

        // Request creation of the interactive window from VS Code
        this._editorReadyPromise = this.createEditorReadyPromise();

        // Wait for a controller to get selected
        this._controllerReadyPromise = createDeferred<VSCodeNotebookController>();

        // Set up promise for kernel ready
        this._kernelReadyPromise = this.createKernelReadyPromise();

        workspace.onDidCloseNotebookDocument((notebookDocument) => {
            if (notebookDocument === this._notebookDocument) {
                this.closedEvent.fire();
            }
        }, this.internalDisposables);

        this.cellMatcher = new CellMatcher(this.configuration.getSettings(this.owningResource));
    }

    private async createKernelReadyPromise(): Promise<IKernel> {
        const editor = await this._editorReadyPromise;
        const controller = await this._controllerReadyPromise.promise;
        initializeInteractiveOrNotebookTelemetryBasedOnUserAction(this.owner, controller.connection);
        const kernel = this.kernelProvider.getOrCreate(editor.document, {
            metadata: controller.connection,
            controller: controller.controller,
            resourceUri: this.owner
        });
        kernel.onRestarted(
            async () => {
                traceInfoIfCI('Restart event handled in IW');
                this.fileInKernel = undefined;
                const promise = this.runIntialization(kernel, this.owner);
                this._kernelReadyPromise = promise.then(() => kernel);
                await promise;
            },
            this,
            this.internalDisposables
        );
        this.internalDisposables.push(kernel);
        await kernel.start();
        this.fileInKernel = undefined;
        await this.runIntialization(kernel, this.owner);
        return kernel;
    }

    private async createEditorReadyPromise(): Promise<NotebookEditor> {
        const preferredController = await this.notebookControllerManager.getActiveInterpreterOrDefaultController(
            InteractiveWindowView,
            this.owner
        );
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
        this.listenForControllerSelection(notebookEditor.document);
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

    private registerControllerChangeListener(controller: VSCodeNotebookController, notebookDocument: NotebookDocument) {
        const controllerChangeListener = controller.controller.onDidChangeSelectedNotebooks(
            (selectedEvent: { notebook: NotebookDocument; selected: boolean }) => {
                // Controller was deselected for this InteractiveWindow's NotebookDocument
                if (selectedEvent.selected === false && selectedEvent.notebook === notebookDocument) {
                    this._controllerReadyPromise = createDeferred<VSCodeNotebookController>();
                    this._kernelReadyPromise = undefined;
                    this.executionPromise = undefined;
                    controllerChangeListener.dispose();
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
            this._controllerReadyPromise.resolve(controller);
        }

        // Ensure we hear about any controller changes so we can update our cached promises
        this.notebookControllerManager.onNotebookControllerSelected(
            (e: { notebook: NotebookDocument; controller: VSCodeNotebookController }) => {
                if (e.notebook !== notebookDocument) {
                    return;
                }

                // Clear cached kernel when the selected controller for this document changes
                this.registerControllerChangeListener(e.controller, notebookDocument);
                this._controllerReadyPromise.resolve(e.controller);

                // Recreate the kernel ready promise now that we have a new controller
                this._kernelReadyPromise = this.createKernelReadyPromise();
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
        if (this.cellMatcher.stripFirstMarker(code).trim().length === 0) {
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
        try {
            return await this.executionPromise;
        } catch (exc) {
            // Rethrow, but clear execution promise so we can execute again
            this.executionPromise = undefined;
            throw exc;
        }
    }
    private async createExecutionPromise(code: string, fileUri: Uri, line: number, isDebug: boolean) {
        traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.start');
        const [notebookEditor, kernel] = await Promise.all([
            this._editorReadyPromise,
            this._kernelReadyPromise,
            this.updateOwners(fileUri)
        ]);
        const id = uuid();

        // Compute isAtBottom based on last notebook cell before adding a notebook cell,
        // since the notebook cell we're going to add is by definition not visible
        const isLastCellVisible = notebookEditor?.visibleRanges.find((r) => {
            return r.end === notebookEditor.document.cellCount - 1;
        });
        traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.before.AddNotebookCell');
        const notebookCell = await this.addNotebookCell(notebookEditor.document, code, fileUri, line, id);
        traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.after.AddNotebookCell');
        const settings = this.configuration.getSettings(this.owningResource);
        // The default behavior is to scroll to the last cell if the user is already at the bottom
        // of the history, but not to scroll if the user has scrolled somewhere in the middle
        // of the history. The jupyter.alwaysScrollOnNewCell setting overrides this to always scroll
        // to newly-inserted cells.
        if (settings.alwaysScrollOnNewCell || isLastCellVisible) {
            this.revealCell(notebookCell, notebookEditor, false);
        }

        if (!kernel) {
            return false;
        }
        let result = true;
        let kernelBeginDisposable = undefined;
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
                    if (c === notebookCell) {
                        this.interactiveWindowDebugger.enable(kernel);
                    }
                });
            }
            traceInfoIfCI('InteractiveWindow.ts.createExecutionPromise.kernel.executeCell');
            result = (await kernel!.executeCell(notebookCell)) !== NotebookCellRunState.Error;

            traceInfo(`Finished execution for ${id}`);
        } finally {
            if (isDebug) {
                await this.interactiveWindowDebugger.detach(kernel!);
            }
            if (kernelBeginDisposable) {
                kernelBeginDisposable.dispose();
            }
        }
        return result;
    }
    private async runIntialization(kernel: IKernel, fileUri: Resource) {
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
        const matchingCell = notebookEditor.document
            .getCells()
            .find((cell) => getInteractiveCellMetadata(cell)?.id === id);
        if (matchingCell) {
            this.revealCell(matchingCell, notebookEditor, true);
        }
    }

    private revealCell(notebookCell: NotebookCell, notebookEditor: NotebookEditor, useDecoration: boolean) {
        const notebookRange = new NotebookRange(notebookCell.index, notebookCell.index + 1);
        const decorationType = useDecoration
            ? notebooks.createNotebookEditorDecorationType({
                  backgroundColor: new ThemeColor('peekViewEditor.background'),
                  top: {}
              })
            : undefined;
        // This will always try to reveal the whole cell--input + output combined
        setTimeout(() => {
            notebookEditor.revealRange(notebookRange, NotebookEditorRevealType.Default);

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
        // ensure editor is opened but not focused
        await this.commandManager.executeCommand(
            'interactive.open',
            { preserveFocus: true },
            notebookDocument.uri,
            this.notebookControllerManager.getSelectedNotebookController(notebookDocument)?.id,
            undefined
        );

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
            inputCollapsed: !isMarkdown && settings.collapseCellInputCodeByDefault,
            interactiveWindowCellMarker,
            interactive: {
                file: file.fsPath,
                line: line,
                originalSource: code
            },
            id: id
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
        const kernel = await this._kernelReadyPromise;
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

    public get kernelPromise() {
        if (this._kernelReadyPromise) {
            return this._kernelReadyPromise;
        }
        return Promise.resolve(undefined);
    }
}
