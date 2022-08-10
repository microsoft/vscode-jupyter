// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { Uri } from 'vscode';
import type { KernelMessage } from '@jupyterlab/services';
import { NativeKeyboardCommandTelemetry, NativeMouseCommandTelemetry } from './platform/common/constants';
import {
    IVariableExplorerHeight,
    CommonActionType
    // eslint-disable-next-line
} from './webviews/webview-side/interactive-common/redux/reducers/types';
// eslint-disable-next-line
import { BaseReduxActionPayload } from './webviews/types';
import { KernelConnectionMetadata, KernelSocketOptions } from './kernels/types';
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
    cdnsUsed: boolean;
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
    Interrupt = 'interrupt',
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
    Sync = 'sync_message_used_to_broadcast_and_sync_editors',
    OpenLink = 'open_link',
    SavePng = 'save_png',
    NotebookClose = 'close',
    VariablesComplete = 'variables_complete',
    ExecutionRendered = 'rendered_execution',
    OpenSettings = 'open_settings',
    IPyWidgetLoadSuccess = 'ipywidget_load_success',
    IPyWidgetLoadFailure = 'ipywidget_load_failure',
    IPyWidgetRenderFailure = 'ipywidget_render_failure',
    IPyWidgetUnhandledKernelMessage = 'ipywidget_unhandled_kernel_message',
    IPyWidgetWidgetVersionNotSupported = 'ipywidget_widget_version_not_supported',
    GetHTMLByIdRequest = 'get_html_by_id_request',
    GetHTMLByIdResponse = 'get_html_by_id_response'
}

export enum IPyWidgetMessages {
    IPyWidgets_logMessage = 'IPyWidgets_logMessage',
    IPyWidgets_IsReadyRequest = 'IPyWidgets_IsReadyRequest',
    IPyWidgets_AttemptToDownloadFailedWidgetsAgain = 'IPyWidgets_AttemptToDownloadFailedWidgetsAgain',
    IPyWidgets_IsOnline = 'IPyWidgets_IsOnline',
    IPyWidgets_Ready = 'IPyWidgets_Ready',
    IPyWidgets_onRestartKernel = 'IPyWidgets_onRestartKernel',
    IPyWidgets_onKernelChanged = 'IPyWidgets_onKernelChanged',
    IPyWidgets_updateRequireConfig = 'IPyWidgets_updateRequireConfig',
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
    Restart,
    Interrupt,
    New,
    Connect
}

export interface IFinishCell {
    cell: ICell;
    notebookIdentity: Uri;
}

export interface ISubmitNewCell {
    code: string;
    id: string;
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

export interface INotebookIdentity {
    resource: Uri;
    type: 'interactive' | 'native';
}
export interface INativeCommand {
    command: NativeKeyboardCommandTelemetry | NativeMouseCommandTelemetry;
}

export interface INotebookModelChange {
    oldDirty: boolean;
    newDirty: boolean;
    source: 'undo' | 'user' | 'redo';
}

export interface INotebookModelSaved extends INotebookModelChange {
    kind: 'save';
}
export interface INotebookModelSavedAs extends INotebookModelChange {
    kind: 'saveAs';
    target: Uri;
    sourceUri: Uri;
}

export interface INotebookModelRemoveAllChange extends INotebookModelChange {
    kind: 'remove_all';
    oldCells: ICell[];
    newCellId: string;
}
export interface INotebookModelModifyChange extends INotebookModelChange {
    kind: 'modify';
    newCells: ICell[];
    oldCells: ICell[];
}
export interface INotebookModelCellExecutionCountChange extends INotebookModelChange {
    kind: 'updateCellExecutionCount';
    cellId: string;
    executionCount?: number;
}

export interface INotebookModelClearChange extends INotebookModelChange {
    kind: 'clear';
    oldCells: ICell[];
}

export interface INotebookModelSwapChange extends INotebookModelChange {
    kind: 'swap';
    firstCellId: string;
    secondCellId: string;
}

export interface INotebookModelRemoveChange extends INotebookModelChange {
    kind: 'remove';
    cell: ICell;
    index: number;
}

export interface INotebookModelInsertChange extends INotebookModelChange {
    kind: 'insert';
    cell: ICell;
    index: number;
    codeCellAboveId?: string;
}

export interface INotebookModelAddChange extends INotebookModelChange {
    kind: 'add';
    cell: ICell;
    fullText: string;
    currentText: string;
}

export interface INotebookModelChangeTypeChange extends INotebookModelChange {
    kind: 'changeCellType';
    cell: ICell;
}

export interface IEditorPosition {
    /**
     * line number (starts at 1)
     */
    readonly lineNumber: number;
    /**
     * column (the first character in a line is between column 1 and column 2)
     */
    readonly column: number;
}

export interface IEditorRange {
    /**
     * Line number on which the range starts (starts at 1).
     */
    readonly startLineNumber: number;
    /**
     * Column on which the range starts in line `startLineNumber` (starts at 1).
     */
    readonly startColumn: number;
    /**
     * Line number on which the range ends.
     */
    readonly endLineNumber: number;
    /**
     * Column on which the range ends in line `endLineNumber`.
     */
    readonly endColumn: number;
}

export interface IEditorContentChange {
    /**
     * The range that got replaced.
     */
    readonly range: IEditorRange;
    /**
     * The offset of the range that got replaced.
     */
    readonly rangeOffset: number;
    /**
     * The length of the range that got replaced.
     */
    readonly rangeLength: number;
    /**
     * The new text for the range.
     */
    readonly text: string;
    /**
     * The cursor position to be set after the change
     */
    readonly position: IEditorPosition;
}

export interface INotebookModelEditChange extends INotebookModelChange {
    kind: 'edit';
    forward: IEditorContentChange[];
    reverse: IEditorContentChange[];
    id: string;
}

export interface INotebookModelVersionChange extends INotebookModelChange {
    kind: 'version';
    kernelConnection?: KernelConnectionMetadata;
}

export enum SharedMessages {
    UpdateSettings = 'update_settings',
    Started = 'started',
    LocInit = 'loc_init'
}

export interface IGetCssRequest {
    isDark: boolean;
}

export interface IGetCssResponse {
    isDark: boolean;
}

export type NotebookModelChange =
    | INotebookModelSaved
    | INotebookModelSavedAs
    | INotebookModelModifyChange
    | INotebookModelRemoveAllChange
    | INotebookModelClearChange
    | INotebookModelSwapChange
    | INotebookModelRemoveChange
    | INotebookModelInsertChange
    | INotebookModelAddChange
    | INotebookModelEditChange
    | INotebookModelVersionChange
    | INotebookModelChangeTypeChange
    | INotebookModelCellExecutionCountChange;

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
    public [IPyWidgetMessages.IPyWidgets_logMessage]: string;
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
    public [InteractiveWindowMessages.OpenSettings]: string | undefined;
    public [InteractiveWindowMessages.Interrupt]: never | undefined;
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
    public [InteractiveWindowMessages.NotebookClose]: INotebookIdentity;
    public [InteractiveWindowMessages.Sync]: {
        type: InteractiveWindowMessages | SharedMessages | CommonActionType;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: BaseReduxActionPayload<any>;
    };
    public [InteractiveWindowMessages.VariablesComplete]: never | undefined;
    public [InteractiveWindowMessages.ExecutionRendered]: never | undefined;
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
