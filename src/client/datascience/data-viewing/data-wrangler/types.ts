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
    CoerceColumn = 'coerce_column'
}

export namespace DataWranglerMessages {
    export const SubmitCommand = 'submit_command';
    export const RefreshDataWrangler = 'refresh_data_viewer'; // TODOV
    export const UpdateHistoryList = 'update_history_list';
    export const GetHistogramResponse = 'get_histogram_response';
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
export interface IRenameColumnsRequest {
    oldColumnName: string;
    newColumnName: string;
}

export interface IPlotHistogramReq {
    target: string;
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

export interface ICoerceColumnRequest {
    columnName: string;
    newType: string;
}
