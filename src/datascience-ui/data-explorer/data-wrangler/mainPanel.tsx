// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import './mainPanel.css';

import { JSONArray } from '@phosphor/coreutils';
import * as React from 'react';

import {
    CellFetchAllLimit,
    CellFetchSizeFirst,
    CellFetchSizeSubsequent,
    ColumnType,
    IDataFrameInfo,
    IGetColsResponse,
    IGetRowsResponse,
    IGetSliceRequest,
    IRowsResponse
} from '../../../client/datascience/data-viewing/types';
import { CssMessages, SharedMessages } from '../../../client/datascience/messages';
import { IJupyterExtraSettings } from '../../../client/datascience/types';
import { getLocString, storeLocStrings } from '../../react-common/locReactSide';
import { IMessageHandler, PostOffice } from '../../react-common/postOffice';
import { Progress } from '../../react-common/progress';
import { StyleInjector } from '../../react-common/styleInjector';
import { cellFormatterFunc } from '../cellFormatter';
import { ReactSlickGrid } from './reactSlickGrid';
import { generateTestData } from '../testData';

import '../../react-common/codicon/codicon.css';
import '../../react-common/seti/seti.less';
import { SliceControl } from '../sliceControl';
import { debounce } from 'lodash';

import { initializeIcons } from '@fluentui/react';
import { Toolbar } from './controls/toolbar';
import { InteractiveWindowMessages } from '../../../client/datascience/interactive-common/interactiveWindowTypes';
import { deserializeLanguageConfiguration } from '../../../client/datascience/interactive-common/serialization';
import { Tokenizer } from '../../interactive-common/tokenizer';
import { createDeferred } from '../../../client/common/utils/async';
import { DataWranglerMessages, IDataWranglerMapping } from '../../../client/datascience/data-viewing/data-wrangler/types';
import { ISlickGridAdd, ISlickGridSlice, ISlickRow } from '../reactSlickGrid';
initializeIcons(); // Register all FluentUI icons being used to prevent developer console errors

const SliceableTypes: Set<string> = new Set<string>(['ndarray', 'Tensor', 'EagerTensor', 'DataArray']);
const RowNumberColumnName = 'No.'; // Unique key for our column containing row numbers
const onigasmPromise = createDeferred<boolean>();
const monacoPromise = createDeferred();

// Our css has to come after in order to override body styles
export interface IMainPanelProps {
    skipDefault?: boolean;
    baseTheme: string;
    testMode?: boolean;
}

interface IMainPanelState {
    gridColumns: Slick.Column<Slick.SlickData>[];
    gridRows: ISlickRow[];
    fetchedRowCount: number;
    totalRowCount: number;
    filters: {};
    indexColumn: string;
    styleReady: boolean;
    settings?: IJupyterExtraSettings;
    dataDimensionality: number;
    originalVariableShape?: number[];
    originalVariableType?: string;
    isSliceDataEnabled: boolean;
    maximumRowChunkSize?: number;
    variableName?: string;
    fileName?: string;
    sliceExpression?: string;
    historyList: [];
    histogramData?: IGetColsResponse;
    monacoTheme: string;
}

export class MainPanel extends React.Component<IMainPanelProps, IMainPanelState> implements IMessageHandler {
    private container: React.Ref<HTMLDivElement> = React.createRef<HTMLDivElement>();
    private sentDone = false;
    private postOffice: PostOffice = new PostOffice();
    private toggleFilterEvent: Slick.Event<void> = new Slick.Event<void>();
    private resetGridEvent: Slick.Event<ISlickGridSlice> = new Slick.Event<ISlickGridSlice>();
    private resizeGridEvent: Slick.Event<void> = new Slick.Event<void>();
    private gridAddEvent: Slick.Event<ISlickGridAdd> = new Slick.Event<ISlickGridAdd>();
    private gridColumnUpdateEvent: Slick.Event<Slick.Column<Slick.SlickData>[]> = new Slick.Event<
        Slick.Column<Slick.SlickData>[]
    >();
    private rowFetchSizeFirst: number = 0;
    private rowFetchSizeSubsequent: number = 0;
    private rowFetchSizeAll: number = 0;
    // Just used for testing.
    private grid: React.RefObject<ReactSlickGrid> = React.createRef<ReactSlickGrid>();
    private updateTimeout?: NodeJS.Timer | number;
    private columnsContainingInfOrNaN = new Set<string>();
    private lastDescribeRequestColumnName: string | undefined;

    // eslint-disable-next-line
    constructor(props: IMainPanelProps, _state: IMainPanelState) {
        super(props);

        if (!this.props.skipDefault) {
            const data = generateTestData(5000);
            this.state = {
                gridColumns: data.columns.map((c) => {
                    return { ...c, formatter: cellFormatterFunc };
                }),
                gridRows: [],
                totalRowCount: data.rows.length,
                fetchedRowCount: -1,
                filters: {},
                indexColumn: data.primaryKeys[0],
                styleReady: false,
                dataDimensionality: data.dataDimensionality ?? 2,
                originalVariableShape: data.originalVariableShape,
                isSliceDataEnabled: false,
                originalVariableType: undefined,
                historyList: [],
                histogramData: undefined,
                monacoTheme: 'vs-dark'
            };

            // Fire off a timer to mimic dynamic loading
            setTimeout(() => this.handleGetAllRowsResponse(data.rows), 1000);
        } else {
            this.state = {
                gridColumns: [],
                gridRows: [],
                totalRowCount: 0,
                fetchedRowCount: -1,
                filters: {},
                indexColumn: 'index',
                styleReady: false,
                dataDimensionality: 2,
                originalVariableShape: undefined,
                isSliceDataEnabled: false,
                originalVariableType: undefined,
                historyList: [],
                histogramData: undefined,
                monacoTheme: 'vs-dark'
            };
        }
    }

    public async componentWillMount() {
        // Add ourselves as a handler for the post office
        this.postOffice.addHandler(this);

        // Tell the dataviewer code we have started.
        this.postOffice.sendMessage<IDataWranglerMapping>(InteractiveWindowMessages.LoadOnigasmAssemblyRequest);
        this.postOffice.sendMessage<IDataWranglerMapping>(InteractiveWindowMessages.LoadTmLanguageRequest);
        this.postOffice.sendMessage<IDataWranglerMapping>(CssMessages.GetMonacoThemeRequest, {
            isDark: this.props.baseTheme !== 'vscode-light'
        });
        // await monacoPromise.promise;
        this.postOffice.sendMessage<IDataWranglerMapping>(DataWranglerMessages.Started);
    }

    public componentWillUnmount() {
        this.postOffice.removeHandler(this);
        this.postOffice.dispose();
    }

    public render = () => {
        if (!this.state.settings) {
            return <div className="main-panel" />;
        }

        // Send our done message if we haven't yet and we just reached full capacity. Do it here so we
        // can guarantee our render will run before somebody checks our rendered output.
        if (this.state.totalRowCount && this.state.totalRowCount === this.state.fetchedRowCount && !this.sentDone) {
            this.sentDone = true;
            this.sendMessage(DataWranglerMessages.CompletedData);
        }

        const progressBar = this.state.totalRowCount > this.state.fetchedRowCount ? <Progress /> : undefined;

        return (
            <div className="main-panel" ref={this.container}>
                <StyleInjector
                    onReady={this.saveReadyState}
                    settings={this.state.settings}
                    expectingDark={this.props.baseTheme !== 'vscode-light'}
                    postOffice={this.postOffice}
                />
                {progressBar}
                {/* {this.renderBreadcrumb()} */}
                <Toolbar
                    handleRefreshRequest={this.handleRefreshRequest}
                    submitCommand={this.submitCommand}
                    onToggleFilter={() => this.toggleFilterEvent.notify()}
                />
                {this.renderSliceControls()}
                {this.state.styleReady && this.renderGrid()}
            </div>
        );
    };

    public renderSliceControls = () => {
        if (
            this.state.isSliceDataEnabled &&
            this.state.originalVariableShape &&
            this.state.originalVariableShape.filter((v) => !!v).length > 1
        ) {
            return (
                <SliceControl
                    sliceExpression={this.state.sliceExpression}
                    loadingData={this.state.totalRowCount > this.state.fetchedRowCount}
                    originalVariableShape={this.state.originalVariableShape}
                    handleSliceRequest={this.handleSliceRequest}
                    onCheckboxToggled={this.handleCheckboxToggle}
                    onPanelToggled={() => this.resizeGridEvent.notify()}
                />
            );
        }
    };

    // private renderBreadcrumb() {
    //     let breadcrumbText = this.state.variableName;
    //     if (this.state.originalVariableShape) {
    //         breadcrumbText += ' (' + this.state.originalVariableShape?.join(', ') + ')';
    //     }
    //     if (breadcrumbText) {
    //         return (
    //             <div className="breadcrumb-container control-container">
    //                 <div className="breadcrumb">
    //                     <div className="icon-python breadcrumb-file-icon" />
    //                     <span>{this.state.fileName}</span>
    //                     {this.state.fileName ? (
    //                         <div className="codicon codicon-chevron-right breadcrumb-codicon" />
    //                     ) : undefined}
    //                     <span>{breadcrumbText}</span>
    //                 </div>
    //             </div>
    //         );
    //     }
    // }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public handleMessage = (msg: string, payload?: any) => {
        switch (msg) {
            case DataWranglerMessages.InitializeData:
                this.initializeData(payload);
                break;

            case DataWranglerMessages.GetAllRowsResponse:
                this.handleGetAllRowsResponse(payload as IRowsResponse);
                break;

            case DataWranglerMessages.GetRowsResponse:
                this.handleGetRowChunkResponse(payload as IGetRowsResponse);
                break;

            case DataWranglerMessages.GetHistogramResponse:
                this.handleGetHistogram(payload);
                break;

            case DataWranglerMessages.UpdateHistoryList:
                this.handleUpdateHistoryList(payload);
                break;

            case SharedMessages.UpdateSettings:
                this.updateSettings(payload);
                break;

            case SharedMessages.LocInit:
                this.initializeLoc(payload);
                break;

            case InteractiveWindowMessages.LoadOnigasmAssemblyResponse:
                if (!Tokenizer.hasOnigasm()) {
                    console.log('No onigasm', payload);
                    // Have to convert the buffer into an ArrayBuffer for the tokenizer to load it.
                    let typedArray = new Uint8Array(payload.data);
                    if (typedArray.length <= 0 && payload.data) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        typedArray = new Uint8Array(payload.data as any);
                    }
                    Tokenizer.loadOnigasm(typedArray.buffer);
                    onigasmPromise.resolve(payload.data ? true : false);
                } else {
                    console.log('Has onigasm');
                }
                break;

            case InteractiveWindowMessages.LoadTmLanguageResponse:
                void onigasmPromise.promise.then(async (success) => {
                    console.log('tmLanguage success:', success);
                    console.log('payload', payload);
                    // Then load the language data
                    if (success && !Tokenizer.hasLanguage(payload.languageId)) {
                        await Tokenizer.loadLanguage(
                            payload.languageId,
                            payload.extensions,
                            payload.scopeName,
                            deserializeLanguageConfiguration(payload.languageConfiguration),
                            payload.languageJSON
                        );
                        monacoPromise.resolve();
                    }
                });
                break;

            case CssMessages.GetMonacoThemeResponse:
                console.log('Theme response payload', payload);
                this.setState({ monacoTheme: payload.theme });
                break;

            default:
                break;
        }

        return false;
    };

    private initializeLoc(content: string) {
        const locJSON = JSON.parse(content);
        storeLocStrings(locJSON);
    }

    private updateSettings(content: string) {
        const newSettingsJSON = JSON.parse(content);
        const newSettings = newSettingsJSON as IJupyterExtraSettings;
        this.setState({
            settings: newSettings
        });
    }

    private saveReadyState = () => {
        this.setState({ styleReady: true });
    };

    private renderGrid() {
        const filterRowsTooltip = getLocString('DataScience.filterRowsTooltip', 'Click to filter');
        return (
            <ReactSlickGrid
                ref={this.grid}
                columns={this.state.gridColumns}
                idProperty={RowNumberColumnName}
                rowsAdded={this.gridAddEvent}
                resetGridEvent={this.resetGridEvent}
                toggleFilterEvent={this.toggleFilterEvent}
                resizeGridEvent={this.resizeGridEvent}
                columnsUpdated={this.gridColumnUpdateEvent}
                filterRowsTooltip={filterRowsTooltip}
                forceHeight={this.props.testMode ? 200 : undefined}
                dataDimensionality={this.state.dataDimensionality}
                monacoTheme={this.state.monacoTheme}
                originalVariableShape={this.state.originalVariableShape}
                isSliceDataEnabled={this.state.isSliceDataEnabled}
                historyList={this.state.historyList}
                histogramData={this.state.histogramData}
                handleSliceRequest={this.handleSliceRequest}
                submitCommand={this.submitCommand}
                handleRefreshRequest={this.handleRefreshRequest}
                currentVariableName={this.state.variableName!}
            />
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private initializeData(payload: any) {
        if (payload) {
            const variable = payload as IDataFrameInfo;
            if (variable) {
                const columns = this.generateColumns(variable);
                const totalRowCount = variable.rowCount ?? 0;
                const initialRows: ISlickRow[] = [];
                const indexColumn = variable.indexColumn ?? 'index';
                const originalVariableType = variable.type ?? this.state.originalVariableType;
                const originalVariableShape = variable.shape ?? this.state.originalVariableShape;
                const variableName = variable.name ?? this.state.variableName;
                const fileName = this.state.fileName ?? variable.fileName;
                const isSliceDataEnabled = SliceableTypes.has(originalVariableType || '');
                const sliceExpression = variable.sliceExpression;

                // New data coming in, so reset everything and clear our cache of columns
                this.columnsContainingInfOrNaN.clear();
                this.resetGridEvent.notify({ columns });
                this.sentDone = false;

                this.setState({
                    gridColumns: columns,
                    gridRows: initialRows,
                    totalRowCount,
                    fetchedRowCount: initialRows.length,
                    indexColumn: indexColumn,
                    originalVariableType,
                    originalVariableShape,
                    dataDimensionality: variable.dataDimensionality ?? 2,
                    isSliceDataEnabled,
                    variableName,
                    fileName,
                    sliceExpression,
                    // Maximum number of rows is 100 if evaluating in debugger, undefined otherwise
                    maximumRowChunkSize: variable.maximumRowChunkSize ?? this.state.maximumRowChunkSize
                });

                // Compute our row fetch sizes based on the number of columns
                this.rowFetchSizeAll = Math.round(CellFetchAllLimit / columns.length);
                this.rowFetchSizeFirst = Math.round(Math.max(2, CellFetchSizeFirst / columns.length));
                this.rowFetchSizeSubsequent = Math.round(Math.max(2, CellFetchSizeSubsequent / columns.length));
                if (this.state.maximumRowChunkSize) {
                    this.rowFetchSizeAll = Math.min(this.rowFetchSizeAll, this.state.maximumRowChunkSize);
                    this.rowFetchSizeFirst = Math.min(this.rowFetchSizeFirst, this.state.maximumRowChunkSize);
                    this.rowFetchSizeSubsequent = Math.min(this.rowFetchSizeSubsequent, this.state.maximumRowChunkSize);
                }

                // Request the rest of the data if necessary
                if (initialRows.length !== totalRowCount) {
                    this.getRowsInChunks(initialRows.length, totalRowCount, variable.sliceExpression);
                }
            }
        }
    }

    private getRowsInChunks(startIndex: number, endIndex: number, sliceExpression?: string) {
        // Ask for our first chunk. Don't spam jupyter though with all requests at once
        // Instead, do them one at a time.
        const chunkEnd = startIndex + Math.min(this.rowFetchSizeFirst, endIndex);
        const chunkStart = startIndex;
        this.sendMessage(DataWranglerMessages.GetRowsRequest, { start: chunkStart, end: chunkEnd, sliceExpression });
    }

    private handleGetHistogram(response: IGetColsResponse) {
        this.setState({ histogramData: response });
    }

    private handleUpdateHistoryList(response: []) {
        this.setState({ historyList: response });
    }

    private handleGetAllRowsResponse(response: IRowsResponse) {
        const rows = response ? (response as JSONArray) : [];
        const normalized = this.normalizeData(rows);

        // Update our fetched count and actual rows
        this.setState({
            gridRows: this.state.gridRows.concat(normalized),
            fetchedRowCount: this.state.totalRowCount
        });

        // Add all of these rows to the grid
        this.updateRows(normalized);
    }

    private handleGetRowChunkResponse(response: IGetRowsResponse) {
        // We have a new fetched row count
        const rows = response.rows ? (response.rows as JSONArray) : [];
        const normalized = this.normalizeData(rows);
        const newFetched = this.state.fetchedRowCount + (response.end - response.start);

        // gridRows should have our entire list. We need to replace our part with our new results
        const before = this.state.gridRows.slice(0, response.start);
        const after = response.end < this.state.gridRows.length ? this.state.gridRows.slice(response.end) : [];
        const newActual = before.concat(normalized.concat(after));

        // Apply this to our state
        this.setState({
            fetchedRowCount: newFetched,
            gridRows: newActual
        });

        // Tell our grid about the new rows
        this.updateRows(normalized);

        // Get the next chunk
        if (newFetched < this.state.totalRowCount) {
            const chunkStart = response.end;
            const chunkEnd = Math.min(chunkStart + this.rowFetchSizeSubsequent, this.state.totalRowCount);
            this.sendMessage(DataWranglerMessages.GetRowsRequest, {
                start: chunkStart,
                end: chunkEnd,
                sliceExpression: this.state.sliceExpression
            });
        } else {
            this.submitCommand({ command: 'describe', args: { columnName: this.lastDescribeRequestColumnName } });
        }
    }

    private generateColumns(variable: IDataFrameInfo): Slick.Column<Slick.SlickData>[] {
        if (variable.columns) {
            // Generate a column for row numbers
            const rowNumberColumn = {
                key: RowNumberColumnName,
                type: ColumnType.Number
            };
            const columns = [rowNumberColumn].concat(variable.columns);
            return columns.reduce(
                (
                    accum: Slick.Column<Slick.SlickData>[],
                    c: { key: string; type: ColumnType; describe?: string },
                    i: number
                ) => {
                    // Only show index column for pandas DataFrame and Series
                    if (
                        variable?.type === 'DataFrame' ||
                        variable?.type === 'Series' ||
                        c.key !== this.state.indexColumn
                    ) {
                        accum.push({
                            type: c.type,
                            field: c.key.toString(),
                            id: `${i}`,
                            name: c.key === RowNumberColumnName ? '' : c.key.toString(),
                            sortable: true,
                            toolTip: c.describe,
                            formatter: cellFormatterFunc
                        } as Slick.Column<Slick.SlickData>);
                    }
                    return accum;
                },
                []
            );
        }
        return [];
    }

    private normalizeData(rows: JSONArray): ISlickRow[] {
        // While processing rows we may encounter Inf, -Inf or NaN.
        // These rows' column types will initially be 'string' or 'object' so
        // make sure we update the column types
        // Set of columns to update based on this batch of rows
        const columnsToUpdate = new Set<string>();
        // Make sure we have an index field and all rows have an item
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const normalizedRows = rows.map((r: any | undefined, idx: number) => {
            if (!r) {
                r = {};
            }
            r[RowNumberColumnName] = this.state.fetchedRowCount + idx;
            for (let [key, value] of Object.entries(r)) {
                switch (value) {
                    case 'nan':
                        r[key] = NaN;
                        if (!this.columnsContainingInfOrNaN.has(key)) {
                            columnsToUpdate.add(key);
                            this.columnsContainingInfOrNaN.add(key);
                        }
                        break;
                    case '-inf':
                        r[key] = -Infinity;
                        if (!this.columnsContainingInfOrNaN.has(key)) {
                            columnsToUpdate.add(key);
                            this.columnsContainingInfOrNaN.add(key);
                        }
                        break;
                    case 'inf':
                        r[key] = Infinity;
                        if (!this.columnsContainingInfOrNaN.has(key)) {
                            columnsToUpdate.add(key);
                            this.columnsContainingInfOrNaN.add(key);
                        }
                        break;
                    default:
                }
            }
            return r;
        });
        // Need to update the column types so that that column gets number treatment.
        // This should be unusual in practice.
        if (columnsToUpdate.size > 0) {
            const columns = this.state.gridColumns;
            columns
                .filter((column) => column.name && columnsToUpdate.has(column.name))
                .forEach((column) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (column as any).type = ColumnType.Number;
                });
            this.updateColumns(columns);
        }
        return normalizedRows;
    }

    private sendMessage<M extends IDataWranglerMapping, T extends keyof M>(type: T, payload?: M[T]) {
        this.postOffice.sendMessage<M, T>(type, payload);
    }

    private updateRows(newRows: ISlickRow[]) {
        if (this.updateTimeout !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clearTimeout(this.updateTimeout as any);
            this.updateTimeout = undefined;
        }
        if (!this.grid.current) {
            // This might happen before we render the grid. Postpone till then.
            this.updateTimeout = setTimeout(() => this.updateRows(newRows), 10);
        } else {
            this.gridAddEvent.notify({ newRows });
        }
    }

    private debounceRequest = debounce(this.sendMessage, 400);

    private handleSliceRequest = (args: IGetSliceRequest) => {
        // Fetching a slice is expensive so debounce requests
        this.debounceRequest(DataWranglerMessages.GetSliceRequest, args);
    };

    private handleRefreshRequest = () => {
        this.debounceRequest(DataWranglerMessages.RefreshDataWrangler);
    };

    private handleCheckboxToggle = (newState: boolean) => {
        this.sendMessage(DataWranglerMessages.SliceEnablementStateChanged, { newState });
    };

    private updateColumns(newColumns: Slick.Column<Slick.SlickData>[]) {
        this.setState({ gridColumns: newColumns });
        // State updates do not trigger a rerender on the SlickGrid,
        // so we need to tell it to update itself with an event
        this.gridColumnUpdateEvent.notify(newColumns);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private submitCommand = (arg: { command: string; args: any }) => {
        if (arg.command === 'describe') {
            console.log('Describe', arg);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.lastDescribeRequestColumnName = (arg.args as any).columnName;
        }
        this.sendMessage(DataWranglerMessages.SubmitCommand, arg);
    };
}
