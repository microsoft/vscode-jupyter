// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { Disposable, EventEmitter, Memento, notebook as vscNotebook, NotebookCell, NotebookCellExecutionState, NotebookCellExecutionStateChangeEvent, ViewColumn } from 'vscode';

import {
    IApplicationShell,
    ICommandManager,
    IWebviewPanelProvider,
    IWorkspaceService,
    IDocumentManager
} from '../../common/application/types';
import { EXTENSION_ROOT_DIR, UseCustomEditorApi } from '../../common/constants';
import { traceError, traceInfo } from '../../common/logger';
import { GLOBAL_MEMENTO, IConfigurationService, IDisposable, IMemento, Resource } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../telemetry';
import { HelpLinks, Identifiers, Telemetry } from '../constants';
import { JupyterDataRateLimitError } from '../jupyter/jupyterDataRateLimitError';
import {
    ICodeCssGenerator,
    IInteractiveWindowProvider,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    INotebookEditorProvider,
    IThemeFinder,
    WebViewViewChangeEventArgs,
    INotebook
} from '../types';
import { WebviewPanelHost } from '../webviews/webviewPanelHost';
import { DataViewerMessageListener } from './dataViewerMessageListener';
import {
    DataViewerMessages,
    IDataFrameInfo,
    IDataViewer,
    IDataViewerDataProvider,
    IDataViewerMapping,
    IGetRowsRequest,
    IGetSliceRequest
} from './types';
import { isValidSliceExpression, preselectedSliceExpression } from '../../../datascience-ui/data-explorer/helpers';
import { addNewCellAfter, updateCellCode } from '../notebook/helpers/executionHelpers';
import { CheckboxState } from '../../telemetry/constants';

interface IHistoryItem {
    name: string;
    variableName: string;
    code: string;
}

const PREFERRED_VIEWGROUP = 'JupyterDataViewerPreferredViewColumn';
const dataExplorerDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');
@injectable()
export class DataViewer extends WebviewPanelHost<IDataViewerMapping> implements IDataViewer, IDisposable {
    private dataProvider: IDataViewerDataProvider | undefined;
    private rowsTimer: StopWatch | undefined;
    private pendingRowsCount: number = 0;
    private dataFrameInfoPromise: Promise<IDataFrameInfo> | undefined;
    private currentSliceExpression: string | undefined;
    private sentDataViewerSliceDimensionalityTelemetry = false;
    private variableCounter = 0;
    private existingDisposable: Disposable | undefined;
    private historyList: IHistoryItem[] = [];
    private sourceFile: string | undefined;

    public get visible() {
        return !!this.webPanel?.isVisible();
    }

    public get onDidDisposeDataViewer() {
        return this._onDidDisposeDataViewer.event;
    }

    public get onDidChangeDataViewerViewState() {
        return this._onDidChangeDataViewerViewState.event;
    }

    private _onDidDisposeDataViewer = new EventEmitter<IDataViewer>();
    private _onDidChangeDataViewerViewState = new EventEmitter<void>();

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
            (c, v, d) => new DataViewerMessageListener(c, v, d),
            dataExplorerDir,
            [path.join(dataExplorerDir, 'commons.initial.bundle.js'), path.join(dataExplorerDir, 'dataExplorer.js')],
            localize.DataScience.dataExplorerTitle(),
            globalMemento.get(PREFERRED_VIEWGROUP) ?? ViewColumn.One,
            useCustomEditorApi
        );
        this.onDidDispose(this.dataViewerDisposed, this);
    }

    public async showData(dataProvider: IDataViewerDataProvider, title: string): Promise<void> {
        if (!this.isDisposed) {
            // Save the data provider
            this.dataProvider = dataProvider;

            // Load the web panel using our current directory as we don't expect to load any other files
            await super.loadWebview(process.cwd()).catch(traceError);

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
            this.postMessage(DataViewerMessages.InitializeData, dataFrameInfo).ignoreErrors();
        }
    }

    private dataViewerDisposed() {
        this._onDidDisposeDataViewer.fire(this as IDataViewer);
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
        const jupyterVariableDataProvider = await this.dataProviderFactory.create(
            jupyterVariable
        );
        // Set dependencies for jupyterVariableDataProvider
        jupyterVariableDataProvider.setDependencies(jupyterVariable, notebook);
        // Get variable info
        this.dataFrameInfoPromise = jupyterVariableDataProvider.getDataFrameInfo();
        this.dataProvider = jupyterVariableDataProvider;
        const dataFrameInfo = await this.dataFrameInfoPromise;
        super.setTitle(`Data Viewer - ${newVariableName}`);

        this.postMessage(DataViewerMessages.InitializeData, dataFrameInfo).ignoreErrors();
    }

    public async getHistoryItem(index: number) {
        const variableName = this.historyList[index].variableName;

        this.updateWithNewVariable(variableName);
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
        this.postMessage(DataViewerMessages.InitializeData, dataFrameInfo).ignoreErrors();
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
        this._onDidChangeDataViewerViewState.fire();
    }

    protected get owningResource(): Resource {
        return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case DataViewerMessages.GetAllRowsRequest:
                this.getAllRows(payload as string).ignoreErrors();
                break;

            case DataViewerMessages.GetRowsRequest:
                this.getRowChunk(payload as IGetRowsRequest).ignoreErrors();
                break;

            case DataViewerMessages.GetSliceRequest:
                this.getSlice(payload as IGetSliceRequest).ignoreErrors();
                break;

            case DataViewerMessages.SubmitCommand:
                this.handleCommand(payload).ignoreErrors();
                break;

            case DataViewerMessages.RefreshDataViewer:
                this.refreshData().ignoreErrors();
                void sendTelemetryEvent(Telemetry.RefreshDataViewer);
                break;

            case DataViewerMessages.SliceEnablementStateChanged:
                void sendTelemetryEvent(Telemetry.DataViewerSliceEnablementStateChanged, undefined, {
                    newState: payload.newState ? CheckboxState.Checked : CheckboxState.Unchecked
                });
                break;

            default:
                break;
        }

        super.onMessage(message, payload);
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
        this.rowsTimer = new StopWatch();
        const output = await this.getDataFrameInfo();

        // Log telemetry about number of rows
        try {
            sendTelemetryEvent(Telemetry.ShowDataViewer, 0, {
                rows: output.rowCount ? output.rowCount : 0,
                columns: output.columns ? output.columns.length : 0
            });

            // Count number of rows to fetch so can send telemetry on how long it took.
            this.pendingRowsCount = output.rowCount ? output.rowCount : 0;
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
                this.pendingRowsCount = 0;
                return this.postMessage(DataViewerMessages.GetAllRowsResponse, allRows);
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
                sendTelemetryEvent(Telemetry.DataViewerSliceOperation, undefined, { source: request.source });
                return this.postMessage(DataViewerMessages.InitializeData, payload);
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
                return this.postMessage(DataViewerMessages.GetRowsResponse, {
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
            this.sendElapsedTimeTelemetry();
        }
    }

    private sendElapsedTimeTelemetry() {
        if (this.rowsTimer && this.pendingRowsCount === 0) {
            sendTelemetryEvent(Telemetry.ShowDataViewer, this.rowsTimer.elapsedTime);
        }
    }

    private addToHistory(transformation: string, variableName: string, code: string) {
        const newHistItem = {
            name: transformation,
            variableName: variableName,
            code: code
        }
        this.historyList.push(newHistItem);
        this.postMessage(DataViewerMessages.UpdateHistoryList, this.historyList).ignoreErrors();
    }

    private async generatePythonCode(notebook: INotebook | undefined) {
        var dataCleanCode = this.historyList.map(function (item) {
            return item.code;
        }).join("\n");

        dataCleanCode = 'import pandas as pd\n\ndf = pd.read_csv(r\'' + this.sourceFile + '\')\n' + dataCleanCode;

        const doc = await this.documentManager.openTextDocument({
            language: 'python',
            content: dataCleanCode
        });

        await this.documentManager.showTextDocument(doc, 1, true);
    }

    private async getColumnStats(columnName: string) {
        if (this.dataProvider) {
            const columnData = await this.dataProvider.getCols(columnName);
            this.postMessage(DataViewerMessages.GetHistogramResponse, { cols: columnData, columnName: columnName });
        }
    }

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
                await this.generatePythonCode(notebook);
                break;
            case 'rename':
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                code = `${newVariableName} = ${currentVariableName}.rename(columns={ "${payload.args.old}": "${payload.args.new}" })`;
                this.addToHistory(`Renamed column "${payload.args.old}" to "${payload.args.new}"`, newVariableName, code);
                break;
            case 'drop':
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                const labels = payload.args.targets as string[];
                if (payload.args.mode === 'row') {
                    // Drop rows by index
                    code = `df${this.variableCounter} = ${currentVariableName}.drop(${'[' + labels.join(', ') + ']'})`;
                    this.addToHistory("Dropped rows(s): " + labels.map((label) => `${label}`).join(','), newVariableName, code);
                } else {
                    // Drop columns by column name
                    code = `df${this.variableCounter} = ${currentVariableName}.drop(columns=${'[' + labels.map((label) => `"${label}"`).join(', ') + ']'})`;
                    this.addToHistory("Dropped column(s): " + labels.map((label) => `"${label}"`).join(','), newVariableName, code);
                }
                break;
            case 'dropna':
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                if (payload.args.subset !== undefined) {
                    // This assumes only one column/row at a time
                    code = `${newVariableName} = ${currentVariableName}.dropna(subset=["${payload.args.subset}"])`;
                    this.addToHistory(`Dropped rows with missing data in column: "${payload.args.subset}"`, newVariableName, code);
                } else {
                    code = `${newVariableName} = ${currentVariableName}.dropna(axis=${payload.args.target})`;
                    this.addToHistory(payload.args.target == 0 ? "Dropped rows with missing data" : "Dropped columns with missing data", newVariableName, code);
                }
                break;
            case 'pyplot.hist':
                refreshRequired = false;
                code = `import matplotlib.pyplot as plt\nplt.hist(${currentVariableName}["${payload.args.target}"])`;
                break;
            case 'normalize':
                const { start, end, target } = payload.args;
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                code = `from sklearn.preprocessing import MinMaxScaler
scaler = MinMaxScaler(feature_range=(${start}, ${end}))
${newVariableName} = ${currentVariableName}.copy()
${newVariableName}["${target}"] = scaler.fit_transform(${newVariableName}["${target}"].values.reshape(-1, 1))`;
                this.addToHistory(`Normalized column: "${target}"`, newVariableName, code);
                break;
            case 'fillna':
                const { newValue } = payload.args;
                this.variableCounter += 1;
                newVariableName = `df${this.variableCounter}`;
                code = `${newVariableName} = ${currentVariableName}.fillna(${newValue})`;
                break;
            case DataViewerMessages.GetHistoryItem:
                this.getHistoryItem(payload.args.index).ignoreErrors();
                break;
            case 'describe':
                this.getColumnStats(payload.args.columnName);
                break;
        }
        const dataCleaningMode = this.configService.getSettings().dataCleaningMode;
        if (dataCleaningMode === 'standalone') {
            if (code && notebook !== undefined) {
                notebook?.execute(code, '', 0, uuid()).then(async () => {
                    if (this.existingDisposable) {
                        this.existingDisposable.dispose();
                    }
                    await this.updateWithNewVariable(newVariableName)
                });
            }
        } else if (dataCleaningMode === 'jupyter_notebook') {
            if (code && matchingNotebookEditor !== undefined) {
                const cells = (matchingNotebookEditor as any).document.getCells();
                const lastCell = cells[cells.length - 1] as NotebookCell;
                await updateCellCode(lastCell, code);
                await addNewCellAfter(lastCell, '');
                if (this.existingDisposable) {
                    this.existingDisposable.dispose();
                }
                this.existingDisposable = vscNotebook.onDidChangeCellExecutionState(async (e: NotebookCellExecutionStateChangeEvent) => {
                    if (e.executionState === NotebookCellExecutionState.Idle && refreshRequired) {
                        await this.updateWithNewVariable(newVariableName);
                    };
                });
                await this.commandManager.executeCommand('notebook.cell.executeAndSelectBelow')
            }
        }
    }
    private maybeSendSliceDataDimensionalityTelemetry(numberOfDimensions: number) {
        if (!this.sentDataViewerSliceDimensionalityTelemetry) {
            sendTelemetryEvent(Telemetry.DataViewerDataDimensionality, undefined, { numberOfDimensions });
            this.sentDataViewerSliceDimensionalityTelemetry = true;
        }
    }
}
