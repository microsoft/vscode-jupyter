// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IDisposable } from '../../../common/types';
import { CssMessages, SharedMessages } from '../../messages';
import { Event, WebviewPanel } from 'vscode';
import { InteractiveWindowMessages, ILoadTmLanguageResponse } from '../../interactive-common/interactiveWindowTypes';
import {
    IDataFrameInfo,
    IDataViewerDataProvider,
    IGetColsResponse,
    IGetRowsRequest,
    IGetRowsResponse,
    IGetSliceRequest,
    IRowsResponse
} from '../types';

export enum OpenDataWranglerSetting {
    STANDALONE = 'standalone',
    WITH_JUPYTER_NOTEBOOK = 'jupyter_notebook'
    // WITH_PYTHON_FILE,
    // WITH_INTERACTIVE_WINDOW
}

export enum DataWranglerCommands {
    ExportToCsv = 'export_to_csv',
    ExportToPythonScript = 'export_to_python_script',
    ExportToNotebook = 'export_to_notebook',
    RenameColumn = 'rename_column',
    Drop = 'drop',
    DropDuplicates = 'drop_duplicates',
    DropNa = 'drop_na',
    PyplotHistogram = 'pyplot.hist',
    NormalizeColumn = 'normalize_column',
    FillNa = 'fill_na',
    Describe = 'describe',
    GetHistoryItem = 'get_history_item'
}

export namespace DataWranglerMessages {
    export const Started = SharedMessages.Started;
    export const UpdateSettings = SharedMessages.UpdateSettings;
    export const InitializeData = 'init';
    export const GetAllRowsRequest = 'get_all_rows_request';
    export const GetAllRowsResponse = 'get_all_rows_response';
    export const GetRowsRequest = 'get_rows_request';
    export const GetRowsResponse = 'get_rows_response';
    export const CompletedData = 'complete';
    export const GetSliceRequest = 'get_slice_request';
    export const SubmitCommand = 'submit_command';
    export const RefreshDataWrangler = 'refresh_data_viewer'; // TODOV
    export const SliceEnablementStateChanged = 'slice_enablement_state_changed';
    export const UpdateHistoryList = 'update_history_list';
    export const GetHistogramResponse = 'get_histogram_response';
}

// Map all messages to specific payloads
export type IDataWranglerMapping = {
    [DataWranglerMessages.Started]: never | undefined;
    [DataWranglerMessages.UpdateSettings]: string;
    [DataWranglerMessages.InitializeData]: IDataFrameInfo;
    [DataWranglerMessages.GetAllRowsRequest]: never | undefined | string;
    [DataWranglerMessages.GetAllRowsResponse]: IRowsResponse;
    [DataWranglerMessages.GetRowsRequest]: IGetRowsRequest;
    [DataWranglerMessages.GetRowsResponse]: IGetRowsResponse;
    [DataWranglerMessages.CompletedData]: never | undefined;
    [DataWranglerMessages.GetSliceRequest]: IGetSliceRequest;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [DataWranglerMessages.SubmitCommand]: { command: string; args: any };
    [DataWranglerMessages.RefreshDataWrangler]: never | undefined;
    [DataWranglerMessages.SliceEnablementStateChanged]: { newState: boolean };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [DataWranglerMessages.UpdateHistoryList]: any[] | undefined;
    [DataWranglerMessages.GetHistogramResponse]: IGetColsResponse;
    [InteractiveWindowMessages.LoadOnigasmAssemblyRequest]: never | undefined;
    [InteractiveWindowMessages.LoadOnigasmAssemblyResponse]: Buffer;
    [InteractiveWindowMessages.LoadTmLanguageRequest]: string;
    [InteractiveWindowMessages.LoadTmLanguageResponse]: ILoadTmLanguageResponse;
    [CssMessages.GetMonacoThemeRequest]: { isDark: boolean };
};

export const IDataWranglerFactory = Symbol('IDataWranglerFactory');
export interface IDataWranglerFactory {
    create(dataProvider: IDataViewerDataProvider, title: string, webviewPanel?: WebviewPanel): Promise<IDataWrangler>;
}

export const IDataWrangler = Symbol('IDataWrangler');
export interface IDataWrangler extends IDisposable {
    readonly visible: boolean;
    readonly onDidDisposeDataWrangler: Event<IDataWrangler>;
    readonly onDidChangeDataWranglerViewState: Event<void>;
    showData(dataProvider: IDataViewerDataProvider, title: string, webviewPanel?: WebviewPanel): Promise<void>;
    refreshData(): Promise<void>;
    updateWithNewVariable(newVariableName: string): Promise<void>;
}

export interface IHistoryItem {
    transformation: string;
    variableName: string;
    code: string;
}
export interface IRenameColumnsRequest {
    oldColumnName: string;
    newColumnName: string;
}

export interface IDropRequest {
    mode: 'row' | 'column';
    targets: string[];
}

export interface IDropDuplicatesRequest {
    subset?: string[];
}

export interface IDropNaRequest {
    subset?: string[];
    target?: Number;
}

export interface INormalizeColumnRequest {
    start: Number;
    end: Number;
    target: string;
}

export interface IFillNaRequest {
    newValue: string | Number;
}
