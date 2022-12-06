// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IJupyterVariable, IJupyterVariablesRequest } from '../../../../kernels/variables/types';
import { IInteractiveWindowMapping, InteractiveWindowMessages } from '../../../../messageTypes';
import {
    CommonAction,
    CommonActionType,
    CommonActionTypeMapping,
    ILinkClickAction,
    IShowDataViewerAction,
    ISortVariablesRequest,
    IVariableExplorerHeight,
    IVariableViewHeight
} from '../../interactive-common/redux/reducers/types';

// This function isn't made common and not exported, to ensure it isn't used elsewhere.
function createIncomingActionWithPayload<
    M extends IInteractiveWindowMapping & CommonActionTypeMapping,
    K extends keyof M
>(type: K, data: M[K]): CommonAction<M[K]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { type, payload: { data, messageDirection: 'incoming' } as any } as any;
}
// This function isn't made common and not exported, to ensure it isn't used elsewhere.
function createIncomingAction(type: CommonActionType | InteractiveWindowMessages): CommonAction {
    return { type, payload: { messageDirection: 'incoming', data: undefined } };
}

// Trim the list of interactive window actions down to just what the variable view panel suppports
export const actionCreators = {
    linkClick: (href: string): CommonAction<ILinkClickAction> =>
        createIncomingActionWithPayload(CommonActionType.LINK_CLICK, { href }),
    toggleVariableExplorer: (): CommonAction => createIncomingAction(CommonActionType.TOGGLE_VARIABLE_EXPLORER),
    sort: (sortColumn: string, sortAscending: boolean): CommonAction<ISortVariablesRequest> =>
        createIncomingActionWithPayload(CommonActionType.SORT_VARIABLES, { sortColumn, sortAscending }),
    setVariableExplorerHeight: (containerHeight: number, gridHeight: number): CommonAction<IVariableExplorerHeight> =>
        createIncomingActionWithPayload(CommonActionType.SET_VARIABLE_EXPLORER_HEIGHT, { containerHeight, gridHeight }),
    setVariableViewHeight: (viewHeight: number): CommonAction<IVariableViewHeight> =>
        createIncomingActionWithPayload(CommonActionType.SET_VARIABLE_VIEW_HEIGHT, { viewHeight }),
    showDataViewer: (variable: IJupyterVariable, columnSize: number): CommonAction<IShowDataViewerAction> =>
        createIncomingActionWithPayload(CommonActionType.SHOW_DATA_VIEWER, { variable, columnSize }),
    variableViewLoaded: (): CommonAction => createIncomingAction(CommonActionType.VARIABLE_VIEW_LOADED),
    getVariableData: (
        newExecutionCount: number,
        refreshCount: number,
        startIndex: number = 0,
        pageSize: number = 100,
        sortColumn: string = 'name',
        sortAscending: boolean = true
    ): CommonAction<IJupyterVariablesRequest> =>
        createIncomingActionWithPayload(CommonActionType.GET_VARIABLE_DATA, {
            executionCount: newExecutionCount,
            sortColumn: sortColumn,
            sortAscending: sortAscending,
            startIndex,
            pageSize,
            refreshCount
        })
};
