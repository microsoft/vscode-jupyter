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
    IPlotHistogramReq,
    IGetColumnStatsReq
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
        this.commands.set(DataWranglerCommands.PyplotHistogram, this.plotHistogram.bind(this));
        this.commands.set(DataWranglerCommands.ExportToCsv, this.exportToCsv.bind(this));
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
            this.postMessage(DataWranglerMessages.UpdateHistoryList, wantedPanels).ignoreErrors();

            // Use Data Viewer logic to show initial data
            const dataFrameInfo = await this.showInitialData(title);
            this.sourceFile = dataFrameInfo.sourceFile;

            this.historyList.push({
                transformation: DataScience.dataWranglerImportTransformation(),
                code: DataScience.dataWranglerImportCode().format(this.sourceFile ?? 'broken'),
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

    private async plotHistogram(req: IPlotHistogramReq, currentVariableName: string): Promise<IHistoryItem> {
        const code = DataScience.dataWranglerPyplotHistogramCode().format(currentVariableName, req.target);
        return { code: code } as IHistoryItem;
    }

    private async getColumnStats(req: IGetColumnStatsReq) {
        if (this.dataProvider && this.dataProvider.getCols && req.columnName !== undefined) {
            const columnData = await this.dataProvider.getCols(req.columnName);
            void this.postMessage(DataWranglerMessages.GetHistogramResponse, {
                cols: columnData,
                columnName: req.columnName
            });
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleCommand(payload: { command: string; args: any }) {
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
                await this.updateWithNewVariable(newVariableName);
            });
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
