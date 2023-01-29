// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IJupyterVariablesRequest } from '../../../../../kernels/variables/types';
import {
    IShowDataViewer,
    InteractiveWindowMessages,
    LoadIPyWidgetClassLoadAction,
    ILoadIPyWidgetClassFailureAction,
    NotifyIPyWidgetWidgetVersionNotSupportedAction
} from '../../../../../messageTypes';
import { BaseReduxActionPayload } from '../../../../types';
import { ActionWithPayload, ReducerArg } from '../../../react-common/reduxUtils';
import { IMainState } from '../../mainState';

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
    GET_VARIABLE_DATA = 'action.get_variable_data',
    LOAD_IPYWIDGET_CLASS_SUCCESS = 'action.load_ipywidget_class_success',
    LOAD_IPYWIDGET_CLASS_FAILURE = 'action.load_ipywidget_class_failure',
    IPYWIDGET_WIDGET_VERSION_NOT_SUPPORTED = 'action.ipywidget_widget_version_not_supported',
    LINK_CLICK = 'action.link_click',
    PostOutgoingMessage = 'action.postOutgoingMessage',
    RUN_BY_LINE = 'action.run_by_line',
    SET_VARIABLE_EXPLORER_HEIGHT = 'action.set_variable_explorer_height',
    SET_VARIABLE_VIEW_HEIGHT = 'action.set_variable_view_height',
    SHOW_DATA_VIEWER = 'action.show_data_viewer',
    SORT_VARIABLES = 'action.sort_variables',
    TOGGLE_VARIABLE_EXPLORER = 'action.toggle_variable_explorer',
    VARIABLE_VIEW_LOADED = 'action.variable_view_loaded'
}

export type CommonActionTypeMapping = {
    [CommonActionType.SHOW_DATA_VIEWER]: IShowDataViewerAction;
    [CommonActionType.LINK_CLICK]: ILinkClickAction;
    [CommonActionType.GET_VARIABLE_DATA]: IJupyterVariablesRequest;
    [CommonActionType.SORT_VARIABLES]: ISortVariablesRequest;
    [CommonActionType.TOGGLE_VARIABLE_EXPLORER]: never | undefined;
    [CommonActionType.SET_VARIABLE_EXPLORER_HEIGHT]: IVariableExplorerHeight;
    [CommonActionType.SET_VARIABLE_VIEW_HEIGHT]: IVariableViewHeight;
    [CommonActionType.PostOutgoingMessage]: never | undefined;
    [CommonActionType.LOAD_IPYWIDGET_CLASS_SUCCESS]: LoadIPyWidgetClassLoadAction;
    [CommonActionType.LOAD_IPYWIDGET_CLASS_FAILURE]: ILoadIPyWidgetClassFailureAction;
    [CommonActionType.IPYWIDGET_WIDGET_VERSION_NOT_SUPPORTED]: NotifyIPyWidgetWidgetVersionNotSupportedAction;
    [CommonActionType.RUN_BY_LINE]: ICellAction;
    [CommonActionType.VARIABLE_VIEW_LOADED]: never | undefined;
};

export interface IShowDataViewerAction extends IShowDataViewer {}

export interface ILinkClickAction {
    href: string;
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
export interface IShowDataViewerAction extends IShowDataViewer {}

export interface IVariableExplorerHeight {
    containerHeight: number;
    gridHeight: number;
}

export interface IVariableViewHeight {
    viewHeight: number;
}

export type CommonAction<T = never | undefined> = ActionWithPayload<T, CommonActionType | InteractiveWindowMessages>;

export type ISortVariablesRequest = {
    sortColumn: string;
    sortAscending: boolean;
};
