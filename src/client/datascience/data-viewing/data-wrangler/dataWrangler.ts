// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import * as fsextra from 'fs-extra';
import {
    Disposable,
    EventEmitter,
    Memento,
    NotebookCell,
    ViewColumn,
    WebviewPanel,
    notebooks as vscNotebook,
    NotebookCellExecutionStateChangeEvent,
    NotebookCellExecutionState
} from 'vscode';

import {
    IApplicationShell,
    ICommandManager,
    IWebviewPanelProvider,
    IWorkspaceService,
    IDocumentManager
} from '../../../common/application/types';
import { EXTENSION_ROOT_DIR, PYTHON_LANGUAGE, UseCustomEditorApi } from '../../../common/constants';
import { traceError, traceInfo, traceWarning } from '../../../common/logger';
import { GLOBAL_MEMENTO, IConfigurationService, IDisposable, IMemento } from '../../../common/types';
import * as localize from '../../../common/utils/localize';
import { Commands, Identifiers } from '../../constants';
import {
    ICodeCssGenerator,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    INotebookEditorProvider,
    IThemeFinder
} from '../../types';
import { addNewCellAfter, updateCellCode } from '../../notebook/helpers/executionHelpers';
import { InteractiveWindowMessages } from '../../interactive-common/interactiveWindowTypes';
import { serializeLanguageConfiguration } from '../../interactive-common/serialization';
import { CssMessages } from '../../messages';
import { DataViewerMessages, IDataViewerDataProvider } from '../types';
import {
    IDataWrangler,
    DataWranglerMessages,
    DataWranglerCommands,
    IRenameColumnsRequest,
    IHistoryItem,
    IDropRequest,
    INormalizeColumnRequest,
    IFillNaRequest,
    IDropDuplicatesRequest,
    IDropNaRequest,
    OpenDataWranglerSetting
} from './types';
import { DataScience } from '../../../common/utils/localize';
import { DataViewer } from '../dataViewer';

const PREFERRED_VIEWGROUP = 'JupyterDataWranglerPreferredViewColumn';
const dataWranglerDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');
@injectable()
export class DataWrangler extends DataViewer implements IDataWrangler, IDisposable {
    private variableCounter = 0;
    private existingDisposable: Disposable | undefined;
    private historyList: IHistoryItem[] = [];
    private sourceFile: string | undefined;
    private commands = new Map<
        DataWranglerCommands,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (args: any, currentVariableName: string) => Promise<IHistoryItem | void>
    >();

    public get visible() {
        return !!this.webPanel?.isVisible();
    }

    public get onDidDisposeDataWrangler() {
        return this._onDidDisposeDataWrangler.event;
    }

    public get onDidChangeDataWranglerViewState() {
        return this._onDidChangeDataWranglerViewState.event;
    }

    private _onDidDisposeDataWrangler = new EventEmitter<IDataWrangler>();
    private _onDidChangeDataWranglerViewState = new EventEmitter<void>();

    constructor(
        @inject(IConfigurationService) configuration: IConfigurationService,
        @inject(IWebviewPanelProvider) provider: IWebviewPanelProvider,
        @inject(ICodeCssGenerator) cssGenerator: ICodeCssGenerator,
        @inject(IThemeFinder) themeFinder: IThemeFinder,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IApplicationShell) applicationShell: IApplicationShell,
        @inject(UseCustomEditorApi) useCustomEditorApi: boolean,
        @inject(IMemento) @named(GLOBAL_MEMENTO) readonly globalMemento: Memento,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager,
        @inject(IJupyterVariables)
        @named(Identifiers.KERNEL_VARIABLES)
        private kernelVariableProvider: IJupyterVariables,
        @inject(IJupyterVariableDataProviderFactory)
        private dataProviderFactory: IJupyterVariableDataProviderFactory,
        @inject(INotebookEditorProvider) private notebookEditorProvider: INotebookEditorProvider
    ) {
        super(
            configuration,
            provider,
            cssGenerator,
            themeFinder,
            workspaceService,
            applicationShell,
            useCustomEditorApi,
            globalMemento,
            dataWranglerDir,
            [path.join(dataWranglerDir, 'commons.initial.bundle.js'), path.join(dataWranglerDir, 'dataWrangler.js')],
            localize.DataScience.dataWranglerTitle(),
            PREFERRED_VIEWGROUP,
            ViewColumn.Two
        );
        this.onDidDispose(this.dataWranglerDisposed, this);

        this.commands.set(DataWranglerCommands.Describe, this.getColumnStats.bind(this));
        // this.commands.set(DataWranglerCommands.ExportToCsv, this);
        this.commands.set(DataWranglerCommands.ExportToPythonScript, this.generatePythonCode.bind(this));
        this.commands.set(DataWranglerCommands.ExportToNotebook, this.generateNotebook.bind(this));
        this.commands.set(DataWranglerCommands.RenameColumn, this.renameColumn.bind(this));
        this.commands.set(DataWranglerCommands.Drop, this.drop.bind(this));
        this.commands.set(DataWranglerCommands.DropDuplicates, this.dropDuplicates.bind(this));
        this.commands.set(DataWranglerCommands.DropNa, this.dropNa.bind(this));
        this.commands.set(DataWranglerCommands.NormalizeColumn, this.normalizeColumn.bind(this));
        this.commands.set(DataWranglerCommands.FillNa, this.fillNa.bind(this));
        this.commands.set(DataWranglerCommands.GetHistoryItem, this.getHistoryItem.bind(this));
        // this.commands.set(DataWranglerCommands.PyplotHistogram, this
    }

    public async showData(
        dataProvider: IDataViewerDataProvider,
        title: string,
        webviewPanel?: WebviewPanel
    ): Promise<void> {
        if (!this.isDisposed) {
            // Save the data provider
            this.dataProvider = dataProvider;

            // Load the web panel using our current directory as we don't expect to load any other files
            await super.loadWebview(process.cwd(), webviewPanel).catch(traceError);

            // Use Data Viewer logic to show initial data
            await this.showInitialData(title);

            this.historyList.push({
                transformation: DataScience.dataWranglerImportTransformation(),
                code: this.getImportCode(),
                variableName: 'df'
            });
            this.postMessage(DataWranglerMessages.UpdateHistoryList, this.historyList).ignoreErrors();
        }
    }

    private dataWranglerDisposed() {
        this._onDidDisposeDataWrangler.fire(this as IDataWrangler);
    }

    public async updateWithNewVariable(newVariableName: string) {
        const notebook = (this.dataProvider as IJupyterVariableDataProvider).notebook;

        // Generate a variable
        const jupyterVariable = await this.kernelVariableProvider.getFullVariable(
            {
                name: newVariableName,
                value: '',
                supportsDataExplorer: true,
                type: 'DataFrame',
                size: 0,
                shape: '',
                count: 0,
                truncated: true
            },
            notebook
        );
        const jupyterVariableDataProvider = await this.dataProviderFactory.create(jupyterVariable);
        // Set dependencies for jupyterVariableDataProvider
        jupyterVariableDataProvider.setDependencies(jupyterVariable, notebook);
        // Get variable info
        this.dataFrameInfoPromise = jupyterVariableDataProvider.getDataFrameInfo();
        this.dataProvider = jupyterVariableDataProvider;
        const dataFrameInfo = await this.dataFrameInfoPromise;
        super.setTitle(`Data Wrangler`);

        this.postMessage(DataViewerMessages.InitializeData, dataFrameInfo).ignoreErrors();
    }

    public async getHistoryItem(index: number) {
        const variableName = this.historyList[index].variableName;

        void this.updateWithNewVariable(variableName);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case DataWranglerMessages.SubmitCommand:
                this.handleCommand(payload).ignoreErrors();
                break;

            case DataWranglerMessages.RefreshDataWrangler:
                this.refreshData().ignoreErrors();
                break;

            case InteractiveWindowMessages.LoadTmLanguageRequest:
                void this.requestTmLanguage(payload);
                break;

            case InteractiveWindowMessages.LoadOnigasmAssemblyRequest:
                void this.requestOnigasm();
                break;

            case CssMessages.GetMonacoThemeRequest:
                void this.handleMonacoThemeRequest(payload);
                break;

            default:
                break;
        }

        // Some messages will be handled by DataViewer
        super.onMessage(message, payload);
    }

    private async requestTmLanguage(languageId: string = PYTHON_LANGUAGE) {
        // Get the contents of the appropriate tmLanguage file.
        traceInfo('Request for tmlanguage file.');
        const languageJson = await this.themeFinder.findTmLanguage(languageId);
        const languageConfiguration = serializeLanguageConfiguration(
            await this.themeFinder.findLanguageConfiguration(languageId)
        );
        const extensions = languageId === PYTHON_LANGUAGE ? ['.py'] : [];
        const scopeName = `scope.${languageId}`; // This works for python, not sure about c# etc.
        this.postMessage(InteractiveWindowMessages.LoadTmLanguageResponse, {
            languageJSON: languageJson ?? '',
            languageConfiguration,
            extensions,
            scopeName,
            languageId
        }).ignoreErrors();
    }

    private async requestOnigasm(): Promise<void> {
        // Look for the file next or our current file (this is where it's installed in the vsix)
        let filePath = path.join(__dirname, 'node_modules', 'onigasm', 'lib', 'onigasm.wasm');
        traceInfo(`Request for onigasm file at ${filePath}`);
        if (await fsextra.pathExists(filePath)) {
            const contents = await fsextra.readFile(filePath);
            this.postMessage(InteractiveWindowMessages.LoadOnigasmAssemblyResponse, contents).ignoreErrors();
        } else {
            // During development it's actually in the node_modules folder
            filePath = path.join(EXTENSION_ROOT_DIR, 'node_modules', 'onigasm', 'lib', 'onigasm.wasm');
            traceInfo(`Backup request for onigasm file at ${filePath}`);
            if (await fsextra.pathExists(filePath)) {
                const contents = await fsextra.readFile(filePath);
                this.postMessage(InteractiveWindowMessages.LoadOnigasmAssemblyResponse, contents).ignoreErrors();
            } else {
                traceWarning('Onigasm file not found. Colorization will not be available.');
                this.postMessage(InteractiveWindowMessages.LoadOnigasmAssemblyResponse).ignoreErrors();
            }
        }
    }

    private addToHistory(newHistoryItem: IHistoryItem) {
        this.historyList.push(newHistoryItem);
        this.postMessage(DataWranglerMessages.UpdateHistoryList, this.historyList).ignoreErrors();
    }

    private getCode() {
        return this.historyList.map((item) => item.code).join('\n');
    }

    private getImportCode() {
        const code = DataScience.dataWranglerImportCode().format(this.sourceFile ?? '');
        return code;
    }

    private async generatePythonCode() {
        var dataCleanCode = this.getCode();

        const doc = await this.documentManager.openTextDocument({
            language: PYTHON_LANGUAGE,
            content: dataCleanCode
        });

        await this.documentManager.showTextDocument(doc, 1, true);
    }

    private async generateNotebook() {
        const dataCleanCode = this.getCode();
        const notebookEditor = await this.commandManager.executeCommand(Commands.CreateNewNotebook);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const blankCell = (notebookEditor as any).document.cellAt(0) as NotebookCell;
        await updateCellCode(blankCell, dataCleanCode);
    }

    private async getColumnStats(columnName: string) {
        if (this.dataProvider && this.dataProvider.getCols && columnName !== undefined) {
            const columnData = await this.dataProvider.getCols(columnName);
            void this.postMessage(DataWranglerMessages.GetHistogramResponse, {
                cols: columnData,
                columnName: columnName
            });
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleCommand(payload: { command: string; args: any }) {
        const notebook = (this.dataProvider as IJupyterVariableDataProvider).notebook;
        let code = '';
        const currentVariableName = (await this.dataFrameInfoPromise)!.name ?? '';
        let newVariableName = currentVariableName ?? '';
        const matchingNotebookEditor = this.notebookEditorProvider.editors.find(
            (editor) => editor.notebook?.identity.fsPath === notebook?.identity.fsPath
        );
        let refreshRequired = true;

        const cmd = this.commands.get(payload.command as DataWranglerCommands);
        if (cmd) {
            const historyItem = await cmd(payload.args, currentVariableName);
            if (historyItem) {
                code = historyItem.code;
                newVariableName = historyItem.variableName;
            }
        }

        const dataCleaningMode = this.configService.getSettings().dataCleaningMode;
        if (dataCleaningMode === OpenDataWranglerSetting.STANDALONE) {
            if (code && notebook !== undefined) {
                void notebook?.execute(code, '', 0, uuid()).then(async () => {
                    if (this.existingDisposable) {
                        this.existingDisposable.dispose();
                    }
                    await this.updateWithNewVariable(newVariableName);
                });
            }
        } else if (dataCleaningMode === OpenDataWranglerSetting.WITH_JUPYTER_NOTEBOOK) {
            if (code && matchingNotebookEditor !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let cells = (matchingNotebookEditor as any).document.getCells();
                let lastCell = cells[cells.length - 1] as NotebookCell;
                await addNewCellAfter(lastCell, '');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                cells = (matchingNotebookEditor as any).document.getCells();
                lastCell = cells[cells.length - 1] as NotebookCell;
                await updateCellCode(lastCell, code);
                if (this.existingDisposable) {
                    this.existingDisposable.dispose();
                }
                this.existingDisposable = vscNotebook.onDidChangeNotebookCellExecutionState(
                    async (e: NotebookCellExecutionStateChangeEvent) => {
                        if (e.state === NotebookCellExecutionState.Idle && refreshRequired) {
                            await this.updateWithNewVariable(newVariableName);
                        }
                    }
                );

                await this.commandManager.executeCommand(
                    'notebook.cell.execute',
                    { start: lastCell.index, end: lastCell.notebook.cellCount },
                    lastCell.notebook.uri
                );
            }
        }
    }

    private async renameColumn(req: IRenameColumnsRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const code = DataScience.dataWranglerRenameColumnCode().format(
            newVariableName,
            currentVariableName,
            req.oldColumnName,
            req.newColumnName
        );
        const historyItem = {
            transformation: DataScience.dataWranglerRenameColumnTransformation().format(
                req.oldColumnName,
                req.newColumnName
            ),
            variableName: newVariableName,
            code: code
        };
        this.addToHistory(historyItem);
        return historyItem;
    }

    private async drop(req: IDropRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const labels = req.targets;
        if (req.mode === 'row') {
            // Drop rows by index
            const rowNums = labels.join(', ');
            const code = DataScience.dataWranglerDropRowCode().format(
                newVariableName,
                currentVariableName,
                `[${rowNums}]`
            );
            const historyItem = {
                transformation: DataScience.dataWranglerDropRowTransformation().format(rowNums),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        } else {
            // Drop columns by column name
            const columnNames = labels.map((label) => `'${label}'`).join(', ');
            const code = DataScience.dataWranglerDropColumnCode().format(
                newVariableName,
                currentVariableName,
                `[${columnNames}]`
            );
            const historyItem = {
                transformation: DataScience.dataWranglerDropColumnTransformation().format(columnNames),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        }
    }

    private async dropDuplicates(req: IDropDuplicatesRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;

        if (req.subset !== undefined) {
            // Drop duplicates in a column
            const subset = req.subset.map((col: string) => `'${col}'`).join(', ');
            const code = DataScience.dataWranglerDropDuplicatesRowsOnColumnCode().format(
                newVariableName,
                currentVariableName,
                subset
            );
            const historyItem = {
                transformation: DataScience.dataWranglerDropDuplicatesRowsOnColumnTransformation().format(subset),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        } else {
            // Drop duplicate rows
            const code = DataScience.dataWranglerDropDuplicatesRowsCode().format(newVariableName, currentVariableName);
            const historyItem = {
                transformation: DataScience.dataWranglerDropDuplicatesRowsTransformation(),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        }
    }

    private async dropNa(req: IDropNaRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;

        if (req.subset !== undefined) {
            // This assumes only one column/row at a time
            const subset = req.subset.map((col: string) => `'${col}'`).join(', ');
            const code = DataScience.dataWranglerDropNaRowsOnColumnCode().format(
                newVariableName,
                currentVariableName,
                subset
            );
            const historyItem = {
                transformation: DataScience.dataWranglerDropNaRowsOnColumnTransformation().format(subset),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        } else {
            const code = DataScience.dataWranglerDropNaCode().format(
                newVariableName,
                currentVariableName,
                req.target?.toString() ?? ''
            );
            const historyItem = {
                transformation:
                    req.target == 0
                        ? DataScience.dataWranglerDropNaRowsTransformation()
                        : DataScience.dataWranglerDropNaColumnsTransformation(),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        }
    }

    private async normalizeColumn(req: INormalizeColumnRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const code = DataScience.dataWranglerNormalizeColumnCode().format(
            req.start.toString(),
            req.end.toString(),
            newVariableName,
            currentVariableName,
            newVariableName,
            req.target,
            newVariableName,
            req.target
        );
        const historyItem = {
            transformation: DataScience.dataWranglerNormalizeColumnTransformation().format(req.target),
            variableName: newVariableName,
            code: code
        };
        this.addToHistory(historyItem);
        return historyItem;
    }

    private async fillNa(req: IFillNaRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const code = DataScience.dataWranglerFillNaCode().format(
            newVariableName,
            currentVariableName,
            req.newValue.toString()
        );
        const historyItem = {
            transformation: DataScience.dataWranglerFillNaTransformation().format(req.newValue.toString()),
            variableName: newVariableName,
            code: code
        };
        this.addToHistory(historyItem);
        return historyItem;
    }
}
