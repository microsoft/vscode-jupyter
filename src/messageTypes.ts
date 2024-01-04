// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import type { KernelMessage } from '@jupyterlab/services';
import {
    IVariableExplorerHeight // eslint-disable-next-line
} from './webviews/webview-side/interactive-common/redux/reducers/types';
// eslint-disable-next-line
import { KernelSocketOptions } from './kernels/types';
import { ICell } from './platform/common/types';
import { IJupyterVariable, IJupyterVariablesRequest, IJupyterVariablesResponse } from './kernels/variables/types';
import { WidgetScriptSource } from './notebooks/controllers/ipywidgets/types';

export type NotifyIPyWidgetWidgetVersionNotSupportedAction = {
    moduleName: 'qgrid';
    moduleVersion: string;
};

export interface ILoadIPyWidgetClassFailureAction {
    className: string;
    moduleName: string;
    moduleVersion: string;
    isOnline: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error: any;
    timedout: boolean;
}

export type LoadIPyWidgetClassLoadAction = {
    className: string;
    moduleName: string;
    moduleVersion: string;
};

export enum InteractiveWindowMessages {
    FinishCell = 'finish_cell',
    RestartKernel = 'restart_kernel',
    SettingsUpdated = 'settings_updated',
    Started = 'started',
    ConvertUriForUseInWebViewRequest = 'ConvertUriForUseInWebViewRequest',
    ConvertUriForUseInWebViewResponse = 'ConvertUriForUseInWebViewResponse',
    Activate = 'activate',
    ShowDataViewer = 'show_data_explorer',
    GetVariablesRequest = 'get_variables_request',
    GetVariablesResponse = 'get_variables_response',
    VariableExplorerToggle = 'variable_explorer_toggle',
    SetVariableExplorerHeight = 'set_variable_explorer_height',
    VariableExplorerHeightResponse = 'variable_explorer_height_response',
    ForceVariableRefresh = 'force_variable_refresh',
    UpdateVariableViewExecutionCount = 'update_variable_view_execution_count',
    OpenLink = 'open_link',
    SavePng = 'save_png',
    VariablesComplete = 'variables_complete',
    IPyWidgetLoadSuccess = 'ipywidget_load_success',
    IPyWidgetLoadFailure = 'ipywidget_load_failure',
    IPyWidgetRenderFailure = 'ipywidget_render_failure',
    IPyWidgetUnhandledKernelMessage = 'ipywidget_unhandled_kernel_message',
    IPyWidgetWidgetVersionNotSupported = 'ipywidget_widget_version_not_supported',
    GetHTMLByIdRequest = 'get_html_by_id_request',
    GetHTMLByIdResponse = 'get_html_by_id_response'
}

export enum IPyWidgetMessages {
    IPyWidgets_Window_Alert = 'IPyWidgets_Window_Alert',
    IPyWidgets_Window_Open = 'IPyWidgets_Window_Open',
    IPyWidgets_logMessage = 'IPyWidgets_logMessage',
    IPyWidgets_IsReadyRequest = 'IPyWidgets_IsReadyRequest',
    IPyWidgets_AttemptToDownloadFailedWidgetsAgain = 'IPyWidgets_AttemptToDownloadFailedWidgetsAgain',
    IPyWidgets_IsOnline = 'IPyWidgets_IsOnline',
    IPyWidgets_Ready = 'IPyWidgets_Ready',
    IPyWidgets_Request_Widget_Version = 'IPyWidgets_Request_Widget_Version',
    IPyWidgets_Reply_Widget_Version = 'IPyWidgets_Reply_Widget_Version',
    IPyWidgets_onRestartKernel = 'IPyWidgets_onRestartKernel',
    IPyWidgets_onKernelChanged = 'IPyWidgets_onKernelChanged',
    /**
     * UI sends a request to extension to determine whether we have the source for any of the widgets.
     */
    IPyWidgets_WidgetScriptSourceRequest = 'IPyWidgets_WidgetScriptSourceRequest',
    /**
     * Extension sends response to the request with yes/no.
     */
    IPyWidgets_WidgetScriptSourceResponse = 'IPyWidgets_WidgetScriptSource_Response',
    IPyWidgets_BaseUrlResponse = 'IPyWidgets_BaseUrl_Response',
    IPyWidgets_msg = 'IPyWidgets_msg',
    IPyWidgets_binary_msg = 'IPyWidgets_binary_msg',
    // Message was received by the widget kernel and added to the msgChain queue for processing
    IPyWidgets_msg_received = 'IPyWidgets_msg_received',
    // IOPub message was fully handled by the widget kernel
    IPyWidgets_iopub_msg_handled = 'IPyWidgets_iopub_msg_handled',
    IPyWidgets_kernelOptions = 'IPyWidgets_kernelOptions',
    IPyWidgets_registerCommTarget = 'IPyWidgets_registerCommTarget',
    IPyWidgets_RegisterMessageHook = 'IPyWidgets_RegisterMessageHook',
    // Message sent when the extension has finished an operation requested by the kernel UI for processing a message
    IPyWidgets_ExtensionOperationHandled = 'IPyWidgets_ExtensionOperationHandled',
    IPyWidgets_RemoveMessageHook = 'IPyWidgets_RemoveMessageHook',
    IPyWidgets_MessageHookCall = 'IPyWidgets_MessageHookCall',
    IPyWidgets_MessageHookResult = 'IPyWidgets_MessageHookResult',
    IPyWidgets_mirror_execute = 'IPyWidgets_mirror_execute'
}

export enum SysInfoReason {
    Start,
    Restart
}

export interface IFinishCell {
    cell: ICell;
}

export interface IShowDataViewer {
    variable: IJupyterVariable;
    columnSize: number;
}

export interface IShowDataViewerFromVariablePanel {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    container: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variable: any;
}

export enum SharedMessages {
    UpdateSettings = 'update_settings',
    Started = 'started',
    LocInit = 'loc_init'
}

export type LocalizedMessages = {
    collapseSingle: string;
    expandSingle: string;
    openExportFileYes: string;
    openExportFileNo: string;
    noRowsInDataViewer: string;
    sliceIndexError: string;
    sliceMismatchedAxesError: string;
    filterRowsTooltip: string;
    fetchingDataViewer: string;
    dataViewerHideFilters: string;
    dataViewerShowFilters: string;
    refreshDataViewer: string;
    clearFilters: string;
    sliceSummaryTitle: string;
    sliceData: string;
    sliceSubmitButton: string;
    sliceDropdownAxisLabel: string;
    sliceDropdownIndexLabel: string;
    variableExplorerNameColumn: string;
    variableExplorerTypeColumn: string;
    variableExplorerCountColumn: string;
    variableExplorerValueColumn: string;
    collapseVariableExplorerLabel: string;
    variableLoadingValue: string;
    showDataExplorerTooltip: string;
    noRowsInVariableExplorer: string;
    loadingRowsInVariableExplorer: string;
    previousPlot: string;
    nextPlot: string;
    panPlot: string;
    zoomInPlot: string;
    zoomOutPlot: string;
    exportPlot: string;
    deletePlot: string;
    selectedImageListLabel: string;
    selectedImageLabel: string;
};
// Map all messages to specific payloads
export class IInteractiveWindowMapping {
    public [IPyWidgetMessages.IPyWidgets_kernelOptions]: KernelSocketOptions;
    public [IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest]: {
        moduleName: string;
        moduleVersion: string;
        requestId: string;
    };
    public [IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse]: WidgetScriptSource;
    public [IPyWidgetMessages.IPyWidgets_Ready]: never | undefined;
    public [IPyWidgetMessages.IPyWidgets_IsOnline]: { isOnline: boolean };
    public [IPyWidgetMessages.IPyWidgets_logMessage]: { category: 'error' | 'verbose'; message: string };
    public [IPyWidgetMessages.IPyWidgets_onRestartKernel]: never | undefined;
    public [IPyWidgetMessages.IPyWidgets_onKernelChanged]: never | undefined;
    public [IPyWidgetMessages.IPyWidgets_registerCommTarget]: string;
    public [IPyWidgetMessages.IPyWidgets_binary_msg]:
        | ((ArrayBuffer | ArrayBufferView)[] | undefined)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        | { id: string; data: any };
    public [IPyWidgetMessages.IPyWidgets_msg]: { id: string; data: string };
    public [IPyWidgetMessages.IPyWidgets_msg_received]: { id: string };
    public [IPyWidgetMessages.IPyWidgets_iopub_msg_handled]: { id: string };
    public [IPyWidgetMessages.IPyWidgets_RegisterMessageHook]: string;
    public [IPyWidgetMessages.IPyWidgets_ExtensionOperationHandled]: { id: string; type: IPyWidgetMessages };
    public [IPyWidgetMessages.IPyWidgets_RemoveMessageHook]: { hookMsgId: string; lastHookedMsgId: string | undefined };
    public [IPyWidgetMessages.IPyWidgets_MessageHookCall]: {
        requestId: string;
        parentId: string;
        msg: KernelMessage.IIOPubMessage;
    };
    public [IPyWidgetMessages.IPyWidgets_MessageHookResult]: {
        requestId: string;
        parentId: string;
        msgType: string;
        result: boolean;
    };
    public [IPyWidgetMessages.IPyWidgets_mirror_execute]: { id: string; msg: KernelMessage.IExecuteRequestMsg };
    public [InteractiveWindowMessages.ForceVariableRefresh]: never | undefined;
    public [InteractiveWindowMessages.UpdateVariableViewExecutionCount]: { executionCount: number };
    public [InteractiveWindowMessages.FinishCell]: IFinishCell;
    public [InteractiveWindowMessages.RestartKernel]: never | undefined;
    public [InteractiveWindowMessages.SettingsUpdated]: string;
    public [InteractiveWindowMessages.Started]: never | undefined;
    public [InteractiveWindowMessages.Activate]: never | undefined;
    public [InteractiveWindowMessages.ShowDataViewer]: IShowDataViewer;
    public [InteractiveWindowMessages.GetVariablesRequest]: IJupyterVariablesRequest;
    public [InteractiveWindowMessages.GetVariablesResponse]: IJupyterVariablesResponse;
    public [InteractiveWindowMessages.VariableExplorerToggle]: boolean;
    public [InteractiveWindowMessages.SetVariableExplorerHeight]: IVariableExplorerHeight;
    public [InteractiveWindowMessages.VariableExplorerHeightResponse]: IVariableExplorerHeight;
    public [InteractiveWindowMessages.OpenLink]: string | undefined;
    public [InteractiveWindowMessages.SavePng]: string | undefined;
    public [InteractiveWindowMessages.VariablesComplete]: never | undefined;
    public [SharedMessages.UpdateSettings]: string;
    public [SharedMessages.LocInit]: string;
    public [InteractiveWindowMessages.IPyWidgetLoadSuccess]: LoadIPyWidgetClassLoadAction;
    public [InteractiveWindowMessages.IPyWidgetLoadFailure]: ILoadIPyWidgetClassFailureAction;
    public [InteractiveWindowMessages.IPyWidgetWidgetVersionNotSupported]: NotifyIPyWidgetWidgetVersionNotSupportedAction;
    public [InteractiveWindowMessages.ConvertUriForUseInWebViewRequest]: Uri;
    public [InteractiveWindowMessages.ConvertUriForUseInWebViewResponse]: { request: Uri; response: Uri };
    public [InteractiveWindowMessages.IPyWidgetRenderFailure]: Error;
    public [InteractiveWindowMessages.IPyWidgetUnhandledKernelMessage]: KernelMessage.IMessage;
    public [InteractiveWindowMessages.GetHTMLByIdRequest]: string;
    public [InteractiveWindowMessages.GetHTMLByIdResponse]: string;
}

export const enum ErrorRendererMessageType {
    RequestLoadLoc = 2,
    ResponseLoadLoc = 3
}
export type Localizations = {
    errorOutputExceedsLinkToOpenFormatString: string;
};
