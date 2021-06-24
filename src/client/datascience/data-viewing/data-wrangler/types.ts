// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { Event, WebviewPanel } from 'vscode';
import { IDisposable } from '../../../common/types';
import { IDataViewerDataProvider } from '../types';

export enum OpenDataWranglerSetting {
    STANDALONE = 'standalone'
    // WITH_JUPYTER_NOTEBOOK = 'jupyter_notebook'
    // WITH_PYTHON_FILE,
    // WITH_INTERACTIVE_WINDOW
}

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
    PyplotHistogram = 'pyplot.hist',
    NormalizeColumn = 'normalize_column',
    FillNa = 'fill_na',
    Describe = 'describe',
    GetHistoryItem = 'get_history_item',
    CoerceColumn = 'coerce_column',
    ReplaceAllColumn = 'replace_all_column'
}

export namespace DataWranglerMessages {
    export const SubmitCommand = 'submit_command';
    export const RefreshDataWrangler = 'refresh_data_wrangler'; // TODOV
    export const UpdateHistoryList = 'update_history_list';
    export const GetHistogramResponse = 'get_histogram_response';
    export const SetSidePanels = 'set_side_panels';
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
}

export interface IHistoryItem {
    transformation: string;
    variableName: string;
    code: string;
}

export interface IGetHistoryItem {
    index: number;
}

export interface IPlotHistogramReq {
    targetColumn: string;
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
}
export interface IDropRequest {
    targetColumns?: string[];
    rowIndex?: number;
}

export interface IDropDuplicatesRequest {
    targetColumns?: string[];
}

export interface IDropNaRequest {
    targetColumns?: string[];
    target?: 'row' | 'column';
}

export interface INormalizeColumnRequest {
    start: Number;
    end: Number;
    targetColumn: string;
}

export interface IFillNaRequest {
    newValue: string | Number;
}

export interface ICoerceColumnRequest {
    targetColumns: string[];
    newType: string;
}
