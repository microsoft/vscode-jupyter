// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Types specifically made for the Data Wrangler and Data Wrangler messages

'use strict';

import { Event, WebviewPanel } from 'vscode';
import { IDisposable } from '../../../common/types';
import { IDataViewerDataProvider } from '../types';

export enum SidePanelSections {
    Summary = 'summary',
    Columns = 'columns',
    Rows = 'rows',
    History = 'history',
    Code = 'code'
}

export enum DataWranglerCommands {
    ExportToCsv = 'export_to_csv',
    ExportToPythonScript = 'export_to_python_script',
    ExportToNotebook = 'export_to_notebook',
    RenameColumn = 'rename_column',
    Drop = 'drop',
    DropDuplicates = 'drop_duplicates',
    DropNa = 'drop_na',
    NormalizeColumn = 'normalize_column',
    FillNa = 'fill_na',
    Describe = 'describe',
    GetHistoryItem = 'get_history_item',
    CoerceColumn = 'coerce_column',
    ReplaceAllColumn = 'replace_all_column',
    RemoveHistoryItem = 'remove_history_item',
    RespondToPreview = 'respond_to_preview'
}

export namespace DataWranglerMessages {
    export const SubmitCommand = 'submit_command';
    export const RefreshDataWrangler = 'refresh_data_wrangler';
    export const UpdateHistoryList = 'update_history_list';
    export const GetHistogramResponse = 'get_histogram_response';
    export const SetSidePanels = 'set_side_panels';
    export const OperationPreview = 'operation_preview';
    export const ScrollColumnIntoView = 'scroll_column_into_view';
}

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
    removeLatestHistoryItem(): Promise<void>;
}

export interface ICellCssStylesHash {
    [index: number]: {
        [id: number]: string;
    };
}

export interface IRemoveHistoryItemRequest {
    index: number;
}

export interface IHistoryItem {
    type?: DataWranglerCommands;
    description: string;
    variableName: string;
    code: string;
    isPreview?: boolean;
    previewCode?: string;
    shouldAdd?: boolean;
    columnsToShow?: string[];
}

export interface IGetHistoryItem {
    index: number;
}
export interface IRenameColumnsRequest {
    oldColumnName: string;
    newColumnName: string;
}

export interface IDescribeColReq {
    targetColumn: string | undefined;
}

export interface IGetColumnStatsReq {
    targetColumn: string;
}

export interface IRenameColumnsRequest {
    targetColumn: string;
    newColumnName: string;
}

export interface IReplaceAllColumnsRequest {
    targetColumns: string[];
    oldValue: string | number | undefined;
    newValue: string | number | undefined;
    isPreview: boolean;
}
export interface IDropRequest {
    targetColumns?: string[];
    rowIndices?: number[];
}

export interface IDropDuplicatesRequest {
    targetColumns?: string[];
}

export interface IDropNaRequest {
    targetColumns?: string[];
    target?: 'row' | 'column';
    isPreview: boolean;
}

export interface INormalizeColumnRequest {
    start: Number;
    end: Number;
    targetColumn: string;
    isPreview: boolean;
}

export interface IFillNaRequest {
    targetColumns: string[];
    value: string | Number;
    isPreview: boolean;
}

export interface ICoerceColumnRequest {
    targetColumns: string[];
    newType: string;
}
