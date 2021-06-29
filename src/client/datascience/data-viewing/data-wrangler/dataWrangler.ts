// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { Disposable, EventEmitter, Memento, NotebookCell, ViewColumn, WebviewPanel } from 'vscode';

import {
    IApplicationShell,
    ICommandManager,
    IWebviewPanelProvider,
    IWorkspaceService,
    IDocumentManager
} from '../../../common/application/types';
import { EXTENSION_ROOT_DIR, PYTHON_LANGUAGE, UseCustomEditorApi } from '../../../common/constants';
import { traceError } from '../../../common/logger';
import { GLOBAL_MEMENTO, IConfigurationService, IDisposable, IMemento } from '../../../common/types';
import * as localize from '../../../common/utils/localize';
import { Commands, Identifiers } from '../../constants';
import {
    ICodeCssGenerator,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    IThemeFinder
} from '../../types';
import { updateCellCode } from '../../notebook/helpers/executionHelpers';
import { InteractiveWindowMessages } from '../../interactive-common/interactiveWindowTypes';
import { CssMessages } from '../../messages';
import { ColumnType, DataViewerMessages, IDataViewerDataProvider } from '../types';
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
    ICoerceColumnRequest,
    IGetColumnStatsReq,
    IGetHistoryItem,
    IReplaceAllColumnsRequest,
    SidePanelSections
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
        private dataProviderFactory: IJupyterVariableDataProviderFactory
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
            ViewColumn.One
        );
        this.onDidDispose(this.dataWranglerDisposed, this);

        this.commands.set(DataWranglerCommands.Describe, this.getColumnStats.bind(this));
        this.commands.set(DataWranglerCommands.ExportToPythonScript, this.generatePythonCode.bind(this));
        this.commands.set(DataWranglerCommands.ExportToNotebook, this.generateNotebook.bind(this));
        this.commands.set(DataWranglerCommands.RenameColumn, this.renameColumn.bind(this));
        this.commands.set(DataWranglerCommands.Drop, this.drop.bind(this));
        this.commands.set(DataWranglerCommands.DropDuplicates, this.dropDuplicates.bind(this));
        this.commands.set(DataWranglerCommands.DropNa, this.dropNa.bind(this));
        this.commands.set(DataWranglerCommands.NormalizeColumn, this.normalizeColumn.bind(this));
        this.commands.set(DataWranglerCommands.FillNa, this.fillNa.bind(this));
        this.commands.set(DataWranglerCommands.GetHistoryItem, this.getHistoryItem.bind(this));
        this.commands.set(DataWranglerCommands.CoerceColumn, this.coerceColumn.bind(this));
        this.commands.set(DataWranglerCommands.ReplaceAllColumn, this.replaceAllColumn.bind(this));
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

            const wantedPanels = this.configService.getSettings().dataWrangler.sidePanelSections;
            this.postMessage(DataWranglerMessages.SetSidePanels, wantedPanels as SidePanelSections[]).ignoreErrors();

            // Use Data Viewer logic to show initial data
            const dataFrameInfo = await this.showInitialData(title);
            this.sourceFile = dataFrameInfo.sourceFile;

            this.historyList.push({
                transformation: DataScience.dataWranglerImportTransformation(),
                code: `import pandas as pd\r\ndf = pd.read_csv(r'${this.sourceFile ?? 'broken'}')\n`,
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

    public async getHistoryItem(req: IGetHistoryItem) {
        const variableName = this.historyList[req.index].variableName;
        await this.updateWithNewVariable(variableName);
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

    private addToHistory(newHistoryItem: IHistoryItem) {
        this.historyList.push(newHistoryItem);
        this.postMessage(DataWranglerMessages.UpdateHistoryList, this.historyList).ignoreErrors();
    }

    private getCode() {
        return this.historyList.map((item) => item.code).join('\n');
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

    private async getColumnStats(req: IGetColumnStatsReq) {
        if (this.dataProvider && this.dataProvider.getCols && req.targetColumn !== undefined) {
            const columnData = await this.dataProvider.getCols(req.targetColumn);
            void this.postMessage(DataWranglerMessages.GetHistogramResponse, {
                cols: columnData,
                columnName: req.targetColumn
            });
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleCommand(payload: { command: string; args: any }) {
        console.log('handle command', payload);
        const notebook = (this.dataProvider as IJupyterVariableDataProvider).notebook;
        let code = '';
        const currentVariableName = (await this.dataFrameInfoPromise)!.name ?? '';
        let newVariableName = currentVariableName ?? '';

        // Get and run data wrangler command
        const cmd = this.commands.get(payload.command as DataWranglerCommands);
        if (cmd) {
            const historyItem = await cmd(payload.args, currentVariableName);
            if (historyItem) {
                code = historyItem.code;
                newVariableName = historyItem.variableName;
            }
        }

        // Execute python command
        if (code && notebook !== undefined) {
            void notebook?.execute(code, '', 0, uuid()).then(async () => {
                if (this.existingDisposable) {
                    this.existingDisposable.dispose();
                }
                if (newVariableName) {
                    await this.updateWithNewVariable(newVariableName);
                }
            });
        }
    }

    private async coerceColumn(req: ICoerceColumnRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const columns = req.targetColumns.map((col) => `'${col}'`).join(', ');
        const astypeDict = req.targetColumns.map((col) => `'${col}': '${req.newType}'`).join(', ');
        const code = `${newVariableName} = ${currentVariableName}.astype({${astypeDict}})\n`;
        const historyItem = {
            transformation: DataScience.dataWranglerCoerceColumnTransformation().format(columns, req.newType),
            variableName: newVariableName,
            code: code
        };
        this.addToHistory(historyItem);
        return historyItem;
    }

    private async replaceAllColumn(req: IReplaceAllColumnsRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const columns = req.targetColumns.map((col) => `'${col}'`).join(', ');

        // Find type of each column
        // It is necessary so we replace the values in the columns with the correct column type
        const dataFrameInfo = await this.dataFrameInfoPromise;
        const stringColumns = [];
        const boolNumColumns = [];
        for (const col of req.targetColumns) {
            const type = dataFrameInfo?.columns?.find((c) => c.key === col)?.type;
            if (type && type === ColumnType.String) {
                stringColumns.push(col);
            } else if (type && (type === ColumnType.Bool || type === ColumnType.Number)) {
                boolNumColumns.push(col);
            }
        }

        // Make a copy of dataframe
        let code = `${newVariableName} = ${currentVariableName}.copy()\n`;

        // Replace columns that have type string
        if (stringColumns.length > 0) {
            code += `${newVariableName}[[${columns}]] = ${newVariableName}[[${columns}]].replace(to_replace='${req.oldValue}', value='${req.newValue}')\n`;
        }

        // Replace columns that have type boolean or number
        if (boolNumColumns.length > 0) {
            code += `${newVariableName}[[${columns}]] = ${newVariableName}[[${columns}]].replace(to_replace=${req.oldValue}, value=${req.newValue})\n`;
        }

        const historyItem = {
            transformation: DataScience.dataWranglerReplaceAllTransformation().format(
                req.oldValue as string,
                req.newValue as string,
                columns
            ),
            variableName: newVariableName,
            code: code
        };
        this.addToHistory(historyItem);
        return historyItem;
    }

    private async renameColumn(req: IRenameColumnsRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const code = `${newVariableName} = ${currentVariableName}.rename(columns={ '${req.targetColumn}': '${req.newColumnName}' })\n`;
        const historyItem = {
            transformation: DataScience.dataWranglerRenameColumnTransformation().format(
                req.targetColumn,
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
        if (req.rowIndex) {
            // Drop rows by index
            const code = `${newVariableName} = ${currentVariableName}.drop(index=${req.rowIndex})\n`;
            const historyItem = {
                transformation: DataScience.dataWranglerDropRowTransformation().format(req.rowIndex.toString()),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        } else if (req.targetColumns) {
            // Drop columns by column name
            const labels = req.targetColumns;
            const columnNames = labels.map((label) => `'${label}'`).join(', ');
            const code = `${newVariableName} = ${currentVariableName}.drop(columns=[${columnNames}])\n`;
            const historyItem = {
                transformation: DataScience.dataWranglerDropColumnTransformation().format(columnNames),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        }
        return {} as IHistoryItem;
    }

    private async dropDuplicates(req: IDropDuplicatesRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;

        if (req.targetColumns !== undefined) {
            // Drop duplicates in a column
            const targetColumns = req.targetColumns.map((col: string) => `'${col}'`).join(', ');
            const code = `${newVariableName} = ${currentVariableName}.drop_duplicates(subset=[${targetColumns}])\n`;
            const historyItem = {
                transformation: DataScience.dataWranglerDropDuplicatesRowsOnColumnTransformation().format(
                    targetColumns
                ),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        } else {
            // Drop duplicate rows
            const code = `${newVariableName} = ${currentVariableName}.drop_duplicates()\n`;
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

        if (req.targetColumns !== undefined) {
            // Only drop rows where there are Na values in the target columns
            const targetColumns = req.targetColumns.map((col: string) => `'${col}'`).join(', ');
            const code = `${newVariableName} = ${currentVariableName}.dropna(subset=[${targetColumns}])\n`;
            const historyItem = {
                transformation: DataScience.dataWranglerDropNaRowsOnColumnTransformation().format(targetColumns),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        } else {
            // Drop all rows that contain any Na value or drop all columns that contain any Na value
            const axis = req.target === 'row' ? '0' : '1';
            const code = `${newVariableName} = ${currentVariableName}.dropna(axis=${axis})\n`;
            const historyItem = {
                transformation:
                    req.target === 'row'
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
        const code = `from sklearn.preprocessing import MinMaxScaler\r\nscaler = MinMaxScaler(feature_range=(${req.start.toString()}, ${req.end.toString()}))\r\n${newVariableName} = ${currentVariableName}.copy()\r\n${newVariableName}['${
            req.targetColumn
        }'] = scaler.fit_transform(${newVariableName}['${req.targetColumn}'].values.reshape(-1, 1))\n`;
        const historyItem = {
            transformation: DataScience.dataWranglerNormalizeColumnTransformation().format(req.targetColumn),
            variableName: newVariableName,
            code: code
        };
        this.addToHistory(historyItem);
        return historyItem;
    }

    private async fillNa(req: IFillNaRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const code = `${currentVariableName} = ${currentVariableName}.fillna(${req.newValue.toString()})\n`;
        const historyItem = {
            transformation: DataScience.dataWranglerFillNaTransformation().format(req.newValue.toString()),
            variableName: newVariableName,
            code: code
        };
        this.addToHistory(historyItem);
        return historyItem;
    }
}
