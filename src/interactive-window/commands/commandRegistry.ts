// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, optional } from 'inversify';
import {
    CodeLens,
    ConfigurationTarget,
    env,
    Range,
    Uri,
    commands,
    NotebookCell,
    NotebookEdit,
    NotebookRange,
    Selection,
    Position,
    ViewColumn,
    workspace,
    WorkspaceEdit
} from 'vscode';
import { IKernelProvider, KernelConnectionMetadata } from '../../kernels/types';
import { ICommandNameArgumentTypeMapping } from '../../commands';
import {
    IApplicationShell,
    IClipboard,
    ICommandManager,
    IDebugService,
    IDocumentManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../platform/common/application/types';

import { IConfigurationService, IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { isUri, noop } from '../../platform/common/utils/misc';
import { capturePerfTelemetry, captureUsageTelemetry } from '../../telemetry';
import { Commands, CommandSource, PYTHON_LANGUAGE, Telemetry } from '../../platform/common/constants';
import { IDataScienceCodeLensProvider, ICodeWatcher } from '../editor-integration/types';
import { IInteractiveWindowProvider } from '../types';
import * as urlPath from '../../platform/vscode-path/resources';
import { getDisplayPath, getFilePath } from '../../platform/common/platform/fs-paths';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { ExportFormat, IExportDialog, IFileConverter } from '../../notebooks/export/types';
import { openAndShowNotebook } from '../../platform/common/utils/notebooks';
import { JupyterInstallError } from '../../platform/errors/jupyterInstallError';
import { traceError, traceInfo, traceVerbose } from '../../platform/logging';
import { generateCellsFromDocument } from '../editor-integration/cellFactory';
import { IDataScienceErrorHandler } from '../../kernels/errors/types';
import { INotebookEditorProvider } from '../../notebooks/types';
import { INotebookExporter, IJupyterExecution } from '../../kernels/jupyter/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { StatusProvider } from './statusProvider';

/**
 * Class that registers command handlers for interactive window commands.
 */
@injectable()
export class CommandRegistry implements IDisposable, IExtensionSingleActivationService {
    private readonly statusProvider: StatusProvider;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookExporter) @optional() private jupyterExporter: INotebookExporter | undefined,
        @inject(IJupyterExecution) private jupyterExecution: IJupyterExecution,
        @inject(IDocumentManager) private documentManager: IDocumentManager,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(IDataScienceCodeLensProvider)
        @optional()
        private dataScienceCodeLensProvider: IDataScienceCodeLensProvider | undefined,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDebugService) @optional() private debugService: IDebugService | undefined,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IInteractiveWindowProvider)
        private readonly interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDataScienceErrorHandler) private dataScienceErrorHandler: IDataScienceErrorHandler,
        @inject(INotebookEditorProvider) protected ipynbProvider: INotebookEditorProvider,
        @inject(IFileConverter) private fileConverter: IFileConverter,
        @inject(IExportDialog) private exportDialog: IExportDialog,
        @inject(IClipboard) private clipboard: IClipboard,
        @inject(IVSCodeNotebook) private notebook: IVSCodeNotebook
    ) {
        this.statusProvider = new StatusProvider(applicationShell);
        if (!this.workspace.isTrusted) {
            this.workspace.onDidGrantWorkspaceTrust(this.registerCommandsIfTrusted, this, this.disposables);
        }
    }
    public async activate(): Promise<void> {
        this.registerCommandsIfTrusted();
        this.registerCommand(Commands.InsertCellBelowPosition, this.insertCellBelowPosition);
        this.registerCommand(Commands.InsertCellBelow, this.insertCellBelow);
        this.registerCommand(Commands.InsertCellAbove, this.insertCellAbove);
        this.registerCommand(Commands.DeleteCells, this.deleteCells);
        this.registerCommand(Commands.SelectCell, this.selectCell);
        this.registerCommand(Commands.SelectCellContents, this.selectCellContents);
        this.registerCommand(Commands.ExtendSelectionByCellAbove, this.extendSelectionByCellAbove);
        this.registerCommand(Commands.ExtendSelectionByCellBelow, this.extendSelectionByCellBelow);
        this.registerCommand(Commands.MoveCellsUp, this.moveCellsUp);
        this.registerCommand(Commands.MoveCellsDown, this.moveCellsDown);
        this.registerCommand(Commands.ChangeCellToMarkdown, this.changeCellToMarkdown);
        this.registerCommand(Commands.ChangeCellToCode, this.changeCellToCode);
        this.registerCommand(Commands.GotoNextCellInFile, this.gotoNextCellInFile);
        this.registerCommand(Commands.GotoPrevCellInFile, this.gotoPrevCellInFile);
        this.registerCommand(Commands.AddCellBelow, this.addCellBelow);
        this.registerCommand(Commands.CreateNewNotebook, this.createNewNotebook);
        this.registerCommand(Commands.LatestExtension, this.openPythonExtensionPage);
        this.registerCommand(Commands.EnableDebugLogging, this.enableDebugLogging);
        this.registerCommand(Commands.ResetLoggingLevel, this.resetLoggingLevel);
        this.registerCommand(
            Commands.EnableLoadingWidgetsFrom3rdPartySource,
            this.enableLoadingWidgetScriptsFromThirdParty
        );
        this.registerCommand(Commands.CreateNewInteractive, (connection?: KernelConnectionMetadata) =>
            this.createNewInteractiveWindow(connection)
        );
        this.registerCommand(
            Commands.ImportNotebook,
            (file?: Uri, _cmdSource: CommandSource = CommandSource.commandPalette) => {
                return this.listenForErrors(() => {
                    if (file) {
                        return this.importNotebookOnFile(file);
                    } else {
                        return this.importNotebook();
                    }
                });
            }
        );
        this.registerCommand(
            Commands.ImportNotebookFile,
            (file?: Uri, _cmdSource: CommandSource = CommandSource.commandPalette) => {
                return this.listenForErrors(() => {
                    if (file) {
                        return this.importNotebookOnFile(file);
                    } else {
                        return this.importNotebook();
                    }
                });
            }
        );
        this.commandManager.registerCommand(
            Commands.ExportFileAsNotebook,
            (file?: Uri, _cmdSource: CommandSource = CommandSource.commandPalette) => {
                return this.listenForErrors(() => {
                    if (file) {
                        return this.exportFile(file);
                    } else {
                        const activeEditor = this.documentManager.activeTextEditor;
                        if (activeEditor && activeEditor.document.languageId === PYTHON_LANGUAGE) {
                            return this.exportFile(activeEditor.document.uri);
                        }
                    }

                    return Promise.resolve();
                });
            }
        );
        this.registerCommand(
            Commands.ExportFileAndOutputAsNotebook,
            (file: Uri, _cmdSource: CommandSource = CommandSource.commandPalette) => {
                return this.listenForErrors(() => {
                    if (file) {
                        return this.exportFileAndOutput(file);
                    } else {
                        const activeEditor = this.documentManager.activeTextEditor;
                        if (activeEditor && activeEditor.document.languageId === PYTHON_LANGUAGE) {
                            return this.exportFileAndOutput(activeEditor.document.uri);
                        }
                    }
                    return Promise.resolve();
                });
            }
        );
        this.registerCommand(Commands.ExpandAllCells, async (context?: { notebookEditor: { notebookUri: Uri } }) =>
            this.expandAllCells(context?.notebookEditor?.notebookUri)
        );
        this.registerCommand(Commands.CollapseAllCells, async (context?: { notebookEditor: { notebookUri: Uri } }) =>
            this.collapseAllCells(context?.notebookEditor?.notebookUri)
        );
        this.registerCommand(Commands.ExportOutputAsNotebook, () => this.exportCells());
        this.registerCommand(
            Commands.InteractiveExportAsNotebook,
            (context?: { notebookEditor: { notebookUri: Uri } }) => this.export(context?.notebookEditor?.notebookUri)
        );
        this.registerCommand(Commands.InteractiveExportAs, (context?: { notebookEditor: { notebookUri: Uri } }) =>
            this.exportAs(context?.notebookEditor?.notebookUri)
        );
        this.registerCommand(Commands.ScrollToCell, (file: Uri, id: string) => this.scrollToCell(file, id));
        this.registerCommand(Commands.InteractiveClearAll, this.clearAllCellsInInteractiveWindow);
        this.registerCommand(Commands.InteractiveGoToCode, this.goToCodeInInteractiveWindow);
        this.commandManager.registerCommand(Commands.InteractiveCopyCell, this.copyCellInInteractiveWindow);
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
    private registerCommandsIfTrusted() {
        if (!this.workspace.isTrusted) {
            return;
        }
        this.registerCommand(Commands.RunAllCells, this.runAllCells);
        this.registerCommand(Commands.RunCell, this.runCell);
        this.registerCommand(Commands.RunCurrentCell, this.runCurrentCell);
        this.registerCommand(Commands.RunCurrentCellAdvance, this.runCurrentCellAndAdvance);
        this.registerCommand(Commands.ExecSelectionInInteractiveWindow, (textOrUri: string | undefined | Uri) => {
            this.runSelectionOrLine(textOrUri).catch(noop);
        });
        this.registerCommand(Commands.RunAllCellsAbove, this.runAllCellsAbove);
        this.registerCommand(Commands.RunCellAndAllBelow, this.runCellAndAllBelow);
        this.registerCommand(Commands.RunAllCellsAbovePalette, this.runAllCellsAboveFromCursor);
        this.registerCommand(Commands.RunCellAndAllBelowPalette, this.runCellAndAllBelowFromCursor);
        this.registerCommand(Commands.RunCurrentCellAndAddBelow, this.runCurrentCellAndAddBelow);
        this.registerCommand(Commands.DebugCell, this.debugCell);
        this.registerCommand(Commands.DebugStepOver, this.debugStepOver);
        this.registerCommand(Commands.DebugContinue, this.debugContinue);
        this.registerCommand(Commands.DebugStop, this.debugStop);
        this.registerCommand(Commands.DebugCurrentCellPalette, this.debugCurrentCellFromCursor);
        this.registerCommand(Commands.OpenVariableView, this.openVariableView);
        this.registerCommand(Commands.OpenOutlineView, this.openOutlineView);
        this.registerCommand(Commands.RunToLine, this.runToLine);
        this.registerCommand(Commands.RunFromLine, this.runFromLine);
        this.registerCommand(Commands.RunFileInInteractiveWindows, this.runFileInteractive);
        this.registerCommand(Commands.DebugFileInInteractiveWindows, this.debugFileInteractive);
    }
    private registerCommand<
        E extends keyof ICommandNameArgumentTypeMapping,
        U extends ICommandNameArgumentTypeMapping[E]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    >(command: E, callback: (...args: U) => any) {
        const disposable = this.commandManager.registerCommand(command, callback, this);
        this.disposables.push(disposable);
    }

    private getCodeWatcher(file: Uri | undefined): ICodeWatcher | undefined {
        if (file && this.dataScienceCodeLensProvider) {
            const possibleDocuments = this.documentManager.textDocuments.filter((d) => urlPath.isEqual(d.uri, file));
            if (possibleDocuments && possibleDocuments.length === 1) {
                return this.dataScienceCodeLensProvider.getCodeWatcher(possibleDocuments[0]);
            } else if (possibleDocuments && possibleDocuments.length > 1) {
                throw new Error(DataScience.documentMismatch().format(getFilePath(file)));
            }
        }

        return undefined;
    }

    private async enableDebugLogging() {
        const previousValue = this.configService.getSettings().logging.level;
        if (previousValue !== 'debug') {
            await this.configService.updateSetting('logging.level', 'debug', undefined, ConfigurationTarget.Global);
            this.commandManager.executeCommand('jupyter.reloadVSCode', DataScience.reloadRequired()).then(noop, noop);
        }
    }

    private async resetLoggingLevel() {
        const previousValue = this.configService.getSettings().logging.level;
        if (previousValue !== 'error') {
            await this.configService.updateSetting('logging.level', 'error', undefined, ConfigurationTarget.Global);
            this.commandManager.executeCommand('jupyter.reloadVSCode', DataScience.reloadRequired()).then(noop, noop);
        }
    }

    private async enableLoadingWidgetScriptsFromThirdParty() {
        if (this.configService.getSettings(undefined).widgetScriptSources.length > 0) {
            return;
        }
        // Update the setting and once updated, notify user to restart kernel.
        await this.configService
            .updateSetting('widgetScriptSources', ['jsdelivr.com', 'unpkg.com'], undefined, ConfigurationTarget.Global)
            .catch(noop);
    }

    private async runAllCells(file: Uri | undefined): Promise<void> {
        let codeWatcher = this.getCodeWatcher(file);
        if (!codeWatcher) {
            codeWatcher = this.getCurrentCodeWatcher();
        }
        if (codeWatcher) {
            return codeWatcher.runAllCells();
        } else {
            return;
        }
    }

    private async runFileInteractive(file: Uri): Promise<void> {
        let codeWatcher = this.getCodeWatcher(file);
        if (!codeWatcher) {
            codeWatcher = this.getCurrentCodeWatcher();
        }
        if (codeWatcher) {
            return codeWatcher.runFileInteractive();
        } else {
            return;
        }
    }

    private async debugFileInteractive(file: Uri): Promise<void> {
        let codeWatcher = this.getCodeWatcher(file);
        if (!codeWatcher) {
            codeWatcher = this.getCurrentCodeWatcher();
        }
        if (codeWatcher) {
            return codeWatcher.debugFileInteractive();
        } else {
            return;
        }
    }

    // Note: see codewatcher.ts where the runcell command args are attached. The reason we don't have any
    // objects for parameters is because they can't be recreated when passing them through the LiveShare API
    private async runCell(
        file: Uri,
        startLine: number,
        startChar: number,
        endLine: number,
        endChar: number
    ): Promise<void> {
        const codeWatcher = this.getCodeWatcher(file);
        if (codeWatcher) {
            return codeWatcher.runCell(new Range(startLine, startChar, endLine, endChar));
        }
    }

    private async runAllCellsAbove(file: Uri, stopLine: number, stopCharacter: number): Promise<void> {
        if (file) {
            const codeWatcher = this.getCodeWatcher(file);

            if (codeWatcher) {
                return codeWatcher.runAllCellsAbove(stopLine, stopCharacter);
            }
        }
    }

    private async runCellAndAllBelow(file: Uri | undefined, startLine: number, startCharacter: number): Promise<void> {
        if (file) {
            const codeWatcher = this.getCodeWatcher(file);

            if (codeWatcher) {
                return codeWatcher.runCellAndAllBelow(startLine, startCharacter);
            }
        }
    }

    private async runToLine(): Promise<void> {
        const activeCodeWatcher = this.getCurrentCodeWatcher();
        const textEditor = this.documentManager.activeTextEditor;

        if (activeCodeWatcher && textEditor && textEditor.selection) {
            return activeCodeWatcher.runToLine(textEditor.selection.start.line);
        }
    }

    private async runFromLine(): Promise<void> {
        const activeCodeWatcher = this.getCurrentCodeWatcher();
        const textEditor = this.documentManager.activeTextEditor;

        if (activeCodeWatcher && textEditor && textEditor.selection) {
            return activeCodeWatcher.runFromLine(textEditor.selection.start.line);
        }
    }

    private async runCurrentCell(): Promise<void> {
        const activeCodeWatcher = this.getCurrentCodeWatcher();
        if (activeCodeWatcher) {
            return activeCodeWatcher.runCurrentCell();
        } else {
            return;
        }
    }

    private async runCurrentCellAndAdvance(): Promise<void> {
        const activeCodeWatcher = this.getCurrentCodeWatcher();
        if (activeCodeWatcher) {
            return activeCodeWatcher.runCurrentCellAndAdvance();
        } else {
            return;
        }
    }

    private async runSelectionOrLine(textOrUri: string | undefined | Uri): Promise<void> {
        const activeCodeWatcher = this.getCurrentCodeWatcher();
        if (activeCodeWatcher) {
            return activeCodeWatcher.runSelectionOrLine(
                this.documentManager.activeTextEditor,
                // If this is a URI, the runSelectionOrLine is not expecting a URI, so act like nothing was sent.
                isUri(textOrUri) ? undefined : textOrUri
            );
        } else {
            return;
        }
    }

    private async debugCell(
        file: Uri,
        startLine: number,
        startChar: number,
        endLine: number,
        endChar: number
    ): Promise<void> {
        if (file) {
            const codeWatcher = this.getCodeWatcher(file);

            if (codeWatcher) {
                return codeWatcher.debugCell(new Range(startLine, startChar, endLine, endChar));
            }
        }
    }

    @captureUsageTelemetry(Telemetry.DebugStepOver)
    private async debugStepOver(): Promise<void> {
        // Make sure that we are in debug mode
        if (this.debugService?.activeDebugSession) {
            this.commandManager.executeCommand('workbench.action.debug.stepOver').then(noop, noop);
        }
    }

    @captureUsageTelemetry(Telemetry.DebugStop)
    private async debugStop(uri: Uri): Promise<void> {
        // Make sure that we are in debug mode
        if (this.debugService?.activeDebugSession && this.interactiveWindowProvider) {
            // Attempt to get the interactive window for this file
            const iw = this.interactiveWindowProvider.windows.find((w) => w.owner?.toString() == uri.toString());
            if (iw && iw.notebookDocument) {
                const kernel = this.kernelProvider.get(iw.notebookDocument);
                if (kernel) {
                    traceVerbose(`Interrupt kernel due to debug stop of IW ${uri.toString()}`);
                    // If we have a matching iw, then stop current execution
                    await kernel.interrupt();
                }
            }

            this.commandManager.executeCommand('workbench.action.debug.stop').then(noop, noop);
        }
    }

    @captureUsageTelemetry(Telemetry.DebugContinue)
    private async debugContinue(): Promise<void> {
        // Make sure that we are in debug mode
        if (this.debugService?.activeDebugSession) {
            this.commandManager.executeCommand('workbench.action.debug.continue').then(noop, noop);
        }
    }

    @capturePerfTelemetry(Telemetry.AddCellBelow)
    private async addCellBelow(): Promise<void> {
        await this.getCurrentCodeWatcher()?.addEmptyCellToBottom();
    }

    private async runCurrentCellAndAddBelow(): Promise<void> {
        void this.getCurrentCodeWatcher()?.runCurrentCellAndAddBelow();
    }

    private async insertCellBelowPosition(): Promise<void> {
        void this.getCurrentCodeWatcher()?.insertCellBelowPosition();
    }

    private async insertCellBelow(): Promise<void> {
        void this.getCurrentCodeWatcher()?.insertCellBelow();
    }

    private async insertCellAbove(): Promise<void> {
        void this.getCurrentCodeWatcher()?.insertCellAbove();
    }

    private async deleteCells(): Promise<void> {
        void this.getCurrentCodeWatcher()?.deleteCells();
    }

    private async selectCell(): Promise<void> {
        void this.getCurrentCodeWatcher()?.selectCell();
    }

    private async selectCellContents(): Promise<void> {
        void this.getCurrentCodeWatcher()?.selectCellContents();
    }

    private async extendSelectionByCellAbove(): Promise<void> {
        void this.getCurrentCodeWatcher()?.extendSelectionByCellAbove();
    }

    private async extendSelectionByCellBelow(): Promise<void> {
        void this.getCurrentCodeWatcher()?.extendSelectionByCellBelow();
    }

    private async moveCellsUp(): Promise<void> {
        void this.getCurrentCodeWatcher()?.moveCellsUp();
    }

    private async moveCellsDown(): Promise<void> {
        void this.getCurrentCodeWatcher()?.moveCellsDown();
    }

    private async changeCellToMarkdown(): Promise<void> {
        this.getCurrentCodeWatcher()?.changeCellToMarkdown();
    }

    private async changeCellToCode(): Promise<void> {
        this.getCurrentCodeWatcher()?.changeCellToCode();
    }

    private async gotoNextCellInFile(): Promise<void> {
        this.getCurrentCodeWatcher()?.gotoNextCell();
    }

    private async gotoPrevCellInFile(): Promise<void> {
        this.getCurrentCodeWatcher()?.gotoPreviousCell();
    }

    private async runAllCellsAboveFromCursor(): Promise<void> {
        const currentCodeLens = this.getCurrentCodeLens();
        if (currentCodeLens) {
            const activeCodeWatcher = this.getCurrentCodeWatcher();
            if (activeCodeWatcher) {
                return activeCodeWatcher.runAllCellsAbove(
                    currentCodeLens.range.start.line,
                    currentCodeLens.range.start.character
                );
            }
        } else {
            return;
        }
    }

    private async runCellAndAllBelowFromCursor(): Promise<void> {
        const currentCodeLens = this.getCurrentCodeLens();
        if (currentCodeLens) {
            const activeCodeWatcher = this.getCurrentCodeWatcher();
            if (activeCodeWatcher) {
                return activeCodeWatcher.runCellAndAllBelow(
                    currentCodeLens.range.start.line,
                    currentCodeLens.range.start.character
                );
            }
        } else {
            return;
        }
    }

    private async debugCurrentCellFromCursor(): Promise<void> {
        const currentCodeLens = this.getCurrentCodeLens();
        if (currentCodeLens) {
            const activeCodeWatcher = this.getCurrentCodeWatcher();
            if (activeCodeWatcher) {
                return activeCodeWatcher.debugCurrentCell();
            }
        } else {
            return;
        }
    }

    private async createNewNotebook(): Promise<void> {
        this.appShell
            .showInformationMessage(
                'This command has been deprecated and will eventually be removed, please use ["Create: New Jupyter Notebook"](command:workbench.action.openGlobalKeybindings?%5B%22@command:ipynb.newUntitledIpynb%22%5D) instead.'
            )
            .then(noop, noop);
        await commands.executeCommand('ipynb.newUntitledIpynb');
    }

    private getCurrentCodeLens(): CodeLens | undefined {
        const activeEditor = this.documentManager.activeTextEditor;
        const activeCodeWatcher = this.getCurrentCodeWatcher();
        if (activeEditor && activeCodeWatcher) {
            // Find the cell that matches
            return activeCodeWatcher.getCodeLenses().find((c: CodeLens) => {
                if (
                    c.range.end.line >= activeEditor.selection.anchor.line &&
                    c.range.start.line <= activeEditor.selection.anchor.line
                ) {
                    return true;
                }
                return false;
            });
        }
    }
    // Get our matching code watcher for the active document
    private getCurrentCodeWatcher(): ICodeWatcher | undefined {
        const activeEditor = this.documentManager.activeTextEditor;
        if (!activeEditor || !activeEditor.document || !this.dataScienceCodeLensProvider) {
            return undefined;
        }

        // Ask our code lens provider to find the matching code watcher for the current document
        return this.dataScienceCodeLensProvider.getCodeWatcher(activeEditor.document);
    }

    private openPythonExtensionPage() {
        env.openExternal(Uri.parse(`https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter`)).then(
            noop,
            noop
        );
    }

    // Open up our variable viewer using the command that VS Code provides for this
    private async openVariableView(): Promise<void> {
        // For all contributed views vscode creates a command with the format [view ID].focus to focus that view
        // It's the given way to focus a single view so using that here, note that it needs to match the view ID
        return this.commandManager.executeCommand('jupyterViewVariables.focus');
    }

    // Open the VS Code outline view
    private async openOutlineView(): Promise<void> {
        return this.commandManager.executeCommand('outline.focus');
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    private async listenForErrors(promise: () => Promise<any>): Promise<any> {
        let result: any;
        try {
            result = await promise();
            return result;
        } catch (err) {
            traceError('listenForErrors', err as any);
            this.dataScienceErrorHandler.handleError(err).then(noop, noop);
        }
        return result;
    }

    @captureUsageTelemetry(Telemetry.ExportPythonFileInteractive)
    private async exportFile(file: Uri): Promise<void> {
        const filePath = getFilePath(file);
        if (filePath && filePath.length > 0 && this.jupyterExporter) {
            // If the current file is the active editor, then generate cells from the document.
            const activeEditor = this.documentManager.activeTextEditor;
            if (activeEditor && this.fileSystem.arePathsSame(activeEditor.document.uri, file)) {
                const cells = generateCellsFromDocument(
                    activeEditor.document,
                    this.configuration.getSettings(activeEditor.document.uri)
                );
                if (cells) {
                    // Bring up the export dialog box
                    const uri = await this.exportDialog.showDialog(ExportFormat.ipynb, file);
                    await this.waitForStatus(
                        async () => {
                            if (uri) {
                                const notebook = await this.jupyterExporter?.translateToNotebook(cells);
                                await this.fileSystem.writeFile(uri, JSON.stringify(notebook, undefined, 1));
                            }
                        },
                        DataScience.exportingFormat(),
                        getDisplayPath(file)
                    );
                    // When all done, show a notice that it completed.
                    if (uri && filePath) {
                        const openQuestion1 = DataScience.exportOpenQuestion1();
                        const selection = await this.applicationShell.showInformationMessage(
                            DataScience.exportDialogComplete().format(getDisplayPath(file)),
                            openQuestion1
                        );
                        if (selection === openQuestion1) {
                            await openAndShowNotebook(uri);
                        }
                    }
                }
            }
        }
    }

    @captureUsageTelemetry(Telemetry.ExportPythonFileAndOutputInteractive)
    private async exportFileAndOutput(file: Uri): Promise<Uri | undefined> {
        const filePath = getFilePath(file);
        if (
            filePath &&
            filePath.length > 0 &&
            this.jupyterExporter &&
            (await this.jupyterExecution.isNotebookSupported())
        ) {
            // If the current file is the active editor, then generate cells from the document.
            const activeEditor = this.documentManager.activeTextEditor;
            if (
                activeEditor &&
                activeEditor.document &&
                this.fileSystem.arePathsSame(activeEditor.document.uri, file)
            ) {
                const cells = generateCellsFromDocument(
                    activeEditor.document,
                    this.configuration.getSettings(activeEditor.document.uri)
                );
                if (cells) {
                    // Bring up the export dialog box
                    const uri = await this.exportDialog.showDialog(ExportFormat.ipynb, file);
                    if (!uri) {
                        return;
                    }
                    await this.waitForStatus(
                        async () => {
                            if (uri) {
                                const notebook = await this.jupyterExporter?.translateToNotebook(cells);
                                await this.fileSystem.writeFile(uri, JSON.stringify(notebook, undefined, 1));
                            }
                        },
                        DataScience.exportingFormat(),
                        getDisplayPath(file)
                    );
                    // Next open this notebook & execute it.
                    await this.notebook
                        .openNotebookDocument(uri)
                        .then((document) => this.notebook.showNotebookDocument(document));
                    await this.commandManager.executeCommand('notebook.execute');
                    return uri;
                }
            }
        } else {
            await this.dataScienceErrorHandler.handleError(
                new JupyterInstallError(
                    DataScience.jupyterNotSupported().format(await this.jupyterExecution.getNotebookError())
                )
            );
        }
    }

    private async expandAllCells(uri?: Uri) {
        const interactiveWindow = this.getTargetInteractiveWindow(uri);
        traceInfo(`Expanding all cells in interactive window with uri ${interactiveWindow?.notebookUri}`);
        if (interactiveWindow) {
            await interactiveWindow.expandAllCells();
        }
    }

    private async collapseAllCells(uri?: Uri) {
        const interactiveWindow = this.getTargetInteractiveWindow(uri);
        traceInfo(`Collapsing all cells in interactive window with uri ${interactiveWindow?.notebookUri}`);
        if (interactiveWindow) {
            await interactiveWindow.collapseAllCells();
        }
    }

    private exportCells() {
        const interactiveWindow = this.interactiveWindowProvider?.activeWindow;
        if (interactiveWindow) {
            interactiveWindow.export();
        }
    }

    private exportAs(uri?: Uri) {
        const interactiveWindow = this.getTargetInteractiveWindow(uri);
        if (interactiveWindow) {
            interactiveWindow.exportAs();
        }
    }

    private export(uri?: Uri) {
        const interactiveWindow = this.getTargetInteractiveWindow(uri);
        if (interactiveWindow) {
            interactiveWindow.export();
        }
    }

    @captureUsageTelemetry(Telemetry.CreateNewInteractive)
    private async createNewInteractiveWindow(connection?: KernelConnectionMetadata): Promise<void> {
        await this.interactiveWindowProvider?.getOrCreate(undefined, connection);
    }

    private waitForStatus<T>(
        promise: () => Promise<T>,
        format: string,
        file?: string,
        canceled?: () => void
    ): Promise<T> {
        const message = file ? format.format(file) : format;
        return this.statusProvider.waitWithStatus(promise, message, undefined, canceled);
    }

    @captureUsageTelemetry(Telemetry.ImportNotebook, { scope: 'command' })
    private async importNotebook(): Promise<void> {
        const filtersKey = DataScience.importDialogFilter();
        const filtersObject: { [name: string]: string[] } = {};
        filtersObject[filtersKey] = ['ipynb'];

        const uris = await this.applicationShell.showOpenDialog({
            openLabel: DataScience.importDialogTitle(),
            filters: filtersObject
        });

        if (uris && uris.length > 0) {
            // Don't call the other overload as we'll end up with double telemetry.
            await this.waitForStatus(
                async () => {
                    await this.fileConverter.importIpynb(uris[0]);
                },
                DataScience.importingFormat(),
                getDisplayPath(uris[0])
            );
        }
    }

    @captureUsageTelemetry(Telemetry.ImportNotebook, { scope: 'file' })
    private async importNotebookOnFile(file: Uri): Promise<void> {
        const filepath = getFilePath(file);
        if (filepath && filepath.length > 0) {
            await this.waitForStatus(
                async () => {
                    await this.fileConverter.importIpynb(file);
                },
                DataScience.importingFormat(),
                getDisplayPath(file)
            );
        }
    }

    private async scrollToCell(file: Uri, id: string): Promise<void> {
        if (id && file) {
            // Find the interactive windows that have this file as a submitter
            const possibles = this.interactiveWindowProvider.windows.filter(
                (w) => w.submitters.findIndex((s) => this.fileSystem.arePathsSame(s, file)) >= 0
            );

            // Scroll to cell in the one that has the cell. We need this so
            // we don't activate all of them.
            // eslint-disable-next-line @typescript-eslint/prefer-for-of
            for (let i = 0; i < possibles.length; i += 1) {
                if (await possibles[i].hasCell(id)) {
                    possibles[i].scrollToCell(id);
                    break;
                }
            }
        }
    }

    private async clearAllCellsInInteractiveWindow(context?: { notebookEditor: { notebookUri: Uri } }): Promise<void> {
        const uri = this.getTargetInteractiveWindow(context?.notebookEditor?.notebookUri)?.notebookUri;
        if (!uri) {
            return;
        }

        // Look for the matching notebook document to add cells to
        const document = workspace.notebookDocuments.find((document) => document.uri.toString() === uri.toString());
        if (!document) {
            return;
        }

        // Remove the cells from the matching notebook document
        const edit = new WorkspaceEdit();
        const nbEdit = NotebookEdit.deleteCells(new NotebookRange(0, document.cellCount));
        edit.set(document.uri, [nbEdit]);
        await workspace.applyEdit(edit);
    }

    private async goToCodeInInteractiveWindow(context?: NotebookCell) {
        if (context && context.metadata?.interactive) {
            const uri = Uri.parse(context.metadata.interactive.uristring);
            const line = context.metadata.interactive.lineIndex;

            const editor = await this.documentManager.showTextDocument(uri, { viewColumn: ViewColumn.One });

            // If we found the editor change its selection
            if (editor) {
                editor.revealRange(new Range(line, 0, line, 0));
                editor.selection = new Selection(new Position(line, 0), new Position(line, 0));
            }
        }
    }

    private async copyCellInInteractiveWindow(context?: NotebookCell) {
        if (context) {
            const settings = this.configuration.getSettings(context.notebook.uri);
            const source = [
                // Prepend cell marker to code
                context.metadata.interactiveWindowCellMarker ?? settings.defaultCellMarker,
                context.document.getText()
            ].join('\n');
            await this.clipboard.writeText(source);
        }
    }

    private getTargetInteractiveWindow(notebookUri: Uri | undefined) {
        let targetInteractiveWindow;
        if (notebookUri !== undefined) {
            targetInteractiveWindow = this.interactiveWindowProvider.windows.find(
                (w) => w.notebookUri?.toString() === notebookUri.toString()
            );
        } else {
            targetInteractiveWindow = this.interactiveWindowProvider.getActiveOrAssociatedInteractiveWindow();
        }
        return targetInteractiveWindow;
    }
}
