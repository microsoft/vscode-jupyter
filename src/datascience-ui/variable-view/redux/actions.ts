// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import {
    IInteractiveWindowMapping,
    InteractiveWindowMessages
} from '../../../client/datascience/interactive-common/interactiveWindowTypes';
import { IJupyterVariable, IJupyterVariablesRequest } from '../../../client/datascience/types';
import {
    CommonAction,
    CommonActionType,
    CommonActionTypeMapping,
    ILinkClickAction,
    IShowDataViewerAction,
    IVariableExplorerHeight
} from '../../interactive-common/redux/reducers/types';

// This function isn't made common and not exported, to ensure it isn't used elsewhere.
function createIncomingActionWithPayload<
    M extends IInteractiveWindowMapping & CommonActionTypeMapping,
    K extends keyof M
>(type: K, data: M[K]): CommonAction<M[K]> {
    // tslint:disable-next-line: no-any
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
    setVariableExplorerHeight: (containerHeight: number, gridHeight: number): CommonAction<IVariableExplorerHeight> =>
        createIncomingActionWithPayload(CommonActionType.SET_VARIABLE_EXPLORER_HEIGHT, { containerHeight, gridHeight }),
    showDataViewer: (variable: IJupyterVariable, columnSize: number): CommonAction<IShowDataViewerAction> =>
        createIncomingActionWithPayload(CommonActionType.SHOW_DATA_VIEWER, { variable, columnSize }),
    editorLoaded: (): CommonAction => createIncomingAction(CommonActionType.EDITOR_LOADED),
    editorUnmounted: (): CommonAction => createIncomingAction(CommonActionType.UNMOUNT),
    getVariableData: (
        newExecutionCount: number,
        refreshCount: number,
        startIndex: number = 0,
        pageSize: number = 100
    ): CommonAction<IJupyterVariablesRequest> =>
        createIncomingActionWithPayload(CommonActionType.GET_VARIABLE_DATA, {
            executionCount: newExecutionCount,
            sortColumn: 'name',
            sortAscending: true,
            startIndex,
            pageSize,
            refreshCount
        })
};
