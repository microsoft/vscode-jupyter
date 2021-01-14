// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import {
    CommonActionType,
    CommonActionTypeMapping
} from '../../../datascience-ui/interactive-common/redux/reducers/types';
import { CssMessages, SharedMessages } from '../messages';
import {
    IInteractiveWindowMapping,
    InteractiveWindowMessages,
    IPyWidgetMessages,
    NotebookModelChange
} from './interactiveWindowTypes';

// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export enum MessageType {
    /**
     * Action dispatched as result of some user action.
     */
    other = 0,
    /**
     * Action dispatched to re-broadcast a message across other editors of the same file in the same session.
     */
    syncAcrossSameNotebooks = 1 << 0,
    /**
     * Action dispatched to re-broadcast a message across other sessions (live share).
     */
    syncWithLiveShare = 1 << 1,
    noIdea = 1 << 2
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessageAction = (payload: any) => boolean;

type MessageMapping<T> = {
    [P in keyof T]: MessageType | MessageAction;
};

export type IInteractiveActionMapping = MessageMapping<IInteractiveWindowMapping>;

// Do not change to a dictionary or a record.
// The current structure ensures all new enums added will be categorized.
// This way, if a new message is added, we'll make the decision early on whether it needs to be synchronized and how.
// Rather than waiting for users to report issues related to new messages.
const messageWithMessageTypes: MessageMapping<IInteractiveWindowMapping> & MessageMapping<CommonActionTypeMapping> = {
    [CommonActionType.ADD_AND_FOCUS_NEW_CELL]: MessageType.other,
    [CommonActionType.ADD_NEW_CELL]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.ARROW_DOWN]: MessageType.syncWithLiveShare,
    [CommonActionType.ARROW_UP]: MessageType.syncWithLiveShare,
    [CommonActionType.CHANGE_CELL_TYPE]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.CLICK_CELL]: MessageType.syncWithLiveShare,
    [CommonActionType.CONTINUE]: MessageType.other,
    [CommonActionType.DELETE_CELL]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.CODE_CREATED]: MessageType.noIdea,
    [CommonActionType.COPY_CELL_CODE]: MessageType.other,
    [CommonActionType.EDITOR_LOADED]: MessageType.other,
    [CommonActionType.EDIT_CELL]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.EXECUTE_CELL_AND_ADVANCE]: MessageType.other,
    [CommonActionType.EXECUTE_ABOVE]: MessageType.other,
    [CommonActionType.EXECUTE_ALL_CELLS]: MessageType.other,
    [CommonActionType.EXECUTE_CELL]: MessageType.other,
    [CommonActionType.EXECUTE_CELL_AND_BELOW]: MessageType.other,
    [CommonActionType.EXPORT]: MessageType.other,
    [CommonActionType.EXPORT_NOTEBOOK_AS]: MessageType.other,
    [CommonActionType.FOCUS_CELL]: MessageType.syncWithLiveShare,
    [CommonActionType.GET_VARIABLE_DATA]: MessageType.other,
    [CommonActionType.GOTO_CELL]: MessageType.syncWithLiveShare,
    [CommonActionType.INSERT_ABOVE_AND_FOCUS_NEW_CELL]: MessageType.other,
    [CommonActionType.INSERT_ABOVE]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.INSERT_ABOVE_FIRST_AND_FOCUS_NEW_CELL]: MessageType.other,
    [CommonActionType.INSERT_ABOVE_FIRST]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.INSERT_BELOW]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.INSERT_BELOW_AND_FOCUS_NEW_CELL]: MessageType.other,
    [CommonActionType.INTERRUPT_KERNEL]: MessageType.other,
    [CommonActionType.LAUNCH_NOTEBOOK_TRUST_PROMPT]: MessageType.other,
    [CommonActionType.LOADED_ALL_CELLS]: MessageType.other,
    [CommonActionType.LINK_CLICK]: MessageType.other,
    [CommonActionType.MOVE_CELL_DOWN]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.MOVE_CELL_UP]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.OPEN_SETTINGS]: MessageType.other,
    [CommonActionType.REDO]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.RESTART_KERNEL]: MessageType.other,
    [CommonActionType.RUN_BY_LINE]: MessageType.other,
    [CommonActionType.SAVE]: MessageType.other,
    [CommonActionType.SCROLL]: MessageType.syncWithLiveShare,
    [CommonActionType.SELECT_CELL]: MessageType.syncWithLiveShare,
    [CommonActionType.SELECT_SERVER]: MessageType.other,
    [CommonActionType.SEND_COMMAND]: MessageType.other,
    [CommonActionType.SHOW_DATA_VIEWER]: MessageType.other,
    [CommonActionType.STEP]: MessageType.other,
    [CommonActionType.SUBMIT_INPUT]: MessageType.other,
    [CommonActionType.TOGGLE_INPUT_BLOCK]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.TOGGLE_LINE_NUMBERS]: MessageType.syncWithLiveShare,
    [CommonActionType.TOGGLE_OUTPUT]: MessageType.syncWithLiveShare,
    [CommonActionType.TOGGLE_VARIABLE_EXPLORER]: MessageType.syncWithLiveShare,
    [CommonActionType.SET_VARIABLE_EXPLORER_HEIGHT]: MessageType.other,
    [CommonActionType.UNDO]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [CommonActionType.UNFOCUS_CELL]: MessageType.syncWithLiveShare,
    [CommonActionType.UNMOUNT]: MessageType.other,
    [CommonActionType.PostOutgoingMessage]: MessageType.other,
    [CommonActionType.REFRESH_VARIABLES]: MessageType.other,
    [CommonActionType.FOCUS_INPUT]: MessageType.other,
    [CommonActionType.LOAD_IPYWIDGET_CLASS_SUCCESS]: MessageType.other,
    [CommonActionType.LOAD_IPYWIDGET_CLASS_FAILURE]: MessageType.other,
    [CommonActionType.IPYWIDGET_WIDGET_VERSION_NOT_SUPPORTED]: MessageType.other,
    [CommonActionType.IPYWIDGET_RENDER_FAILURE]: MessageType.other,
    [CommonActionType.VARIABLE_VIEW_LOADED]: MessageType.other,

    // Types from InteractiveWindowMessages
    [InteractiveWindowMessages.Activate]: MessageType.other,
    [InteractiveWindowMessages.AddedSysInfo]: MessageType.other,
    [InteractiveWindowMessages.CancelCompletionItemsRequest]: MessageType.other,
    [InteractiveWindowMessages.CancelHoverRequest]: MessageType.other,
    [InteractiveWindowMessages.CancelResolveCompletionItemRequest]: MessageType.other,
    [InteractiveWindowMessages.CancelSignatureHelpRequest]: MessageType.other,
    [InteractiveWindowMessages.ClearAllOutputs]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.CollapseAll]: MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.Continue]: MessageType.other,
    [InteractiveWindowMessages.CopyCodeCell]: MessageType.other,
    [InteractiveWindowMessages.DebugStateChange]: MessageType.other,
    [InteractiveWindowMessages.DeleteAllCells]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.DoSave]: MessageType.other,
    [InteractiveWindowMessages.ExecutionRendered]: MessageType.other,
    [InteractiveWindowMessages.ExpandAll]: MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.Export]: MessageType.other,
    [InteractiveWindowMessages.ExportNotebookAs]: MessageType.other,
    [InteractiveWindowMessages.FinishCell]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.FocusedCellEditor]: MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.GetAllCellCode]: MessageType.other,
    [InteractiveWindowMessages.GetAllCells]: MessageType.other,
    [InteractiveWindowMessages.GetCellCode]: MessageType.other,
    [InteractiveWindowMessages.ForceVariableRefresh]: MessageType.other,
    [InteractiveWindowMessages.UpdateVariableViewExecutionCount]: MessageType.other,
    [InteractiveWindowMessages.GetVariablesRequest]: MessageType.other,
    [InteractiveWindowMessages.GetVariablesResponse]: MessageType.other,
    [InteractiveWindowMessages.GotoCodeCell]: MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.GotoCodeCell]: MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.HasCell]: MessageType.other,
    [InteractiveWindowMessages.HasCellResponse]: MessageType.other,
    [InteractiveWindowMessages.Interrupt]: MessageType.other,
    [InteractiveWindowMessages.IPyWidgetLoadSuccess]: MessageType.other,
    [InteractiveWindowMessages.IPyWidgetLoadFailure]: MessageType.other,
    [InteractiveWindowMessages.IPyWidgetRenderFailure]: MessageType.other,
    [InteractiveWindowMessages.IPyWidgetUnhandledKernelMessage]: MessageType.other,
    [InteractiveWindowMessages.IPyWidgetWidgetVersionNotSupported]: MessageType.other,
    [InteractiveWindowMessages.KernelIdle]: MessageType.other,
    [InteractiveWindowMessages.LaunchNotebookTrustPrompt]: MessageType.other,
    [InteractiveWindowMessages.TrustNotebookComplete]: MessageType.other,
    [InteractiveWindowMessages.LoadAllCells]: MessageType.other,
    [InteractiveWindowMessages.LoadAllCellsComplete]: MessageType.other,
    [InteractiveWindowMessages.LoadOnigasmAssemblyRequest]: MessageType.other,
    [InteractiveWindowMessages.LoadOnigasmAssemblyResponse]: MessageType.other,
    [InteractiveWindowMessages.LoadTmLanguageRequest]: MessageType.other,
    [InteractiveWindowMessages.LoadTmLanguageResponse]: MessageType.other,
    [InteractiveWindowMessages.MonacoReady]: MessageType.other,
    [InteractiveWindowMessages.NativeCommand]: MessageType.other,
    [InteractiveWindowMessages.NotebookAddCellBelow]:
        MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.NotebookClean]: MessageType.other,
    [InteractiveWindowMessages.NotebookDirty]: MessageType.other,
    [InteractiveWindowMessages.NotebookExecutionActivated]: MessageType.other,
    [InteractiveWindowMessages.NotebookIdentity]: MessageType.other,
    [InteractiveWindowMessages.NotebookClose]: MessageType.other,
    [InteractiveWindowMessages.NotebookRunAllCells]: MessageType.other,
    [InteractiveWindowMessages.NotebookRunSelectedCell]: MessageType.other,
    [InteractiveWindowMessages.OpenLink]: MessageType.other,
    [InteractiveWindowMessages.OpenSettings]: MessageType.other,
    [InteractiveWindowMessages.OutputToggled]: MessageType.other,
    [InteractiveWindowMessages.ProvideCompletionItemsRequest]: MessageType.other,
    [InteractiveWindowMessages.ProvideCompletionItemsResponse]: MessageType.other,
    [InteractiveWindowMessages.ProvideHoverRequest]: MessageType.other,
    [InteractiveWindowMessages.ProvideHoverResponse]: MessageType.other,
    [InteractiveWindowMessages.ProvideSignatureHelpRequest]: MessageType.other,
    [InteractiveWindowMessages.ProvideSignatureHelpResponse]: MessageType.other,
    [InteractiveWindowMessages.ReExecuteCells]: MessageType.other,
    [InteractiveWindowMessages.Redo]: MessageType.other,
    [InteractiveWindowMessages.RemoteAddCode]: MessageType.other,
    [InteractiveWindowMessages.ReceivedUpdateModel]: MessageType.other,
    [InteractiveWindowMessages.RemoteReexecuteCode]: MessageType.other,
    [InteractiveWindowMessages.ResolveCompletionItemRequest]: MessageType.other,
    [InteractiveWindowMessages.ResolveCompletionItemResponse]: MessageType.other,
    [InteractiveWindowMessages.RestartKernel]: MessageType.other,
    [InteractiveWindowMessages.ReturnAllCellCode]: MessageType.other,
    [InteractiveWindowMessages.ReturnAllCells]: MessageType.other,
    [InteractiveWindowMessages.ReturnCellCode]: MessageType.other,
    [InteractiveWindowMessages.RunByLine]: MessageType.other,
    [InteractiveWindowMessages.SaveAll]: MessageType.other,
    [InteractiveWindowMessages.SavePng]: MessageType.other,
    [InteractiveWindowMessages.ScrollToCell]: MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.SelectedCell]: MessageType.other,
    [InteractiveWindowMessages.SelectJupyterServer]: MessageType.other,
    [InteractiveWindowMessages.SelectKernel]: MessageType.other,
    [InteractiveWindowMessages.SendInfo]: MessageType.other,
    [InteractiveWindowMessages.SettingsUpdated]: MessageType.other,
    [InteractiveWindowMessages.ShowBreak]: MessageType.other,
    [InteractiveWindowMessages.ShowingIp]: MessageType.other,
    [InteractiveWindowMessages.ShowContinue]: MessageType.other,
    [InteractiveWindowMessages.ShowDataViewer]: MessageType.other,
    [InteractiveWindowMessages.ShowPlot]: MessageType.other,
    [InteractiveWindowMessages.StartCell]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.StartDebugging]: MessageType.other,
    [InteractiveWindowMessages.StartProgress]: MessageType.other,
    [InteractiveWindowMessages.Started]: MessageType.other,
    [InteractiveWindowMessages.Step]: MessageType.other,
    [InteractiveWindowMessages.StopDebugging]: MessageType.other,
    [InteractiveWindowMessages.StopProgress]: MessageType.other,
    [InteractiveWindowMessages.SubmitNewCell]: MessageType.other,
    [InteractiveWindowMessages.Sync]: MessageType.other,
    [InteractiveWindowMessages.Undo]: MessageType.other,
    [InteractiveWindowMessages.UndoCommand]: MessageType.other,
    [InteractiveWindowMessages.RedoCommand]: MessageType.other,
    [InteractiveWindowMessages.UnfocusedCellEditor]: MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.UpdateCellWithExecutionResults]:
        MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.UpdateModel]: checkSyncUpdateModel,
    [InteractiveWindowMessages.UpdateKernel]: MessageType.syncAcrossSameNotebooks | MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.UpdateDisplayData]: MessageType.syncWithLiveShare,
    [InteractiveWindowMessages.VariableExplorerToggle]: MessageType.other,
    [InteractiveWindowMessages.SetVariableExplorerHeight]: MessageType.other,
    [InteractiveWindowMessages.VariableExplorerHeightResponse]: MessageType.other,
    [InteractiveWindowMessages.VariablesComplete]: MessageType.other,
    [InteractiveWindowMessages.ConvertUriForUseInWebViewRequest]: MessageType.other,
    [InteractiveWindowMessages.ConvertUriForUseInWebViewResponse]: MessageType.other,
    [InteractiveWindowMessages.UpdateExternalCellButtons]: MessageType.other,
    [InteractiveWindowMessages.ExecuteExternalCommand]: MessageType.other,
    // Types from CssMessages
    [CssMessages.GetCssRequest]: MessageType.other,
    [CssMessages.GetCssResponse]: MessageType.other,
    [CssMessages.GetMonacoThemeRequest]: MessageType.other,
    [CssMessages.GetMonacoThemeResponse]: MessageType.other,
    // Types from Shared Messages
    [SharedMessages.LocInit]: MessageType.other,
    [SharedMessages.Started]: MessageType.other,
    [SharedMessages.UpdateSettings]: MessageType.other,
    // IpyWidgets
    [IPyWidgetMessages.IPyWidgets_kernelOptions]: MessageType.syncAcrossSameNotebooks,
    [IPyWidgetMessages.IPyWidgets_Ready]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse]: MessageType.syncAcrossSameNotebooks,
    [IPyWidgetMessages.IPyWidgets_onKernelChanged]: MessageType.syncAcrossSameNotebooks,
    [IPyWidgetMessages.IPyWidgets_onRestartKernel]: MessageType.syncAcrossSameNotebooks,
    [IPyWidgetMessages.IPyWidgets_msg]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_binary_msg]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_msg_received]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_iopub_msg_handled]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_registerCommTarget]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_MessageHookCall]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_MessageHookResult]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_RegisterMessageHook]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_ExtensionOperationHandled]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_RemoveMessageHook]: MessageType.noIdea,
    [IPyWidgetMessages.IPyWidgets_mirror_execute]: MessageType.noIdea
};

/**
 * Function to check if a NotebookModelChange should be sync'd across editors or not
 */
function checkSyncUpdateModel(payload: NotebookModelChange): boolean {
    // Only sync user changes
    return payload.source === 'user';
}

/**
 * If the original message was a sync message, then do not send messages to extension.
 *  We allow messages to be sent to extension ONLY when the original message was triggered by the user.
 *
 * @export
 * @param {MessageType} [messageType]
 * @returns
 */
export function checkToPostBasedOnOriginalMessageType(messageType?: MessageType): boolean {
    if (!messageType) {
        return true;
    }
    if (
        (messageType & MessageType.syncAcrossSameNotebooks) === MessageType.syncAcrossSameNotebooks ||
        (messageType & MessageType.syncWithLiveShare) === MessageType.syncWithLiveShare
    ) {
        return false;
    }

    return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shouldRebroadcast(message: keyof IInteractiveWindowMapping, payload: any): [boolean, MessageType] {
    // Get the configured type for this message (whether it should be re-broadcasted or not).
    const messageTypeOrFunc: MessageType | undefined | MessageAction = messageWithMessageTypes[message];
    const messageType =
        typeof messageTypeOrFunc !== 'function' ? (messageTypeOrFunc as number) : MessageType.syncAcrossSameNotebooks;
    // Support for liveshare is turned off for now, we can enable that later.
    // I.e. we only support synchronizing across editors in the same session.
    if (
        messageType === undefined ||
        (messageType & MessageType.syncAcrossSameNotebooks) !== MessageType.syncAcrossSameNotebooks
    ) {
        return [false, MessageType.other];
    }

    if (typeof messageTypeOrFunc === 'function') {
        return [messageTypeOrFunc(payload), messageType];
    }

    return [
        (messageType & MessageType.syncAcrossSameNotebooks) > 0 || (messageType & MessageType.syncWithLiveShare) > 0,
        messageType
    ];
}
