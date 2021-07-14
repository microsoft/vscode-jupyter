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
    IThemeFinder,
    WebViewViewChangeEventArgs
} from '../../types';
import { updateCellCode } from '../../notebook/helpers/executionHelpers';
import { CssMessages } from '../../messages';
import { ColumnType, DataViewerMessages, IDataFrameInfo, IDataViewerDataProvider } from '../types';
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
    IGetHistoryItem,
    IReplaceAllColumnsRequest,
    IRemoveHistoryItemRequest,
    SidePanelSections,
    IGetColumnStatsReq,
    ICellCssStylesHash
} from './types';
import { DataScience } from '../../../common/utils/localize';
import { DataViewer } from '../dataViewer';

const PREFERRED_VIEWGROUP = 'JupyterDataWranglerPreferredViewColumn';
const dataWranglerDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');

// Keeps track of all the transformations called on the data wrangler
// Runs the transformations, communicates with the data wrangler UI through onMessage and postMessage
@injectable()
export class DataWrangler extends DataViewer implements IDataWrangler, IDisposable {
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
        this.commands.set(DataWranglerCommands.RemoveHistoryItem, this.removeHistoryItem.bind(this));
        this.commands.set(DataWranglerCommands.ExportToCsv, this.exportToCsv.bind(this));
        this.commands.set(DataWranglerCommands.RespondToPreview, this.respondToPreview.bind(this));

        this.onDidDispose(this.dataWranglerDisposed, this);
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
            const settings = this.configService.getSettings();
            if (settings && settings.dataWrangler && settings.dataWrangler.sidePanelSections) {
                const wantedPanels = settings.dataWrangler.sidePanelSections;
                this.postMessage(
                    DataWranglerMessages.SetSidePanels,
                    wantedPanels as SidePanelSections[]
                ).ignoreErrors();
            }

            // Use Data Viewer logic to show initial data
            const dataFrameInfo = await this.showInitialData(title);
            this.sourceFile = dataFrameInfo.sourceFile;

            this.historyList.push({
                description: DataScience.dataWranglerImportDescription(),
                code: `import pandas as pd\r\ndf = pd.read_csv(r'${this.sourceFile ?? 'broken'}')\n`,
                variableName: 'df'
            });
            this.postMessage(DataWranglerMessages.UpdateHistoryList, this.historyList).ignoreErrors();
        }
    }

    protected async showInitialData(title: string): Promise<IDataFrameInfo> {
        super.setTitle(title);

        // Then show our web panel. Eventually we need to consume the data
        await super.show(true);

        let dataFrameInfo = await this.prepDataFrameInfo();

        // Send a message with our data
        this.postMessage(DataViewerMessages.InitializeData, dataFrameInfo).ignoreErrors();

        // Return for data wrangler to use
        return dataFrameInfo;
    }

    private dataWranglerDisposed() {
        this._onDidDisposeDataWrangler.fire(this as IDataWrangler);
    }

    // Shows the dataframe in data viewer associated with newVariableName
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

    protected async onViewStateChanged(args: WebViewViewChangeEventArgs) {
        if (args.current.active && args.current.visible && args.previous.active && args.current.visible) {
            await this.globalMemento.update(PREFERRED_VIEWGROUP, this.webPanel?.viewColumn);
        }
        this._onDidChangeDataWranglerViewState.fire();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected onMessage(message: string, payload: any) {
        let handled = false;
        switch (message) {
            case DataWranglerMessages.SubmitCommand:
                this.handleCommand(payload).ignoreErrors();
                handled = true;
                break;

            case DataWranglerMessages.RefreshDataWrangler:
                this.refreshData().ignoreErrors();
                handled = true;
                break;

            case CssMessages.GetMonacoThemeRequest:
                void this.handleMonacoThemeRequest(payload);
                handled = true;
                break;

            default:
                break;
        }

        if (!handled) {
            // Some messages will be handled by DataViewer
            super.onMessage(message, payload);
        }
    }

    private addToHistory(newHistoryItem: IHistoryItem) {
        this.historyList.push(newHistoryItem);
        this.postMessage(DataWranglerMessages.UpdateHistoryList, this.historyList).ignoreErrors();
    }

    private getCode() {
        return this.historyList.map((item) => item.code).join('\n');
    }

    private async exportToCsv(_req: undefined, currentVariableName: string) {
        const notebook = (this.dataProvider as IJupyterVariableDataProvider).notebook;
        const fileInfo = await this.applicationShell.showSaveDialog({
            saveLabel: DataScience.dataWranglerSaveCsv(),
            filters: { CSV: ['csv'] }
        });
        if (fileInfo) {
            const code = `${currentVariableName}.to_csv(path_or_buf=r'${fileInfo.fsPath}', index=False)`;
            await notebook?.execute(code, '', 0, uuid(), undefined, false);
        }
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
    private async handleCommand(payload: { command: DataWranglerCommands; args: any }) {
        console.log('handle command', payload);
        const notebook = (this.dataProvider as IJupyterVariableDataProvider).notebook;
        let codeToRun;
        const currentVariableName = (await this.dataFrameInfoPromise)!.name ?? '';
        let newVariableName = currentVariableName ?? '';
        let historyItem: IHistoryItem | void;

        // Get and run data wrangler command
        const cmd = this.commands.get(payload.command);
        if (cmd) {
            historyItem = await cmd(payload.args, currentVariableName);
            if (historyItem !== undefined) {
                codeToRun = historyItem.isPreview ? historyItem.previewCode : historyItem.code;
                newVariableName = historyItem.variableName;
            }
        }

        // Execute python command
        if (codeToRun !== undefined && notebook !== undefined) {
            await notebook?.execute(codeToRun, '', 0, uuid());
            if (this.existingDisposable) {
                this.existingDisposable.dispose();
            }
            if (newVariableName) {
                await this.updateWithNewVariable(newVariableName);
            }
        }

        if (historyItem) {
            // Add the history item to the history list to be displayed
            if (historyItem?.shouldAdd) {
                this.addToHistory(historyItem);
            }

            // Change data wrangler cell stylings if preview operation
            if (historyItem?.isPreview && historyItem.type) {
                const stylings = await this.computeCssStylings(historyItem.type);
                if (stylings) {
                    void this.postMessage(DataWranglerMessages.OperationPreview, {
                        type: historyItem.type,
                        cssStylings: stylings
                    });
                }
            }
        }
    }

    public async removeLatestHistoryItem() {
        if (this.historyList.length > 1) {
            await this.handleCommand({
                command: DataWranglerCommands.RemoveHistoryItem,
                args: { index: this.historyList.length - 1 }
            });
        }
    }

    public async removeHistoryItem(req: IRemoveHistoryItemRequest, currentVariableName: string): Promise<IHistoryItem> {
        this.historyList.splice(req.index, 1);
        this.postMessage(DataWranglerMessages.UpdateHistoryList, this.historyList).ignoreErrors();
        return {
            type: DataWranglerCommands.RemoveHistoryItem,
            description: '',
            code: `del ${currentVariableName}`,
            variableName: this.historyList[this.historyList.length - 1].variableName,
            shouldAdd: false
        };
    }

    private async coerceColumn(req: ICoerceColumnRequest, currentVariableName: string): Promise<IHistoryItem> {
        const vars = this.cleanHistoryAndGetNewVariableName(currentVariableName);
        const currVar = vars.currentVariableName;
        const newVar = vars.newVariableName;

        const columns = req.targetColumns.map((col) => `'${col}'`).join(', ');
        const astypeDict = req.targetColumns.map((col) => `'${col}': '${req.newType}'`).join(', ');
        const code = `${newVar} = ${currVar}.astype({${astypeDict}})\n`;
        const historyItem = {
            type: DataWranglerCommands.CoerceColumn,
            description: DataScience.dataWranglerCoerceColumnDescription().format(columns, req.newType),
            variableName: newVar,
            code: code,
            shouldAdd: true
        };
        return historyItem;
    }

    private async replaceAllColumn(req: IReplaceAllColumnsRequest, currentVariableName: string): Promise<IHistoryItem> {
        const vars = this.cleanHistoryAndGetNewVariableName(currentVariableName);
        const currVar = vars.currentVariableName;
        const newVar = vars.newVariableName;

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
        let code = `${newVar} = ${currVar}.copy()\r\n`;
        let previewCode = code.slice();

        // Replace columns that have type string
        if (stringColumns.length > 0) {
            const strCols = stringColumns.map((col) => `'${col}'`).join(', ');
            code += `${newVar}[[${strCols}]] = ${newVar}[[${strCols}]].replace(to_replace='${req.oldValue}', value='${req.newValue}')\r\n`;

            if (req.isPreview) {
                for (const col of stringColumns) {
                    previewCode += `idx = ${newVar}.columns.get_loc("${col}")\r\n`;
                    previewCode += `data = ${newVar}[['${col}']].replace(to_replace='${req.oldValue}', value='${req.newValue}')\r\n`;
                    previewCode += `${newVar}.insert(idx + 1, '${col} (preview)', data)\n`;
                }
            }
        }

        // Replace columns that have type boolean or number
        if (boolNumColumns.length > 0) {
            const boolNumCols = boolNumColumns.map((col) => `'${col}'`).join(', ');
            code += `${newVar}[[${boolNumCols}]] = ${newVar}[[${boolNumCols}]].replace(to_replace=${req.oldValue}, value=${req.newValue})\n`;

            if (req.isPreview) {
                for (const col of boolNumColumns) {
                    previewCode += `idx = ${newVar}.columns.get_loc("${col}")\r\n`;
                    previewCode += `data = ${newVar}[['${col}']].replace(to_replace=${req.oldValue}, value=${req.newValue})\r\n`;
                    previewCode += `${newVar}.insert(idx + 1, '${col} (preview)', data)\n`;
                }
            }
        }

        const historyItem = {
            type: DataWranglerCommands.ReplaceAllColumn,
            description: DataScience.dataWranglerReplaceAllDescription().format(
                req.oldValue as string,
                req.newValue as string,
                columns
            ),
            variableName: newVar,
            code: code,
            previewCode: previewCode,
            isPreview: req.isPreview,
            shouldAdd: true
        };
        return historyItem;
    }

    private async renameColumn(req: IRenameColumnsRequest, currentVariableName: string): Promise<IHistoryItem> {
        const vars = this.cleanHistoryAndGetNewVariableName(currentVariableName);
        const currVar = vars.currentVariableName;
        const newVar = vars.newVariableName;

        const code = `${newVar} = ${currVar}.rename(columns={ '${req.targetColumn}': '${req.newColumnName}' })\n`;
        const historyItem = {
            type: DataWranglerCommands.RenameColumn,
            description: DataScience.dataWranglerRenameColumnDescription().format(req.targetColumn, req.newColumnName),
            variableName: newVar,
            code: code,
            shouldAdd: true
        };
        return historyItem;
    }

    private async drop(req: IDropRequest, currentVariableName: string): Promise<IHistoryItem> {
        const vars = this.cleanHistoryAndGetNewVariableName(currentVariableName);
        const currVar = vars.currentVariableName;
        const newVar = vars.newVariableName;

        if (req.rowIndex !== undefined) {
            // Drop rows by index
            const code = `${newVar} = ${currVar}.drop(index=${req.rowIndex})\n`;
            const historyItem = {
                type: DataWranglerCommands.Drop,
                description: DataScience.dataWranglerDropRowDescription().format(req.rowIndex.toString()),
                variableName: newVar,
                code: code,
                shouldAdd: true
            };
            return historyItem;
        } else if (req.targetColumns) {
            // Drop columns by column name
            const labels = req.targetColumns;
            const columnNames = labels.map((label) => `'${label}'`).join(', ');
            const code = `${newVar} = ${currVar}.drop(columns=[${columnNames}])\n`;
            const historyItem = {
                type: DataWranglerCommands.Drop,
                description: DataScience.dataWranglerDropColumnDescription().format(columnNames),
                variableName: newVar,
                code: code,
                shouldAdd: true
            };
            return historyItem;
        }
        return {} as IHistoryItem;
    }

    private async dropDuplicates(req: IDropDuplicatesRequest, currentVariableName: string): Promise<IHistoryItem> {
        const vars = this.cleanHistoryAndGetNewVariableName(currentVariableName);
        const currVar = vars.currentVariableName;
        const newVar = vars.newVariableName;

        if (req.targetColumns !== undefined) {
            // Drop duplicates in a column
            const targetColumns = req.targetColumns.map((col: string) => `'${col}'`).join(', ');
            const code = `${newVar} = ${currVar}.drop_duplicates(subset=[${targetColumns}])\n`;
            const historyItem = {
                type: DataWranglerCommands.DropDuplicates,
                description: DataScience.dataWranglerDropDuplicatesRowsOnColumnDescription().format(targetColumns),
                variableName: newVar,
                code: code,
                shouldAdd: true
            };
            return historyItem;
        } else {
            // Drop duplicate rows
            const code = `${newVar} = ${currVar}.drop_duplicates()\n`;
            const historyItem = {
                type: DataWranglerCommands.DropDuplicates,
                description: DataScience.dataWranglerDropDuplicatesRowsDescription(),
                variableName: newVar,
                code: code,
                shouldAdd: true
            };
            return historyItem;
        }
    }

    private async dropNa(req: IDropNaRequest, currentVariableName: string): Promise<IHistoryItem> {
        const vars = this.cleanHistoryAndGetNewVariableName(currentVariableName);
        const currVar = vars.currentVariableName;
        const newVar = vars.newVariableName;

        if (req.targetColumns !== undefined) {
            // Only drop rows where there are Na values in the target columns
            const targetColumns = req.targetColumns.map((col: string) => `'${col}'`).join(', ');
            const code = `${newVar} = ${currVar}.dropna(subset=[${targetColumns}])\n`;
            const historyItem = {
                type: DataWranglerCommands.DropNa,
                description: DataScience.dataWranglerDropNaRowsOnColumnDescription().format(targetColumns),
                variableName: newVar,
                code: code,
                shouldAdd: true
            };
            return historyItem;
        } else {
            // Drop all rows that contain any Na value or drop all columns that contain any Na value
            const axis = req.target === 'row' ? '0' : '1';
            const code = `${newVar} = ${currVar}.dropna(axis=${axis})\n`;
            const historyItem: IHistoryItem = {
                type: DataWranglerCommands.DropNa,
                description:
                    req.target === 'row'
                        ? DataScience.dataWranglerDropNaRowsDescription()
                        : DataScience.dataWranglerDropNaColumnsDescription(),
                variableName: newVar,
                code: code,
                shouldAdd: true
            };
            if (req.isPreview) {
                historyItem.isPreview = req.isPreview;
                historyItem.previewCode = `${newVar} = ${currVar}`;
            }
            return historyItem;
        }
    }

    private async normalizeColumn(req: INormalizeColumnRequest, currentVariableName: string): Promise<IHistoryItem> {
        const vars = this.cleanHistoryAndGetNewVariableName(currentVariableName);
        const currVar = vars.currentVariableName;
        const newVar = vars.newVariableName;

        // MinMaxScaler code in pandas taken from https://stackoverflow.com/a/50028155
        let previewCode = '';
        let code = `new_min, new_max = ${req.start.toString()}, ${req.end.toString()}\r\n`;
        code += `old_min, old_max = ${currVar}[['${req.targetColumn}']].min(), ${currVar}[['${req.targetColumn}']].max()\r\n`;
        code += `${newVar} = ${currVar}.copy()\r\n`;

        if (req.isPreview) {
            previewCode = code.slice();
            previewCode += `idx = ${currVar}.columns.get_loc("${req.targetColumn}")\r\n`;
            previewCode += `data = (${currVar}[['${req.targetColumn}']] - old_min) / (old_max - old_min) * (new_max - new_min) + new_min\r\n`;
            previewCode += `${newVar}.insert(idx + 1, '${req.targetColumn} (preview)', data)\n`;
        }

        code += `${newVar}['${req.targetColumn}'] = (${currVar}[['${req.targetColumn}']] - old_min) / (old_max - old_min) * (new_max - new_min) + new_min\n`;

        const historyItem = {
            type: DataWranglerCommands.NormalizeColumn,
            description: DataScience.dataWranglerNormalizeColumnDescription().format(req.targetColumn),
            variableName: newVar,
            code: code,
            previewCode: previewCode,
            isPreview: req.isPreview,
            shouldAdd: true
        };

        return historyItem;
    }

    private async fillNa(req: IFillNaRequest, currentVariableName: string): Promise<IHistoryItem> {
        const vars = this.cleanHistoryAndGetNewVariableName(currentVariableName);
        const currVar = vars.currentVariableName;
        const newVar = vars.newVariableName;

        const code = `${currVar} = ${currVar}.fillna(${req.newValue.toString()})\n`;
        const historyItem = {
            type: DataWranglerCommands.FillNa,
            description: DataScience.dataWranglerFillNaDescription().format(req.newValue.toString()),
            variableName: newVar,
            code: code,
            shouldAdd: true
        };

        return historyItem;
    }

    private async respondToPreview(req: { doesAccept: boolean }): Promise<IHistoryItem> {
        this.postMessage(DataWranglerMessages.OperationPreview, { type: undefined }).ignoreErrors();
        if (!this.historyList[this.historyList.length - 1].isPreview) {
            // Most recent operation is not a preview operation
            return {} as IHistoryItem;
        }
        if (req.doesAccept) {
            this.historyList[this.historyList.length - 1].isPreview = false;
            this.historyList[this.historyList.length - 1].shouldAdd = false;
            this.postMessage(DataWranglerMessages.UpdateHistoryList, this.historyList).ignoreErrors();
            return this.historyList[this.historyList.length - 1];
        } else {
            // Reject preview
            // Remove history item
            this.historyList.pop();
            this.postMessage(DataWranglerMessages.UpdateHistoryList, this.historyList).ignoreErrors();

            // Go back to oldest variable and display its data
            const newVariableName = this.historyList[this.historyList.length - 1].variableName;
            await this.updateWithNewVariable(newVariableName);
            return {} as IHistoryItem;
        }
    }

    // Removes subsequent history items if current variable is an intermediate step
    // Then sets most recent variable to the action performed after that intermediate step
    private cleanHistoryAndGetNewVariableName(
        currentVariableName: string
    ): { currentVariableName: string; newVariableName: string } {
        // Get index from variable name
        const currVarIndex = Number(currentVariableName.substr(2));

        if (this.historyList[this.historyList.length - 1].isPreview) {
            // Latest operation was a preview operation
            this.postMessage(DataWranglerMessages.OperationPreview, { type: undefined }).ignoreErrors();
            const latestHistoryItem = this.historyList.pop();
            if (latestHistoryItem && latestHistoryItem.variableName === currentVariableName) {
                // Newest operation was branched off of the preview operation so we need to instead branch it off of
                // the stable operation before the preview operation
                const newCurrVar = Number(currVarIndex) - 1 === 0 ? 'df' : 'df' + (Number(currVarIndex) - 1).toString();
                return {
                    currentVariableName: newCurrVar,
                    newVariableName: currentVariableName
                };
            }
            // Newest operation was based off an intermediate stable operation
            return { currentVariableName, newVariableName: 'df' + (Number(currVarIndex) + 1).toString() };
        } else if (currentVariableName === 'df') {
            this.historyList = this.historyList.slice(0, 1);
            return { currentVariableName: 'df', newVariableName: 'df1' };
        } else {
            this.historyList = this.historyList.slice(0, currVarIndex + 1);
            return { currentVariableName, newVariableName: 'df' + (Number(currVarIndex) + 1).toString() };
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async computeCssStylings(operation: DataWranglerCommands): Promise<ICellCssStylesHash> {
        if (operation === DataWranglerCommands.DropNa) {
            const dataFrameInfo = await this.dataFrameInfoPromise;
            const columns = dataFrameInfo?.columns?.length;
            const nanRows = dataFrameInfo?.nanRows;

            if (!columns) {
                return {};
            }

            // Create individual row styling that will be given to each row
            // It is an object with the keys as all the column names
            const rowStyling: { [id: number]: string } = {};
            // Need to + 1 because slick grid adds an additional column
            for (let i = 0; i < columns + 1; i++) {
                rowStyling[i] = 'react-grid-cell-before';
            }
            // Create whole styling
            // It is an object with the keys as the rows and the values as the stylings defined above
            if (rowStyling !== undefined) {
                return (
                    nanRows?.reduce((result, row) => {
                        result[row] = rowStyling;
                        return result;
                    }, {} as ICellCssStylesHash) ?? {}
                );
            }
        } else if (operation === DataWranglerCommands.ReplaceAllColumn) {
            const dataFrameInfo = await this.dataFrameInfoPromise;
            return dataFrameInfo?.previewDiffs ?? {};
        }
        return {};
    }
}
