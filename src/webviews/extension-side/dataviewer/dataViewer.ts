// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import '../../../platform/common/extensions';

import { inject, injectable, named } from 'inversify';
import { EventEmitter, Memento, Uri, ViewColumn } from 'vscode';

import { capturePerfTelemetry, sendTelemetryEvent } from '../../../telemetry';
import { JupyterDataRateLimitError } from '../../../platform/errors/jupyterDataRateLimitError';
import { DataViewerMessageListener } from './dataViewerMessageListener';
import {
    DataViewerMessages,
    IDataFrameInfo,
    IDataViewer,
    IDataViewerDataProvider,
    IDataViewerMapping,
    IGetRowsRequest,
    IGetSliceRequest,
    IJupyterVariableDataProvider
} from './types';
import { isValidSliceExpression, preselectedSliceExpression } from '../../webview-side/data-explorer/helpers';
import { CheckboxState } from '../../../platform/telemetry/constants';
import { IKernel } from '../../../kernels/types';
import {
    IWebviewPanelProvider,
    IWorkspaceService,
    IApplicationShell
} from '../../../platform/common/application/types';
import { HelpLinks, Telemetry } from '../../../platform/common/constants';
import { traceError, traceInfo } from '../../../platform/logging';
import {
    IConfigurationService,
    IMemento,
    GLOBAL_MEMENTO,
    Resource,
    IDisposable,
    IExtensionContext
} from '../../../platform/common/types';
import * as localize from '../../../platform/common/utils/localize';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import { WebViewViewChangeEventArgs } from '../../../platform/webviews/types';
import { WebviewPanelHost } from '../../../platform/webviews/webviewPanelHost';
import { noop } from '../../../platform/common/utils/misc';
import { joinPath } from '../../../platform/vscode-path/resources';
import { IDataScienceErrorHandler } from '../../../kernels/errors/types';

const PREFERRED_VIEWGROUP = 'JupyterDataViewerPreferredViewColumn';
@injectable()
export class DataViewer extends WebviewPanelHost<IDataViewerMapping> implements IDataViewer, IDisposable {
    private dataProvider: IDataViewerDataProvider | IJupyterVariableDataProvider | undefined;
    private rowsTimer: StopWatch | undefined;
    private pendingRowsCount: number = 0;
    private dataFrameInfoPromise: Promise<IDataFrameInfo> | undefined;
    private currentSliceExpression: string | undefined;
    private sentDataViewerSliceDimensionalityTelemetry = false;

    public get active() {
        return !!this.webPanel?.isActive();
    }

    public get refreshPending() {
        return this.pendingRowsCount > 0;
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
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IMemento) @named(GLOBAL_MEMENTO) readonly globalMemento: Memento,
        @inject(IDataScienceErrorHandler) readonly errorHandler: IDataScienceErrorHandler,
        @inject(IExtensionContext) readonly context: IExtensionContext
    ) {
        const dataExplorerDir = joinPath(context.extensionUri, 'out', 'webviews', 'webview-side', 'viewers');
        super(
            configuration,
            provider,
            workspaceService,
            (c, v, d) => new DataViewerMessageListener(c, v, d),
            dataExplorerDir,
            [joinPath(dataExplorerDir, 'dataExplorer.js')],
            localize.DataScience.dataExplorerTitle,
            globalMemento.get(PREFERRED_VIEWGROUP) ?? ViewColumn.One
        );
        this.onDidDispose(this.dataViewerDisposed, this);
    }

    @capturePerfTelemetry(Telemetry.DataViewerWebviewLoaded)
    public async showData(
        dataProvider: IDataViewerDataProvider | IJupyterVariableDataProvider,
        title: string
    ): Promise<void> {
        if (!this.isDisposed) {
            // Save the data provider
            this.dataProvider = dataProvider;

            // Load the web panel using our current directory as we don't expect to load any other files
            await super.loadWebview(Uri.file(process.cwd())).catch(traceError);

            super.setTitle(title);

            // Then show our web panel. Eventually we need to consume the data
            await super.show(true);

            let dataFrameInfo = await this.prepDataFrameInfo();

            // If higher dimensional data, preselect a slice to show
            if (dataFrameInfo.shape && dataFrameInfo.shape.length > 2) {
                this.maybeSendSliceDataDimensionalityTelemetry(dataFrameInfo.shape.length);
                const slice = preselectedSliceExpression(dataFrameInfo.shape);
                dataFrameInfo = await this.getDataFrameInfo(slice);
            }

            // Send a message with our data
            this.postMessage(DataViewerMessages.InitializeData, dataFrameInfo).catch(noop);
        }
    }

    public get kernel(): IKernel | undefined {
        if (this.dataProvider && 'kernel' in this.dataProvider) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return this.dataProvider.kernel;
        }
    }

    private dataViewerDisposed() {
        this._onDidDisposeDataViewer.fire(this as IDataViewer);
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
        this.postMessage(DataViewerMessages.InitializeData, dataFrameInfo).catch(noop);
    }

    public override dispose(): void {
        super.dispose();

        if (this.dataProvider) {
            // Call dispose on the data provider
            this.dataProvider.dispose();
            this.dataProvider = undefined;
        }
    }

    protected override async onViewStateChanged(args: WebViewViewChangeEventArgs) {
        if (args.current.active && args.current.visible && args.previous.active && args.current.visible) {
            await this.globalMemento.update(PREFERRED_VIEWGROUP, this.webPanel?.viewColumn);
        }
        this._onDidChangeDataViewerViewState.fire();
    }

    protected get owningResource(): Resource {
        return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected override onMessage(message: string, payload: any) {
        switch (message) {
            case DataViewerMessages.GetAllRowsRequest:
                this.getAllRows(payload as string).catch(noop);
                break;

            case DataViewerMessages.GetRowsRequest:
                this.getRowChunk(payload as IGetRowsRequest).catch(noop);
                break;

            case DataViewerMessages.GetSliceRequest:
                this.getSlice(payload as IGetSliceRequest).catch(noop);
                break;

            case DataViewerMessages.RefreshDataViewer:
                this.refreshData().catch(noop);
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
            sendTelemetryEvent(Telemetry.ShowDataViewer, undefined, {
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
                this.pendingRowsCount = Math.max(0, this.pendingRowsCount - rows.length);
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
                traceError(e.message);
                const actionTitle = localize.DataScience.pythonInteractiveHelpLink;
                this.applicationShell
                    .showErrorMessage(localize.DataScience.jupyterDataRateExceeded, actionTitle)
                    .then((v) => {
                        // User clicked on the link, open it.
                        if (v === actionTitle) {
                            this.applicationShell.openUrl(HelpLinks.JupyterDataRateHelpLink);
                        }
                    }, noop);
                this.dispose();
            }
            traceError(e);
            this.errorHandler.handleError(e).then(noop, noop);
        } finally {
            this.sendElapsedTimeTelemetry();
        }
    }

    private sendElapsedTimeTelemetry() {
        if (this.rowsTimer && this.pendingRowsCount === 0) {
            sendTelemetryEvent(Telemetry.ShowDataViewerRowsLoaded, undefined, {
                rowsTimer: this.rowsTimer.elapsedTime
            });
        }
    }

    private maybeSendSliceDataDimensionalityTelemetry(numberOfDimensions: number) {
        if (!this.sentDataViewerSliceDimensionalityTelemetry) {
            sendTelemetryEvent(Telemetry.DataViewerDataDimensionality, { numberOfDimensions });
            this.sentDataViewerSliceDimensionalityTelemetry = true;
        }
    }
}
