// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { DebugProtocolVariable, DebugProtocolVariableContainer, Uri } from 'vscode';
import { IServerState } from '../../../datascience-ui/interactive-common/mainState';

import type { KernelMessage } from '@jupyterlab/services';
import { DebugProtocol } from 'vscode-debugprotocol';
import {
    CommonActionType,
    ILoadIPyWidgetClassFailureAction,
    IVariableExplorerHeight,
    LoadIPyWidgetClassLoadAction,
    NotifyIPyWidgeWidgetVersionNotSupportedAction
} from '../../../datascience-ui/interactive-common/redux/reducers/types';
import { NativeKeyboardCommandTelemetry, NativeMouseCommandTelemetry } from '../constants';
import { WidgetScriptSource } from '../ipywidgets/types';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { CssMessages, IGetCssRequest, IGetCssResponse, SharedMessages } from '../messages';
import {
    ICell,
    IExternalCommandFromWebview,
    IExternalWebviewCellButton,
    IJupyterVariable,
    IJupyterVariablesRequest,
    IJupyterVariablesResponse,
    INotebookModel,
    KernelSocketOptions
} from '../types';
import { ILanguageConfigurationDto } from './serialization';
import { BaseReduxActionPayload } from './types';

export enum InteractiveWindowMessages {
    FinishCell = 'finish_cell',
    RestartKernel = 'restart_kernel',
    Interrupt = 'interrupt',
    SettingsUpdated = 'settings_updated',
    Started = 'started',
    ConvertUriForUseInWebViewRequest = 'ConvertUriForUseInWebViewRequest',
    ConvertUriForUseInWebViewResponse = 'ConvertUriForUseInWebViewResponse',
    AddedSysInfo = 'added_sys_info',
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
    LoadTmLanguageResponse = 'load_tmlanguage_response',
    OpenLink = 'open_link',
    ShowPlot = 'show_plot',
    SavePng = 'save_png',
    StartDebugging = 'start_debugging',
    StopDebugging = 'stop_debugging',
    ReExecuteCells = 'reexecute_cells',
    NotebookIdentity = 'identity',
    NotebookClose = 'close',
    NativeCommand = 'native_command',
    VariablesComplete = 'variables_complete',
    ExecutionRendered = 'rendered_execution',
    SelectKernel = 'select_kernel',
    SelectJupyterServer = 'select_jupyter_server',
    UpdateModel = 'update_model',
    ReceivedUpdateModel = 'received_update_model',
    OpenSettings = 'open_settings',
    IPyWidgetLoadSuccess = 'ipywidget_load_success',
    IPyWidgetLoadFailure = 'ipywidget_load_failure',
    IPyWidgetRenderFailure = 'ipywidget_render_failure',
    IPyWidgetUnhandledKernelMessage = 'ipywidget_unhandled_kernel_message',
    IPyWidgetWidgetVersionNotSupported = 'ipywidget_widget_version_not_supported',
    RunByLine = 'run_by_line',
    Step = 'step',
    Continue = 'continue',
    ShowContinue = 'show_continue',
    ShowBreak = 'show_break',
    KernelIdle = 'kernel_idle',
    UpdateExternalCellButtons = 'update_external_cell_buttons',
    ExecuteExternalCommand = 'execute_external_command',
    GetHTMLByIdRequest = 'get_html_by_id_request',
    GetHTMLByIdResponse = 'get_html_by_id_response'
}

export enum IPyWidgetMessages {
    IPyWidgets_IsReadyRequest = 'IPyWidgets_IsReadyRequest',
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

export interface IAddedSysInfo {
    type: SysInfoReason;
    id: string;
    sysInfoCell: ICell;
    notebookIdentity: Uri;
}

export interface IFinishCell {
    cell: ICell;
    notebookIdentity: Uri;
}

export interface ISubmitNewCell {
    code: string;
    id: string;
}

export interface IReExecuteCells {
    cellIds: string[];
    code: string[];
}

export interface IShowDataViewer {
    variable: IJupyterVariable;
    columnSize: number;
}

export interface IShowDataViewerFromVariablePanel {
    container: DebugProtocolVariableContainer | undefined;
    variable: DebugProtocolVariable;
}

export interface INotebookIdentity {
    resource: Uri;
    type: 'interactive' | 'native';
}

export interface ISaveAll {
    cells: ICell[];
}

export interface INativeCommand {
    command: NativeKeyboardCommandTelemetry | NativeMouseCommandTelemetry;
}

export interface INotebookModelChange {
    oldDirty: boolean;
    newDirty: boolean;
    source: 'undo' | 'user' | 'redo';
    model?: INotebookModel;
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

export interface IRunByLine {
    cell: ICell;
    expectedExecutionCount: number;
}

export interface ILoadTmLanguageResponse {
    languageId: string;
    scopeName: string; // Name in the tmlanguage scope file (scope.python instead of python)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    languageConfiguration: ILanguageConfigurationDto;
    languageJSON: string; // Contents of the tmLanguage.json file
    extensions: string[]; // Array of file extensions that map to this language
}

export interface IResponse {
    responseId: string;
}

export interface IGetCodeRequest extends IResponse {
    cellId: string;
}
export interface IReturnCodeResponse extends IResponse {
    code: string;
}
export interface IReturnAllCodeResponse extends IResponse {
    code: string[];
}

// Map all messages to specific payloads
export class IInteractiveWindowMapping {
    public [IPyWidgetMessages.IPyWidgets_kernelOptions]: KernelSocketOptions;
    public [IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest]: { moduleName: string; moduleVersion: string };
    public [IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse]: WidgetScriptSource;
    public [IPyWidgetMessages.IPyWidgets_Ready]: never | undefined;
    public [IPyWidgetMessages.IPyWidgets_onRestartKernel]: never | undefined;
    public [IPyWidgetMessages.IPyWidgets_onKernelChanged]: never | undefined;
    public [IPyWidgetMessages.IPyWidgets_registerCommTarget]: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public [IPyWidgetMessages.IPyWidgets_binary_msg]: { id: string; data: any };
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
    public [InteractiveWindowMessages.SelectKernel]: IServerState | undefined;
    public [InteractiveWindowMessages.SelectJupyterServer]: never | undefined;
    public [InteractiveWindowMessages.OpenSettings]: string | undefined;
    public [InteractiveWindowMessages.Interrupt]: never | undefined;
    public [InteractiveWindowMessages.SettingsUpdated]: string;
    public [InteractiveWindowMessages.Started]: never | undefined;
    public [InteractiveWindowMessages.AddedSysInfo]: IAddedSysInfo;
    public [InteractiveWindowMessages.Activate]: never | undefined;
    public [InteractiveWindowMessages.ShowDataViewer]: IShowDataViewer;
    public [InteractiveWindowMessages.GetVariablesRequest]: IJupyterVariablesRequest;
    public [InteractiveWindowMessages.GetVariablesResponse]: IJupyterVariablesResponse;
    public [InteractiveWindowMessages.VariableExplorerToggle]: boolean;
    public [InteractiveWindowMessages.SetVariableExplorerHeight]: IVariableExplorerHeight;
    public [InteractiveWindowMessages.VariableExplorerHeightResponse]: IVariableExplorerHeight;
    public [CssMessages.GetCssRequest]: IGetCssRequest;
    public [CssMessages.GetCssResponse]: IGetCssResponse;
    public [InteractiveWindowMessages.LoadTmLanguageResponse]: ILoadTmLanguageResponse;
    public [InteractiveWindowMessages.OpenLink]: string | undefined;
    public [InteractiveWindowMessages.ShowPlot]: string | undefined;
    public [InteractiveWindowMessages.SavePng]: string | undefined;
    public [InteractiveWindowMessages.StartDebugging]: never | undefined;
    public [InteractiveWindowMessages.StopDebugging]: never | undefined;
    public [InteractiveWindowMessages.ReExecuteCells]: IReExecuteCells;
    public [InteractiveWindowMessages.NotebookIdentity]: INotebookIdentity;
    public [InteractiveWindowMessages.NotebookClose]: INotebookIdentity;
    public [InteractiveWindowMessages.Sync]: {
        type: InteractiveWindowMessages | SharedMessages | CommonActionType;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: BaseReduxActionPayload<any>;
    };
    public [InteractiveWindowMessages.NativeCommand]: INativeCommand;
    public [InteractiveWindowMessages.VariablesComplete]: never | undefined;
    public [InteractiveWindowMessages.ExecutionRendered]: never | undefined;
    public [InteractiveWindowMessages.UpdateModel]: NotebookModelChange;
    public [InteractiveWindowMessages.ReceivedUpdateModel]: never | undefined;
    public [SharedMessages.UpdateSettings]: string;
    public [SharedMessages.LocInit]: string;
    public [InteractiveWindowMessages.IPyWidgetLoadSuccess]: LoadIPyWidgetClassLoadAction;
    public [InteractiveWindowMessages.IPyWidgetLoadFailure]: ILoadIPyWidgetClassFailureAction;
    public [InteractiveWindowMessages.IPyWidgetWidgetVersionNotSupported]: NotifyIPyWidgeWidgetVersionNotSupportedAction;
    public [InteractiveWindowMessages.ConvertUriForUseInWebViewRequest]: Uri;
    public [InteractiveWindowMessages.ConvertUriForUseInWebViewResponse]: { request: Uri; response: Uri };
    public [InteractiveWindowMessages.IPyWidgetRenderFailure]: Error;
    public [InteractiveWindowMessages.IPyWidgetUnhandledKernelMessage]: KernelMessage.IMessage;
    public [InteractiveWindowMessages.RunByLine]: IRunByLine;
    public [InteractiveWindowMessages.Continue]: never | undefined;
    public [InteractiveWindowMessages.ShowBreak]: { frames: DebugProtocol.StackFrame[]; cell: ICell };
    public [InteractiveWindowMessages.ShowContinue]: ICell;
    public [InteractiveWindowMessages.Step]: never | undefined;
    public [InteractiveWindowMessages.KernelIdle]: never | undefined;
    public [InteractiveWindowMessages.UpdateExternalCellButtons]: IExternalWebviewCellButton[];
    public [InteractiveWindowMessages.ExecuteExternalCommand]: IExternalCommandFromWebview;
    public [InteractiveWindowMessages.GetHTMLByIdRequest]: string;
    public [InteractiveWindowMessages.GetHTMLByIdResponse]: string;
}
