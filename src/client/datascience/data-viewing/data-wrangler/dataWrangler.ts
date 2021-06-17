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
    notebooks as vscNotebook,
    NotebookCell,
    NotebookCellExecutionState,
    NotebookCellExecutionStateChangeEvent,
    ViewColumn,
    WebviewPanel
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
import { GLOBAL_MEMENTO, IConfigurationService, IDisposable, IMemento, Resource } from '../../../common/types';
import * as localize from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import { Commands, HelpLinks, Identifiers } from '../../constants';
import { JupyterDataRateLimitError } from '../../jupyter/jupyterDataRateLimitError';
import {
    ICodeCssGenerator,
    IJupyterVariables,
    INotebookEditorProvider,
    IThemeFinder,
    WebViewViewChangeEventArgs
} from '../../types';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { isValidSliceExpression, preselectedSliceExpression } from '../../../../datascience-ui/data-explorer/helpers';
import { addNewCellAfter, updateCellCode } from '../../notebook/helpers/executionHelpers';
import { InteractiveWindowMessages } from '../../interactive-common/interactiveWindowTypes';
import { serializeLanguageConfiguration } from '../../interactive-common/serialization';
import { CssMessages } from '../../messages';
import { IDataFrameInfo, IGetRowsRequest, IGetSliceRequest } from '../types';
import { DataWranglerMessageListener } from './dataWranglerMessageListener';
import {
    IDataWranglerMapping,
    IDataWrangler,
    IDataWranglerDataProvider,
    DataWranglerMessages,
    DataWranglerCommands,
    IRenameColumnsRequest,
    IHistoryItem,
    IDropRequest,
    INormalizeColumnRequest,
    IFillNaRequest,
    IDropDuplicatesRequest,
    IDropNaRequest,
    OpenDataWranglerSetting,
    IDataWranglerJupyterVariableDataProvider,
    IDataWranglerJupyterVariableDataProviderFactory
} from './types';

const PREFERRED_VIEWGROUP = 'JupyterDataWranglerPreferredViewColumn';
const dataWranglerDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');
@injectable()
export class DataWrangler extends WebviewPanelHost<IDataWranglerMapping> implements IDataWrangler, IDisposable {
    private dataProvider: IDataWranglerDataProvider | undefined;
    private dataFrameInfoPromise: Promise<IDataFrameInfo> | undefined;
    private currentSliceExpression: string | undefined;
    private variableCounter = 0;
    private existingDisposable: Disposable | undefined;
    private historyList: IHistoryItem[] = [];
    private sourceFile: string | undefined;

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
        @inject(IWebviewPanelProvider) provider: IWebviewPanelProvider,
        @inject(IConfigurationService) configuration: IConfigurationService,
        @inject(ICodeCssGenerator) cssGenerator: ICodeCssGenerator,
        @inject(IThemeFinder) themeFinder: IThemeFinder,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(UseCustomEditorApi) useCustomEditorApi: boolean,
        @inject(IMemento) @named(GLOBAL_MEMENTO) readonly globalMemento: Memento,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager,
        @inject(IJupyterVariables)
        @named(Identifiers.KERNEL_VARIABLES)
        private kernelVariableProvider: IJupyterVariables,
        @inject(IDataWranglerJupyterVariableDataProviderFactory)
        private dataProviderFactory: IDataWranglerJupyterVariableDataProviderFactory,
        @inject(INotebookEditorProvider) private notebookEditorProvider: INotebookEditorProvider
    ) {
        super(
            configuration,
            provider,
            cssGenerator,
            themeFinder,
            workspaceService,
            (c, v, d) => new DataWranglerMessageListener(c, v, d),
            dataWranglerDir,
            [path.join(dataWranglerDir, 'commons.initial.bundle.js'), path.join(dataWranglerDir, 'dataWrangler.js')],
            localize.DataScience.dataExplorerTitle(),
            globalMemento.get(PREFERRED_VIEWGROUP) ?? ViewColumn.One,
            useCustomEditorApi
        );
        this.onDidDispose(this.dataWranglerDisposed, this);
    }

    public async showData(
        dataProvider: IDataWranglerDataProvider,
        title: string,
        webviewPanel: WebviewPanel
    ): Promise<void> {
        if (!this.isDisposed) {
            // Save the data provider
            this.dataProvider = dataProvider;

            // Load the web panel using our current directory as we don't expect to load any other files
            await super.loadWebview(process.cwd(), webviewPanel).catch(traceError);

            super.setTitle(title);

            // Then show our web panel. Eventually we need to consume the data
            await super.show(true);

            let dataFrameInfo = await this.getDataFrameInfo();
            this.sourceFile = dataFrameInfo.sourceFile;

            // If higher dimensional data, preselect a slice to show
            if (dataFrameInfo.shape && dataFrameInfo.shape.length > 2) {
                const slice = preselectedSliceExpression(dataFrameInfo.shape);
                dataFrameInfo = await this.getDataFrameInfo(slice);
            }

            // Send a message with our data
            this.postMessage(DataWranglerMessages.InitializeData, dataFrameInfo).ignoreErrors();

            this.historyList.push({
                transformation: 'Imported data',
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
        const notebook = (this.dataProvider as IDataWranglerJupyterVariableDataProvider).notebook;

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

        this.postMessage(DataWranglerMessages.InitializeData, dataFrameInfo).ignoreErrors();
    }

    public async getHistoryItem(index: number) {
        const variableName = this.historyList[index].variableName;

        void this.updateWithNewVariable(variableName);
    }

    public async refreshData() {
        const currentSliceExpression = this.currentSliceExpression;
        // Clear our cached info promise
        this.dataFrameInfoPromise = undefined;
        // Then send a refresh data payload
        // At this point, variable shape or type may have changed
        // such that previous slice expression is no longer valid
        let dataFrameInfo = await this.getDataFrameInfo(undefined, true);
        // Check whether the previous slice expression is valid WRT the new shape
        if (currentSliceExpression !== undefined && dataFrameInfo.shape !== undefined) {
            if (isValidSliceExpression(currentSliceExpression, dataFrameInfo.shape)) {
                dataFrameInfo = await this.getDataFrameInfo(currentSliceExpression);
            } else {
                // Previously applied slice expression isn't valid anymore
                // Generate a preselected slice
                const newSlice = preselectedSliceExpression(dataFrameInfo.shape);
                dataFrameInfo = await this.getDataFrameInfo(newSlice);
            }
        }
        traceInfo(`Refreshing data viewer for variable ${dataFrameInfo.name}`);
        // Send a message with our data
        this.postMessage(DataWranglerMessages.InitializeData, dataFrameInfo).ignoreErrors();
    }

    public dispose(): void {
        super.dispose();

        if (this.dataProvider) {
            // Call dispose on the data provider
            this.dataProvider.dispose();
            this.dataProvider = undefined;
        }
    }

    protected async onViewStateChanged(args: WebViewViewChangeEventArgs) {
        if (args.current.active && args.current.visible && args.previous.active && args.current.visible) {
            await this.globalMemento.update(PREFERRED_VIEWGROUP, this.webPanel?.viewColumn);
        }
        this._onDidChangeDataWranglerViewState.fire();
    }

    protected get owningResource(): Resource {
        return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case DataWranglerMessages.GetAllRowsRequest:
                this.getAllRows(payload as string).ignoreErrors();
                break;

            case DataWranglerMessages.GetRowsRequest:
                this.getRowChunk(payload as IGetRowsRequest).ignoreErrors();
                break;

            case DataWranglerMessages.GetSliceRequest:
                this.getSlice(payload as IGetSliceRequest).ignoreErrors();
                break;

            case DataWranglerMessages.SubmitCommand:
                this.handleCommand(payload).ignoreErrors();
                break;

            case DataWranglerMessages.RefreshDataWrangler:
                this.refreshData().ignoreErrors();
                // TODOV Telemetry
                // void sendTelemetryEvent(Telemetry.RefreshDataWrangler);
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

    private getDataFrameInfo(sliceExpression?: string, isRefresh?: boolean): Promise<IDataFrameInfo> {
        // If requesting a new slice, refresh our cached info promise
        if (!this.dataFrameInfoPromise || sliceExpression !== this.currentSliceExpression) {
            this.dataFrameInfoPromise = this.dataProvider
                ? this.dataProvider.getDataFrameInfo(sliceExpression, isRefresh)
                : Promise.resolve({});
            this.currentSliceExpression = sliceExpression;
        }
        return this.dataFrameInfoPromise;
    }

    private async getAllRows(sliceExpression?: string) {
        return this.wrapRequest(async () => {
            if (this.dataProvider) {
                const allRows = await this.dataProvider.getAllRows(sliceExpression);
                return this.postMessage(DataWranglerMessages.GetAllRowsResponse, allRows);
            }
        });
    }

    private getSlice(request: IGetSliceRequest) {
        return this.wrapRequest(async () => {
            if (this.dataProvider) {
                const payload = await this.getDataFrameInfo(request.slice);
                return this.postMessage(DataWranglerMessages.InitializeData, payload);
            }
        });
    }

    private getRowChunk(request: IGetRowsRequest) {
        return this.wrapRequest(async () => {
            if (this.dataProvider) {
                const dataFrameInfo = await this.getDataFrameInfo(request.sliceExpression);
                const rows = await this.dataProvider.getRows(
                    request.start,
                    Math.min(request.end, dataFrameInfo.rowCount ? dataFrameInfo.rowCount : 0),
                    request.sliceExpression
                );
                return this.postMessage(DataWranglerMessages.GetRowsResponse, {
                    rows,
                    start: request.start,
                    end: request.end
                });
            }
        });
    }

    private async wrapRequest(func: () => Promise<void>) {
        try {
            return await func();
        } catch (e) {
            if (e instanceof JupyterDataRateLimitError) {
                traceError(e);
                const actionTitle = localize.DataScience.pythonInteractiveHelpLink();
                this.applicationShell.showErrorMessage(e.toString(), actionTitle).then((v) => {
                    // User clicked on the link, open it.
                    if (v === actionTitle) {
                        this.applicationShell.openUrl(HelpLinks.JupyterDataRateHelpLink);
                    }
                }, noop);
                this.dispose();
            }
            traceError(e);
            this.applicationShell.showErrorMessage(e).then(noop, noop);
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
        return `import pandas as pd\ndf = pd.read_csv(r'${this.sourceFile}')\n`;
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
        if (this.dataProvider && columnName !== undefined) {
            const columnData = await this.dataProvider.getCols(columnName);
            void this.postMessage(DataWranglerMessages.GetHistogramResponse, {
                cols: columnData,
                columnName: columnName
            });
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleCommand(payload: { command: string; args: any }) {
        const notebook = (this.dataProvider as IDataWranglerJupyterVariableDataProvider).notebook;
        let historyItem = {} as IHistoryItem;
        let code = '';
        const currentVariableName = (await this.dataFrameInfoPromise)!.name ?? '';
        let newVariableName = currentVariableName ?? '';
        const matchingNotebookEditor = this.notebookEditorProvider.editors.find(
            (editor) => editor.notebook?.identity.fsPath === notebook?.identity.fsPath
        );
        let refreshRequired = true;

        switch (payload.command) {
            case DataWranglerCommands.ExportToCsv:
                await notebook?.execute(`${currentVariableName}.to_csv("./cleaned.csv", index=False)`, '', 0, uuid());
                throw new Error('Not Implemented');
                break;

            case DataWranglerCommands.ExportToPythonScript:
                await this.generatePythonCode();
                break;

            case DataWranglerCommands.ExportToNotebook:
                await this.generateNotebook();
                break;

            case DataWranglerCommands.RenameColumn:
                historyItem = this.renameColumn(currentVariableName, payload.args as IRenameColumnsRequest);
                code = historyItem.code;
                newVariableName = historyItem.variableName;
                break;

            case DataWranglerCommands.Drop:
                historyItem = this.drop(currentVariableName, payload.args as IDropRequest);
                code = historyItem.code;
                newVariableName = historyItem.variableName;
                break;

            case DataWranglerCommands.DropDuplicates:
                historyItem = this.dropDuplicates(currentVariableName, payload.args as IDropDuplicatesRequest);
                code = historyItem.code;
                newVariableName = historyItem.variableName;
                break;

            case DataWranglerCommands.DropNa:
                historyItem = this.dropNa(currentVariableName, payload.args as IDropNaRequest);
                code = historyItem.code;
                newVariableName = historyItem.variableName;
                break;

            case DataWranglerCommands.PyplotHistogram:
                refreshRequired = false;
                code = `import matplotlib.pyplot as plt\nplt.hist(${currentVariableName}["${payload.args.target}"])\n`;
                break;

            case DataWranglerCommands.NormalizeColumn:
                historyItem = this.normalizeColumn(currentVariableName, payload.args as INormalizeColumnRequest);
                code = historyItem.code;
                newVariableName = historyItem.variableName;
                break;

            case DataWranglerCommands.FillNa:
                historyItem = this.fillNa(currentVariableName, payload.args as IFillNaRequest);
                code = historyItem.code;
                newVariableName = historyItem.variableName;
                break;

            case DataWranglerCommands.GetHistoryItem:
                this.getHistoryItem(payload.args.index).ignoreErrors();
                break;

            case DataWranglerCommands.Describe:
                void this.getColumnStats(payload.args.columnName);
                break;
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

    private renameColumn(currentVariableName: string, req: IRenameColumnsRequest): IHistoryItem {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const code = `${newVariableName} = ${currentVariableName}.rename(columns={ "${req.oldColumnName}": "${req.newColumnName}" })\n`;
        const historyItem = {
            transformation: `Renamed column "${req.oldColumnName}" to "${req.newColumnName}"`,
            variableName: newVariableName,
            code: code
        };
        this.addToHistory(historyItem);
        return historyItem;
    }

    private drop(currentVariableName: string, req: IDropRequest): IHistoryItem {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const labels = req.targets;
        if (req.mode === 'row') {
            // Drop rows by index
            const code = `df${this.variableCounter} = ${currentVariableName}.drop(${'[' + labels.join(', ') + ']'})\n`;
            const historyItem = {
                transformation: 'Dropped rows(s): ' + labels.map((label) => `${label}`).join(', '),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        } else {
            // Drop columns by column name
            const code = `df${this.variableCounter} = ${currentVariableName}.drop(columns=${
                '[' + labels.map((label) => `"${label}"`).join(', ') + ']'
            })\n`;
            const historyItem = {
                transformation: 'Dropped column(s): ' + labels.map((label) => `"${label}"`).join(', '),
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        }
    }

    private dropDuplicates(currentVariableName: string, req: IDropDuplicatesRequest): IHistoryItem {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;

        if (req.subset !== undefined) {
            // Drop duplicates in a column
            const subset = req.subset.map((col: string) => `"${col}"`).join(', ');
            const code = `${newVariableName} = ${currentVariableName}.drop_duplicates(subset=[${subset}])\n`;
            const historyItem = {
                transformation: `Removed duplicate rows on column(s): ${subset}`,
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        } else {
            // Drop duplicate rows
            const code = `${newVariableName} = ${currentVariableName}.drop_duplicates()\n`;
            const historyItem = {
                transformation: 'Removed duplicate rows',
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        }
    }

    private dropNa(currentVariableName: string, req: IDropNaRequest): IHistoryItem {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;

        if (req.subset !== undefined) {
            // This assumes only one column/row at a time
            const code = `${newVariableName} = ${currentVariableName}.dropna(subset=["${req.subset}"])\n`;
            const historyItem = {
                transformation: `Dropped rows with missing data in column: "${req.subset}"`,
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        } else {
            const code = `${newVariableName} = ${currentVariableName}.dropna(axis=${req.target})\n`;
            const historyItem = {
                transformation:
                    req.target == 0 ? 'Dropped rows with missing data' : 'Dropped columns with missing data',
                variableName: newVariableName,
                code: code
            };
            this.addToHistory(historyItem);
            return historyItem;
        }
    }

    private normalizeColumn(currentVariableName: string, req: INormalizeColumnRequest): IHistoryItem {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const code = `from sklearn.preprocessing import MinMaxScaler
scaler = MinMaxScaler(feature_range=(${req.start}, ${req.end}))
${newVariableName} = ${currentVariableName}.copy()
${newVariableName}["${req.target}"] = scaler.fit_transform(${newVariableName}["${req.target}"].values.reshape(-1, 1))\n`;
        const historyItem = {
            transformation: `Normalized column: "${req.target}"`,
            variableName: newVariableName,
            code: code
        };
        this.addToHistory(historyItem);
        return historyItem;
    }

    private fillNa(currentVariableName: string, req: IFillNaRequest): IHistoryItem {
        this.variableCounter += 1;
        const newVariableName = `df${this.variableCounter}`;
        const code = `${newVariableName} = ${currentVariableName}.fillna(${req.newValue})\n`;
        const historyItem = {
            transformation: `Replaced Na values with: "${req.newValue}"`,
            variableName: newVariableName,
            code: code
        };
        this.addToHistory(historyItem);
        return historyItem;
    }
}
