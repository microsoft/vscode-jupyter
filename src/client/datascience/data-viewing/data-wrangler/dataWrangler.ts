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
    IInteractiveWindowProvider,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory,
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
import { IDataWranglerMapping, IDataWrangler, IDataWranglerDataProvider, DataWranglerMessages } from './types';

interface IHistoryItem {
    name: string;
    variableName: string;
    code: string;
}

const PREFERRED_VIEWGROUP = 'JupyterDataWranglerPreferredViewColumn';
const dataWranglerDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');
@injectable()
export class DataWrangler extends WebviewPanelHost<IDataWranglerMapping> implements IDataWrangler, IDisposable {
    private dataProvider: IDataWranglerDataProvider | undefined;
    // private rowsTimer: StopWatch | undefined;
    // private pendingRowsCount: number = 0;
    private dataFrameInfoPromise: Promise<IDataFrameInfo> | undefined;
    private currentSliceExpression: string | undefined;
    // private sentDataWranglerSliceDimensionalityTelemetry = false;
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
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager,
        @inject(IJupyterVariables)
        @named(Identifiers.KERNEL_VARIABLES)
        private kernelVariableProvider: IJupyterVariables,
        @inject(IJupyterVariableDataProviderFactory) private dataProviderFactory: IJupyterVariableDataProviderFactory,
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

            let dataFrameInfo = await this.prepDataFrameInfo();
            this.sourceFile = dataFrameInfo.sourceFile;

            // If higher dimensional data, preselect a slice to show
            if (dataFrameInfo.shape && dataFrameInfo.shape.length > 2) {
                this.maybeSendSliceDataDimensionalityTelemetry(dataFrameInfo.shape.length);
                const slice = preselectedSliceExpression(dataFrameInfo.shape);
                dataFrameInfo = await this.getDataFrameInfo(slice);
            }

            // Send a message with our data
            this.postMessage(DataWranglerMessages.InitializeData, dataFrameInfo).ignoreErrors();

            this.historyList.push({
                name: 'Imported data',
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

            case DataWranglerMessages.SliceEnablementStateChanged:
                // TODOV Telemetry
                // void sendTelemetryEvent(Telemetry.DataWranglerSliceEnablementStateChanged, undefined, {
                //     newState: payload.newState ? CheckboxState.Checked : CheckboxState.Unchecked
                // });
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

    private async requestTmLanguage(languageId: string = 'python') {
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

    private async prepDataFrameInfo(): Promise<IDataFrameInfo> {
        // this.rowsTimer = new StopWatch();
        const output = await this.getDataFrameInfo();

        // Log telemetry about number of rows
        try {
            // TODOV Telemetry
            // sendTelemetryEvent(Telemetry.ShowDataWrangler, 0, {
            //     rows: output.rowCount ? output.rowCount : 0,
            //     columns: output.columns ? output.columns.length : 0
            // });
            // Count number of rows to fetch so can send telemetry on how long it took.
            // this.pendingRowsCount = output.rowCount ? output.rowCount : 0;
        } catch {
            noop();
        }

        return output;
    }

    // Deprecate this
    private async getAllRows(sliceExpression?: string) {
        return this.wrapRequest(async () => {
            if (this.dataProvider) {
                const allRows = await this.dataProvider.getAllRows(sliceExpression);
                // this.pendingRowsCount = 0;
                return this.postMessage(DataWranglerMessages.GetAllRowsResponse, allRows);
            }
        });
    }

    private getSlice(request: IGetSliceRequest) {
        return this.wrapRequest(async () => {
            if (this.dataProvider) {
                const payload = await this.getDataFrameInfo(request.slice);
                if (payload.shape?.length) {
                    this.maybeSendSliceDataDimensionalityTelemetry(payload.shape.length);
                }
                // sendTelemetryEvent(Telemetry.DataWranglerSliceOperation, undefined, { source: request.source });
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
        } finally {
            // TODOV Telemetry
            // this.sendElapsedTimeTelemetry();
        }
    }

    // TODOV Telemetry
    // private sendElapsedTimeTelemetry() {
    //     if (this.rowsTimer && this.pendingRowsCount === 0) {
    //         sendTelemetryEvent(Telemetry.ShowDataWrangler, this.rowsTimer.elapsedTime);
    //     }
    // }

    private addToHistory(transformation: string, variableName: string, code: string) {
        const newHistItem = {
            name: transformation,
            variableName: variableName,
            code: code
        };
        this.historyList.push(newHistItem);
        this.postMessage(DataWranglerMessages.UpdateHistoryList, this.historyList).ignoreErrors();
    }

    private getCode() {
        return this.historyList
            .map(function (item) {
                return item.code;
            })
            .join('\n');
    }

    private getImportCode() {
        return "import pandas as pd\ndf = pd.read_csv(r'" + this.sourceFile + "')\n";
    }

    private async generatePythonCode() {
        var dataCleanCode = this.getCode();

        const doc = await this.documentManager.openTextDocument({
            language: 'python',
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
        const notebook = (this.dataProvider as IJupyterVariableDataProvider).notebook;
        let code = '';
        const currentVariableName = (await this.dataFrameInfoPromise)!.name;
        let newVariableName = currentVariableName ?? '';
        const matchingNotebookEditor = this.notebookEditorProvider.editors.find(
            (editor) => editor.notebook?.identity.fsPath === notebook?.identity.fsPath
        );
        let refreshRequired = true;
        switch (payload.command) {
            case 'open_interactive_window':
                await this.interactiveWindowProvider.getOrCreate(notebook?.resource, notebook);
                break;
            case 'export_to_csv':
                await notebook?.execute(`${currentVariableName}.to_csv("./cleaned.csv", index=False)`, '', 0, uuid());
                break;
            case 'export_to_python_script':
                await this.generatePythonCode();
                break;
            case 'export_to_notebook':
                await this.generateNotebook();
                break;
            case 'rename':
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                code = `${newVariableName} = ${currentVariableName}.rename(columns={ "${payload.args.old}": "${payload.args.new}" })\n`;
                this.addToHistory(
                    `Renamed column "${payload.args.old}" to "${payload.args.new}"`,
                    newVariableName,
                    code
                );
                break;
            case 'drop':
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                const labels = payload.args.targets as string[];
                if (payload.args.mode === 'row') {
                    // Drop rows by index
                    code = `df${this.variableCounter} = ${currentVariableName}.drop(${
                        '[' + labels.join(', ') + ']'
                    })\n`;
                    this.addToHistory(
                        'Dropped rows(s): ' + labels.map((label) => `${label}`).join(','),
                        newVariableName,
                        code
                    );
                } else {
                    // Drop columns by column name
                    code = `df${this.variableCounter} = ${currentVariableName}.drop(columns=${
                        '[' + labels.map((label) => `"${label}"`).join(', ') + ']'
                    })\n`;
                    this.addToHistory(
                        'Dropped column(s): ' + labels.map((label) => `"${label}"`).join(','),
                        newVariableName,
                        code
                    );
                }
                break;
            case 'drop_duplicates':
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                if (payload.args?.subset !== undefined) {
                    const subset = payload.args.subset.map((col: string) => `"${col}"`).join(', ');
                    code = `${newVariableName} = ${currentVariableName}.drop_duplicates(subset=[${subset}])\n`;
                    this.addToHistory(`Removed duplicate rows on column(s): ${subset}`, newVariableName, code);
                } else {
                    code = `${newVariableName} = ${currentVariableName}.drop_duplicates()\n`;
                    this.addToHistory('Removed duplicate rows', newVariableName, code);
                }
                break;
            case 'dropna':
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                if (payload.args.subset !== undefined) {
                    // This assumes only one column/row at a time
                    code = `${newVariableName} = ${currentVariableName}.dropna(subset=["${payload.args.subset}"])\n`;
                    this.addToHistory(
                        `Dropped rows with missing data in column: "${payload.args.subset}"`,
                        newVariableName,
                        code
                    );
                } else {
                    code = `${newVariableName} = ${currentVariableName}.dropna(axis=${payload.args.target})\n`;
                    this.addToHistory(
                        payload.args.target == 0
                            ? 'Dropped rows with missing data'
                            : 'Dropped columns with missing data',
                        newVariableName,
                        code
                    );
                }
                break;
            case 'pyplot.hist':
                refreshRequired = false;
                code = `import matplotlib.pyplot as plt\nplt.hist(${currentVariableName}["${payload.args.target}"])\n`;
                break;
            case 'normalize':
                const { start, end, target } = payload.args;
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                code = `from sklearn.preprocessing import MinMaxScaler
scaler = MinMaxScaler(feature_range=(${start}, ${end}))
${newVariableName} = ${currentVariableName}.copy()
${newVariableName}["${target}"] = scaler.fit_transform(${newVariableName}["${target}"].values.reshape(-1, 1))\n`;
                this.addToHistory(`Normalized column: "${target}"`, newVariableName, code);
                break;
            case 'fillna':
                const { newValue } = payload.args;
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                code = `${newVariableName} = ${currentVariableName}.fillna(${newValue})\n`;
                break;
            case DataWranglerMessages.GetHistoryItem:
                this.getHistoryItem(payload.args.index).ignoreErrors();
                break;
            case 'describe':
                void this.getColumnStats(payload.args.columnName);
                break;
        }
        const dataCleaningMode = this.configService.getSettings().dataCleaningMode;
        if (dataCleaningMode === 'standalone') {
            if (code && notebook !== undefined) {
                void notebook?.execute(code, '', 0, uuid()).then(async () => {
                    if (this.existingDisposable) {
                        this.existingDisposable.dispose();
                    }
                    await this.updateWithNewVariable(newVariableName);
                });
            }
        } else if (dataCleaningMode === 'jupyter_notebook') {
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

    private maybeSendSliceDataDimensionalityTelemetry(numberOfDimensions: number) {
        // TODOV Telemetry
        // if (!this.sentDataWranglerSliceDimensionalityTelemetry) {
        //     sendTelemetryEvent(Telemetry.DataWranglerDataDimensionality, undefined, { numberOfDimensions });
        //     this.sentDataWranglerSliceDimensionalityTelemetry = true;
        // }
        numberOfDimensions;
        return;
    }
}
