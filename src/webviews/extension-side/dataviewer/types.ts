// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event } from 'vscode';
import { IKernel } from '../../../kernels/types';
import { IJupyterVariable } from '../../../kernels/variables/types';
import { IDisposable } from '../../../platform/common/types';
import { SharedMessages } from '../../../messageTypes';
import { SliceOperationSource } from '../../../platform/telemetry/constants';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';

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
};

export interface IDataFrameInfo {
    columns?: { key: string; type: ColumnType }[];
    indexColumn?: string;
    rowCount?: number;
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
}

export interface IDataViewerDataProvider {
    dispose(): void;
    getDataFrameInfo(sliceExpression?: string, isRefresh?: boolean): Promise<IDataFrameInfo>;
    getAllRows(sliceExpression?: string): Promise<IRowsResponse>;
    getRows(start: number, end: number, sliceExpression?: string): Promise<IRowsResponse>;
}

export enum ColumnType {
    String = 'string',
    Number = 'number',
    Bool = 'bool'
}

export type IRowsResponse = Record<string, unknown>[];

export const IDataViewerFactory = Symbol('IDataViewerFactory');
export interface IDataViewerFactory {
    create(dataProvider: IDataViewerDataProvider, title: string): Promise<IDataViewer>;
    readonly activeViewer: IDataViewer | undefined;
}

export const IDataViewer = Symbol('IDataViewer');
export interface IDataViewer extends IDisposable {
    readonly active: boolean;
    readonly kernel?: IKernel | undefined;
    readonly title: string;
    readonly onDidDisposeDataViewer: Event<IDataViewer>;
    readonly onDidChangeDataViewerViewState: Event<void>;
    showData(dataProvider: IDataViewerDataProvider, title: string): Promise<void>;
    refreshData(): Promise<void>;
}

export const IJupyterVariableDataProvider = Symbol('IJupyterVariableDataProvider');
export interface IJupyterVariableDataProvider extends IDataViewerDataProvider {
    readonly kernel: IKernel | undefined;
    setDependencies(variable: IJupyterVariable, kernel?: IKernel): void;
}

export const IJupyterVariableDataProviderFactory = Symbol('IJupyterVariableDataProviderFactory');
export interface IJupyterVariableDataProviderFactory {
    create(variable: IJupyterVariable, kernel?: IKernel): Promise<IJupyterVariableDataProvider>;
}

export const IDataViewerDependencyService = Symbol('IDataViewerDependencyService');

export interface IDataViewerDependencyService {
    checkAndInstallMissingDependencies(executionEnvironment: IKernel | PythonEnvironment): Promise<void>;
}
