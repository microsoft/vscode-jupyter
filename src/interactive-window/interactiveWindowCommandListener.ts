// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../platform/common/extensions';

import { inject, injectable, optional } from 'inversify';
import {
    NotebookCell,
    NotebookEdit,
    NotebookRange,
    Position,
    Range,
    Selection,
    Uri,
    ViewColumn,
    workspace,
    WorkspaceEdit
} from 'vscode';
import {
    IApplicationShell,
    IClipboard,
    ICommandManager,
    IDocumentManager,
    IVSCodeNotebook
} from '../platform/common/application/types';
import { Commands, JVSC_EXTENSION_ID, PYTHON_LANGUAGE, Telemetry } from '../platform/common/constants';
import { traceError, traceInfo } from '../platform/logging';
import { IFileSystem } from '../platform/common/platform/types';
import { IConfigurationService, IDataScienceCommandListener, IDisposableRegistry } from '../platform/common/types';
import * as localize from '../platform/common/utils/localize';
import { captureTelemetry } from '../telemetry';
import { CommandSource } from '../platform/testing/common/constants';
import { JupyterInstallError } from '../platform/errors/jupyterInstallError';
import { INotebookEditorProvider } from '../notebooks/types';
import { KernelConnectionMetadata } from '../kernels/types';
import { INotebookExporter, IJupyterExecution } from '../kernels/jupyter/types';
import { IDataScienceErrorHandler } from '../kernels/errors/types';
import { IFileConverter, IExportDialog, ExportFormat } from '../notebooks/export/types';
import { IStatusProvider } from '../platform/progress/types';
import { generateCellsFromDocument } from './editor-integration/cellFactory';
import { IInteractiveWindowProvider } from './types';
import { getDisplayPath, getFilePath } from '../platform/common/platform/fs-paths';
import { chainWithPendingUpdates } from '../kernels/execution/notebookUpdater';
import { openAndShowNotebook } from '../platform/common/utils/notebooks';
import { noop } from '../platform/common/utils/misc';
import { IControllerPreferredService } from '../notebooks/controllers/types';

@injectable()
export class InteractiveWindowCommandListener implements IDataScienceCommandListener {
    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(INotebookExporter) @optional() private jupyterExporter: INotebookExporter | undefined,
        @inject(IJupyterExecution) private jupyterExecution: IJupyterExecution,
        @inject(IDocumentManager) private documentManager: IDocumentManager,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(IStatusProvider) private statusProvider: IStatusProvider,
        @inject(IDataScienceErrorHandler) private dataScienceErrorHandler: IDataScienceErrorHandler,
        @inject(INotebookEditorProvider) protected ipynbProvider: INotebookEditorProvider,
        @inject(IFileConverter) private fileConverter: IFileConverter,
        @inject(IExportDialog) private exportDialog: IExportDialog,
        @inject(IClipboard) private clipboard: IClipboard,
        @inject(IVSCodeNotebook) private notebook: IVSCodeNotebook,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IControllerPreferredService) private controllerPreferredService: IControllerPreferredService
    ) {}

    public register(commandManager: ICommandManager): void {
        let disposable = commandManager.registerCommand(
            Commands.CreateNewInteractive,
            (connection?: KernelConnectionMetadata) => this.createNewInteractiveWindow(connection)
        );
        this.disposableRegistry.push(disposable);
        disposable = commandManager.registerCommand(
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
        this.disposableRegistry.push(disposable);
        disposable = commandManager.registerCommand(
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
        this.disposableRegistry.push(disposable);
        disposable = commandManager.registerCommand(
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
        this.disposableRegistry.push(disposable);
        disposable = commandManager.registerCommand(
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
        this.disposableRegistry.push(disposable);
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.ExpandAllCells,
                async (context?: { notebookEditor: { notebookUri: Uri } }) =>
                    this.expandAllCells(context?.notebookEditor?.notebookUri)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.CollapseAllCells,
                async (context?: { notebookEditor: { notebookUri: Uri } }) =>
                    this.collapseAllCells(context?.notebookEditor?.notebookUri)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.ExportOutputAsNotebook, () => this.exportCells())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.InteractiveExportAsNotebook,
                (context?: { notebookEditor: { notebookUri: Uri } }) =>
                    this.export(context?.notebookEditor?.notebookUri)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.InteractiveExportAs,
                (context?: { notebookEditor: { notebookUri: Uri } }) =>
                    this.exportAs(context?.notebookEditor?.notebookUri)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.ScrollToCell, (file: Uri, id: string) =>
                this.scrollToCell(file, id)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.InteractiveClearAll, this.clearAllCellsInInteractiveWindow, this)
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.InteractiveRemoveCell, this.removeCellInInteractiveWindow, this)
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.InteractiveGoToCode, this.goToCodeInInteractiveWindow, this)
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.InteractiveCopyCell, this.copyCellInInteractiveWindow, this)
        );
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

    @captureTelemetry(Telemetry.ExportPythonFileInteractive, undefined, false)
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
                                await this.fileSystem.writeFile(uri, JSON.stringify(notebook));
                            }
                        },
                        localize.DataScience.exportingFormat(),
                        getDisplayPath(file)
                    );
                    // When all done, show a notice that it completed.
                    if (uri && filePath) {
                        const openQuestion1 = localize.DataScience.exportOpenQuestion1();
                        const selection = await this.applicationShell.showInformationMessage(
                            localize.DataScience.exportDialogComplete().format(getDisplayPath(file)),
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

    @captureTelemetry(Telemetry.ExportPythonFileAndOutputInteractive, undefined, false)
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
                                await this.fileSystem.writeFile(uri, JSON.stringify(notebook));
                            }
                        },
                        localize.DataScience.exportingFormat(),
                        getDisplayPath(file)
                    );
                    // Next open this notebook & execute it.
                    const editor = await this.notebook
                        .openNotebookDocument(uri)
                        .then((document) => this.notebook.showNotebookDocument(document));
                    const { controller } = await this.controllerPreferredService.computePreferred(editor.notebook);
                    if (controller) {
                        await this.commandManager.executeCommand('notebook.selectKernel', {
                            id: controller.id,
                            extension: JVSC_EXTENSION_ID
                        });
                    }
                    await this.commandManager.executeCommand('notebook.execute');
                    return uri;
                }
            }
        } else {
            await this.dataScienceErrorHandler.handleError(
                new JupyterInstallError(
                    localize.DataScience.jupyterNotSupported().format(await this.jupyterExecution.getNotebookError())
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
        const interactiveWindow = this.interactiveWindowProvider.activeWindow;
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

    @captureTelemetry(Telemetry.CreateNewInteractive, undefined, false)
    private async createNewInteractiveWindow(connection?: KernelConnectionMetadata): Promise<void> {
        await this.interactiveWindowProvider.getOrCreate(undefined, connection);
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

    @captureTelemetry(Telemetry.ImportNotebook, { scope: 'command' }, false)
    private async importNotebook(): Promise<void> {
        const filtersKey = localize.DataScience.importDialogFilter();
        const filtersObject: { [name: string]: string[] } = {};
        filtersObject[filtersKey] = ['ipynb'];

        const uris = await this.applicationShell.showOpenDialog({
            openLabel: localize.DataScience.importDialogTitle(),
            filters: filtersObject
        });

        if (uris && uris.length > 0) {
            // Don't call the other overload as we'll end up with double telemetry.
            await this.waitForStatus(
                async () => {
                    await this.fileConverter.importIpynb(uris[0]);
                },
                localize.DataScience.importingFormat(),
                getDisplayPath(uris[0])
            );
        }
    }

    @captureTelemetry(Telemetry.ImportNotebook, { scope: 'file' }, false)
    private async importNotebookOnFile(file: Uri): Promise<void> {
        const filepath = getFilePath(file);
        if (filepath && filepath.length > 0) {
            await this.waitForStatus(
                async () => {
                    await this.fileConverter.importIpynb(file);
                },
                localize.DataScience.importingFormat(),
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

    private async removeCellInInteractiveWindow(context?: NotebookCell) {
        const interactiveWindow = this.interactiveWindowProvider.getActiveOrAssociatedInteractiveWindow();
        const ranges =
            context === undefined
                ? interactiveWindow?.notebookEditor?.selections
                : [new NotebookRange(context.index, context.index + 1)];
        const document = context === undefined ? interactiveWindow?.notebookEditor?.notebook : context.notebook;

        if (ranges !== undefined && document !== undefined) {
            await chainWithPendingUpdates(document, (edit) => {
                ranges.forEach((range) => {
                    const nbEdit = NotebookEdit.deleteCells(range);
                    edit.set(document.uri, [nbEdit]);
                });
            });
        }
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
