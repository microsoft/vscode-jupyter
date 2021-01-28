// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { NativeKeyboardCommandTelemetry, NativeMouseCommandTelemetry } from '../../../../client/datascience/constants';
import {
    IEditorContentChange,
    InteractiveWindowMessages,
    IShowDataViewer
} from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { BaseReduxActionPayload } from '../../../../client/datascience/interactive-common/types';
import { IJupyterVariablesRequest } from '../../../../client/datascience/types';
import { ActionWithPayload, ReducerArg } from '../../../react-common/reduxUtils';
import { CursorPos, IMainState } from '../../mainState';

/**
 * How to add a new state change:
 * 1) Add a new <name> to CommonActionType (preferably `InteractiveWindowMessages` - to keep messages in the same place).
 * 2) Add a new interface (or reuse 1 below) if the action takes any parameters (ex: ICellAction)
 * 3) Add a new actionCreator function (this is how you use it from a react control) to the
 *    appropriate actionCreator list (one for native and one for interactive).
 *    The creator should 'create' an instance of the action.
 * 4) Add an entry into the appropriate mapping.ts. This is how the type of the list of reducers is enforced.
 * 5) Add a new handler for the action under the 'reducer's folder. Handle the expected state change
 * 6) Add the handler to the main reducer map in reducers\index.ts
 */
export enum CommonActionType {
    ADD_AND_FOCUS_NEW_CELL = 'action.add_new_cell_and_focus_cell',
    INSERT_ABOVE_AND_FOCUS_NEW_CELL = 'action.insert_above_and_focus_cell',
    INSERT_BELOW_AND_FOCUS_NEW_CELL = 'action.insert_below_and_focus_cell',
    INSERT_ABOVE_FIRST_AND_FOCUS_NEW_CELL = 'action.insert_above_first_and_focus_cell',
    ADD_NEW_CELL = 'action.add_new_cell',
    ARROW_DOWN = 'action.arrow_down',
    ARROW_UP = 'action.arrow_up',
    CHANGE_CELL_TYPE = 'action.change_cell_type',
    CLICK_CELL = 'action.click_cell',
    CODE_CREATED = 'action.code_created',
    CONTINUE = 'action.continue',
    COPY_CELL_CODE = 'action.copy_cell_code',
    DELETE_CELL = 'action.delete_cell',
    EDITOR_LOADED = 'action.editor_loaded',
    EDIT_CELL = 'action.edit_cell',
    EXECUTE_ABOVE = 'action.execute_above',
    EXECUTE_ALL_CELLS = 'action.execute_all_cells',
    EXECUTE_CELL = 'action.execute_cell',
    EXECUTE_CELL_AND_ADVANCE = 'action.execute_cell_and_advance',
    EXECUTE_CELL_AND_BELOW = 'action.execute_cell_and_below',
    EXPORT = 'action.export',
    EXPORT_NOTEBOOK_AS = 'action.export_As',
    FOCUS_CELL = 'action.focus_cell',
    FOCUS_INPUT = 'action.focus_input',
    GET_VARIABLE_DATA = 'action.get_variable_data',
    GOTO_CELL = 'action.goto_cell',
    INSERT_ABOVE = 'action.insert_above',
    INSERT_ABOVE_FIRST = 'action.insert_above_first',
    INSERT_BELOW = 'action.insert_below',
    INTERRUPT_KERNEL = 'action.interrupt_kernel_action',
    IPYWIDGET_RENDER_FAILURE = 'action.ipywidget_render_failure',
    LAUNCH_NOTEBOOK_TRUST_PROMPT = 'action.launch_notebook_trust_prompt',
    LOAD_IPYWIDGET_CLASS_SUCCESS = 'action.load_ipywidget_class_success',
    LOAD_IPYWIDGET_CLASS_FAILURE = 'action.load_ipywidget_class_failure',
    IPYWIDGET_WIDGET_VERSION_NOT_SUPPORTED = 'action.ipywidget_widget_version_not_supported',
    LOADED_ALL_CELLS = 'action.loaded_all_cells',
    LINK_CLICK = 'action.link_click',
    MOVE_CELL_DOWN = 'action.move_cell_down',
    MOVE_CELL_UP = 'action.move_cell_up',
    OPEN_SETTINGS = 'action.open_settings',
    PostOutgoingMessage = 'action.postOutgoingMessage',
    REDO = 'action.redo',
    REFRESH_VARIABLES = 'action.refresh_variables',
    RESTART_KERNEL = 'action.restart_kernel_action',
    RUN_BY_LINE = 'action.run_by_line',
    SAVE = 'action.save',
    SCROLL = 'action.scroll',
    SELECT_CELL = 'action.select_cell',
    SELECT_SERVER = 'action.select_server',
    SET_VARIABLE_EXPLORER_HEIGHT = 'action.set_variable_explorer_height',
    SET_VARIABLE_VIEW_HEIGHT = 'action.set_variable_view_height',
    SEND_COMMAND = 'action.send_command',
    SHOW_DATA_VIEWER = 'action.show_data_viewer',
    STEP = 'action.step',
    SUBMIT_INPUT = 'action.submit_input',
    TOGGLE_INPUT_BLOCK = 'action.toggle_input_block',
    TOGGLE_LINE_NUMBERS = 'action.toggle_line_numbers',
    TOGGLE_OUTPUT = 'action.toggle_output',
    TOGGLE_VARIABLE_EXPLORER = 'action.toggle_variable_explorer',
    UNDO = 'action.undo',
    UNFOCUS_CELL = 'action.unfocus_cell',
    UNMOUNT = 'action.unmount',
    VARIABLE_VIEW_LOADED = 'action.variable_view_loaded'
}

export type CommonActionTypeMapping = {
    [CommonActionType.ADD_AND_FOCUS_NEW_CELL]: IAddCellAction;
    [CommonActionType.INSERT_ABOVE]: ICellAction & IAddCellAction;
    [CommonActionType.INSERT_BELOW]: ICellAction & IAddCellAction;
    [CommonActionType.INSERT_ABOVE_FIRST]: IAddCellAction;
    [CommonActionType.INSERT_ABOVE_FIRST_AND_FOCUS_NEW_CELL]: IAddCellAction;
    [CommonActionType.INSERT_BELOW_AND_FOCUS_NEW_CELL]: ICellAction & IAddCellAction;
    [CommonActionType.INSERT_ABOVE_AND_FOCUS_NEW_CELL]: ICellAction & IAddCellAction;
    [CommonActionType.FOCUS_CELL]: ICellAndCursorAction;
    [CommonActionType.UNFOCUS_CELL]: ICellAction | ICodeAction;
    [CommonActionType.ADD_NEW_CELL]: IAddCellAction;
    [CommonActionType.EDIT_CELL]: IEditCellAction;
    [CommonActionType.EXECUTE_CELL_AND_ADVANCE]: IExecuteAction;
    [CommonActionType.EXECUTE_CELL]: IExecuteAction;
    [CommonActionType.EXECUTE_ALL_CELLS]: never | undefined;
    [CommonActionType.EXECUTE_ABOVE]: ICellAction;
    [CommonActionType.EXECUTE_CELL_AND_BELOW]: IExecuteAction;
    [CommonActionType.RESTART_KERNEL]: never | undefined;
    [CommonActionType.INTERRUPT_KERNEL]: never | undefined;
    [CommonActionType.EXPORT]: never | undefined;
    [CommonActionType.EXPORT_NOTEBOOK_AS]: never | undefined;
    [CommonActionType.SAVE]: never | undefined;
    [CommonActionType.SHOW_DATA_VIEWER]: IShowDataViewerAction;
    [CommonActionType.SEND_COMMAND]: ISendCommandAction;
    [CommonActionType.SELECT_CELL]: ICellAndCursorAction;
    [CommonActionType.MOVE_CELL_UP]: ICellAction;
    [CommonActionType.MOVE_CELL_DOWN]: ICellAction;
    [CommonActionType.TOGGLE_LINE_NUMBERS]: ICellAction;
    [CommonActionType.TOGGLE_OUTPUT]: ICellAction;
    [CommonActionType.ARROW_UP]: ICodeAction;
    [CommonActionType.ARROW_DOWN]: ICodeAction;
    [CommonActionType.CHANGE_CELL_TYPE]: IChangeCellTypeAction;
    [CommonActionType.LINK_CLICK]: ILinkClickAction;
    [CommonActionType.GOTO_CELL]: ICellAction;
    [CommonActionType.TOGGLE_INPUT_BLOCK]: ICellAction;
    [CommonActionType.SUBMIT_INPUT]: ICodeAction;
    [CommonActionType.SCROLL]: IScrollAction;
    [CommonActionType.CLICK_CELL]: ICellAction;
    [CommonActionType.COPY_CELL_CODE]: ICellAction;
    [CommonActionType.DELETE_CELL]: ICellAction;
    [CommonActionType.EDITOR_LOADED]: never | undefined;
    [CommonActionType.LOADED_ALL_CELLS]: never | undefined;
    [CommonActionType.UNMOUNT]: never | undefined;
    [CommonActionType.SELECT_SERVER]: never | undefined;
    [CommonActionType.CODE_CREATED]: ICodeCreatedAction;
    [CommonActionType.GET_VARIABLE_DATA]: IJupyterVariablesRequest;
    [CommonActionType.TOGGLE_VARIABLE_EXPLORER]: never | undefined;
    [CommonActionType.SET_VARIABLE_EXPLORER_HEIGHT]: IVariableExplorerHeight;
    [CommonActionType.SET_VARIABLE_VIEW_HEIGHT]: IVariableViewHeight;
    [CommonActionType.PostOutgoingMessage]: never | undefined;
    [CommonActionType.REFRESH_VARIABLES]: never | undefined;
    [CommonActionType.OPEN_SETTINGS]: IOpenSettingsAction;
    [CommonActionType.FOCUS_INPUT]: never | undefined;
    [CommonActionType.LAUNCH_NOTEBOOK_TRUST_PROMPT]: never | undefined;
    [CommonActionType.LOAD_IPYWIDGET_CLASS_SUCCESS]: LoadIPyWidgetClassLoadAction;
    [CommonActionType.LOAD_IPYWIDGET_CLASS_FAILURE]: ILoadIPyWidgetClassFailureAction;
    [CommonActionType.IPYWIDGET_WIDGET_VERSION_NOT_SUPPORTED]: NotifyIPyWidgeWidgetVersionNotSupportedAction;
    [CommonActionType.IPYWIDGET_RENDER_FAILURE]: Error;
    [CommonActionType.STEP]: ICellAction;
    [CommonActionType.CONTINUE]: ICellAction;
    [CommonActionType.RUN_BY_LINE]: ICellAction;
    [CommonActionType.VARIABLE_VIEW_LOADED]: never | undefined;
    [CommonActionType.UNDO]: never | undefined;
    [CommonActionType.REDO]: never | undefined;
};

export interface IShowDataViewerAction extends IShowDataViewer {}

export interface ILinkClickAction {
    href: string;
}

export interface IScrollAction {
    isAtBottom: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CommonReducerArg<AT = CommonActionType | InteractiveWindowMessages, T = never | undefined> = ReducerArg<
    IMainState,
    AT,
    BaseReduxActionPayload<T>
>;

export interface ICellAction {
    cellId: string | undefined;
}

export interface IAddCellAction {
    /**
     * Id of the new cell that is to be added.
     * If none provided, then generate a new id.
     */
    newCellId: string;
}

export interface ICodeAction extends ICellAction {
    code: string;
}

export interface IEditCellAction extends ICodeAction {
    forward: IEditorContentChange[];
    reverse: IEditorContentChange[];
    id: string;
    modelId: string;
    version: number;
}

// I.e. when using the operation `add`, we need the corresponding `IAddCellAction`.
// They are mutually exclusive, if not `add`, then there's no `newCellId`.
export type IExecuteAction = ICellAction & {
    code: string;
    moveOp: 'select' | 'none' | 'add';
};

export interface ICodeCreatedAction extends ICellAction {
    modelId: string;
}

export interface ICellAndCursorAction extends ICellAction {
    cursorPos: CursorPos;
}

export interface IRefreshVariablesAction {
    newExecutionCount?: number;
}

export interface IShowDataViewerAction extends IShowDataViewer {}

export interface ISendCommandAction {
    command: NativeKeyboardCommandTelemetry | NativeMouseCommandTelemetry;
}

export interface IChangeCellTypeAction {
    cellId: string;
}

export interface IOpenSettingsAction {
    setting: string | undefined;
}

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

export interface IVariableExplorerHeight {
    containerHeight: number;
    gridHeight: number;
}

export interface IVariableViewHeight {
    viewHeight: number;
}

export type LoadIPyWidgetClassDisabledAction = {
    className: string;
    moduleName: string;
    moduleVersion: string;
};

export type LoadIPyWidgetClassLoadAction = {
    className: string;
    moduleName: string;
    moduleVersion: string;
};
export type NotifyIPyWidgeWidgetVersionNotSupportedAction = {
    moduleName: 'qgrid';
    moduleVersion: string;
};

export type CommonAction<T = never | undefined> = ActionWithPayload<T, CommonActionType | InteractiveWindowMessages>;
