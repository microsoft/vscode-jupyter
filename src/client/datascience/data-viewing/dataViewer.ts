// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import { EventEmitter, Memento, ViewColumn } from 'vscode';

import { IApplicationShell, IWebviewPanelProvider, IWorkspaceService } from '../../common/application/types';
import { EXTENSION_ROOT_DIR, UseCustomEditorApi } from '../../common/constants';
import { traceError, traceInfo } from '../../common/logger';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposable,
    IExperimentService,
    IMemento,
    Resource
} from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../telemetry';
import { HelpLinks, Telemetry } from '../constants';
import { JupyterDataRateLimitError } from '../jupyter/jupyterDataRateLimitError';
import { ICodeCssGenerator, IThemeFinder, WebViewViewChangeEventArgs } from '../types';
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
import { Experiments } from '../../common/experiments/groups';
import { isValidSliceExpression, preselectedSliceExpression } from '../../../datascience-ui/data-explorer/helpers';

const PREFERRED_VIEWGROUP = 'JupyterDataViewerPreferredViewColumn';
const dataExplorerDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');
@injectable()
export class DataViewer extends WebviewPanelHost<IDataViewerMapping> implements IDataViewer, IDisposable {
    private dataProvider: IDataViewerDataProvider | undefined;
    private rowsTimer: StopWatch | undefined;
    private pendingRowsCount: number = 0;
    private dataFrameInfoPromise: Promise<IDataFrameInfo> | undefined;
    private currentSliceExpression: string | undefined;

    public get active() {
        return !!this.webPanel?.isActive();
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
        @inject(IExperimentService) private experimentService: IExperimentService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) readonly globalMemento: Memento
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
            if (dataFrameInfo.shape && dataFrameInfo.shape.length > 2) {
                const slice = preselectedSliceExpression(dataFrameInfo.shape);
                dataFrameInfo = await this.getDataFrameInfo(slice);
            }

            const isSliceDataEnabled = await this.experimentService.inExperiment(Experiments.SliceDataViewer);

            // Send a message with our data
            this.postMessage(DataViewerMessages.InitializeData, {
                ...dataFrameInfo,
                isSliceDataEnabled
            }).ignoreErrors();
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
        const isSliceDataEnabled = await this.experimentService.inExperiment(Experiments.SliceDataViewer);
        // Send a message with our data
        this.postMessage(DataViewerMessages.InitializeData, {
            ...dataFrameInfo,
            isSliceDataEnabled
        }).ignoreErrors();
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
                return this.postMessage(DataViewerMessages.InitializeData, { ...payload, isSliceDataEnabled: true });
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
}
