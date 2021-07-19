// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IDisposable } from '../../common/types';
import { CssMessages, SharedMessages } from '../messages';
import { Event, WebviewPanel } from 'vscode';
import { SliceOperationSource } from '../../telemetry/constants';
import { ILoadTmLanguageResponse, InteractiveWindowMessages } from '../interactive-common/interactiveWindowTypes';
import {
    DataWranglerCommands,
    DataWranglerMessages,
    ICellCssStylesHash,
    IHistoryItem,
    SidePanelSections
} from './data-wrangler/types';

export const CellFetchAllLimit = 100000;
export const CellFetchSizeFirst = 100000;
export const CellFetchSizeSubsequent = 1000000;
export const MaxStringCompare = 200;
export const ColumnWarningSize = 1000; // Anything over this takes too long to load

export namespace DataViewerRowStates {
    export const Fetching = 'fetching';
    export const Skipped = 'skipped';
}

export namespace DataViewerMessages {
    export const Started = SharedMessages.Started;
    export const UpdateSettings = SharedMessages.UpdateSettings;
    export const InitializeData = 'init';
    export const GetAllRowsRequest = 'get_all_rows_request';
    export const GetAllRowsResponse = 'get_all_rows_response';
    export const GetRowsRequest = 'get_rows_request';
    export const GetRowsResponse = 'get_rows_response';
    export const CompletedData = 'complete';
    export const GetSliceRequest = 'get_slice_request';
    export const RefreshDataViewer = 'refresh_data_viewer';
    export const SliceEnablementStateChanged = 'slice_enablement_state_changed';
}

export interface IGetRowsRequest {
    start: number;
    end: number;
    sliceExpression?: string;
}

export interface IGetRowsResponse {
    rows: IRowsResponse;
    start: number;
    end: number;
}

export interface IGetColsResponse {
    cols: IColsResponse;
    columnName: string;
}

export interface IGetSliceRequest {
    slice: string | undefined;
    source: SliceOperationSource;
}

// Map all messages to specific payloads
export type IDataViewerMapping = {
    [DataViewerMessages.Started]: never | undefined;
    [DataViewerMessages.UpdateSettings]: string;
    [DataViewerMessages.InitializeData]: IDataFrameInfo;
    [DataViewerMessages.GetAllRowsRequest]: never | undefined | string;
    [DataViewerMessages.GetAllRowsResponse]: IRowsResponse;
    [DataViewerMessages.GetRowsRequest]: IGetRowsRequest;
    [DataViewerMessages.GetRowsResponse]: IGetRowsResponse;
    [DataViewerMessages.CompletedData]: never | undefined;
    [DataViewerMessages.GetSliceRequest]: IGetSliceRequest;
    [DataViewerMessages.RefreshDataViewer]: never | undefined;
    [DataViewerMessages.SliceEnablementStateChanged]: { newState: boolean };

    // For Data Wrangler specifically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [DataWranglerMessages.SubmitCommand]: { command: string; args: any };
    [DataWranglerMessages.RefreshDataWrangler]: never | undefined;
    [DataWranglerMessages.UpdateHistoryList]: IHistoryItem[] | undefined;
    [DataWranglerMessages.GetHistogramResponse]: IGetColsResponse | undefined;
    [DataWranglerMessages.SetSidePanels]: SidePanelSections[];
    [DataWranglerMessages.OperationPreview]: {
        type: DataWranglerCommands | undefined;
        cssStylings?: ICellCssStylesHash;
    };
    [DataWranglerMessages.ScrollColumnIntoView]: string;
    [InteractiveWindowMessages.LoadOnigasmAssemblyRequest]: never | undefined;
    [InteractiveWindowMessages.LoadOnigasmAssemblyResponse]: Buffer;
    [InteractiveWindowMessages.LoadTmLanguageRequest]: string;
    [InteractiveWindowMessages.LoadTmLanguageResponse]: ILoadTmLanguageResponse;
    [CssMessages.GetMonacoThemeRequest]: { isDark: boolean };
};

export interface IDataFrameColumnInfo {
    key: string;
    type: ColumnType | string;

    // For Data Wrangler specifically
    uniqueCount?: number;
    missingCount?: number;
    totalCount?: number;
    // Just for numeric columns
    statistics?: {
        average: number;
        median: number;
        min: number;
        max: number;
        sd: number;
    };
    // Just for string columns
    mostFrequentValue?: string;
    mostFrequentValueAppearances?: number;
}

export interface IDataFrameInfo {
    columns?: IDataFrameColumnInfo[];
    indexColumn?: string;
    rowCount?: number;
    duplicateRowsCount?: number;
    nanRows?: number[];
    shape?: number[];
    originalVariableShape?: number[];
    dataDimensionality?: number;
    sliceExpression?: string;
    maximumRowChunkSize?: number;
    type?: string;
    originalVariableType?: string;
    name?: string;
    /**
     * The name of the file that this variable was declared in.
     */
    fileName?: string;
    sourceFile?: string;
    previewDiffs?: ICellCssStylesHash;
}

// Used by DataViewer and DataWrangler
export interface IDataViewerDataProvider {
    dispose(): void;
    getDataFrameInfo(sliceExpression?: string, isRefresh?: boolean): Promise<IDataFrameInfo>;
    getAllRows(sliceExpression?: string): Promise<IRowsResponse>;
    getRows(start: number, end: number, sliceExpression?: string): Promise<IRowsResponse>;
    // For data wrangler specifically
    getCols?(columnName: string): Promise<IColsResponse>;
}

export enum ColumnType {
    String = 'string',
    Number = 'number',
    Bool = 'bool'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IRowsResponse = any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IColsResponse = any[];

export const IDataViewerFactory = Symbol('IDataViewerFactory');
export interface IDataViewerFactory {
    create(dataProvider: IDataViewerDataProvider, title: string): Promise<IDataViewer>;
}

export const IDataViewer = Symbol('IDataViewer');
export interface IDataViewer extends IDisposable {
    readonly active: boolean;
    readonly onDidDisposeDataViewer: Event<IDataViewer>;
    readonly onDidChangeDataViewerViewState: Event<void>;

    showData(dataProvider: IDataViewerDataProvider, title: string, webviewPanel?: WebviewPanel): Promise<void>;
    refreshData(): Promise<void>;
}
