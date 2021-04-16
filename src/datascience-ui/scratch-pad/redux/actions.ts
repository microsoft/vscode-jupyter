// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import {
    IInteractiveWindowMapping,
    InteractiveWindowMessages
} from '../../../client/datascience/interactive-common/interactiveWindowTypes';
import {
    ICell,
    IExternalCommandFromWebview,
    IJupyterVariable,
    IJupyterVariablesRequest
} from '../../../client/datascience/types';
import { CursorPos } from '../../interactive-common/mainState';
import {
    CommonAction,
    CommonActionType,
    CommonActionTypeMapping,
    ICellAction,
    ICellAndCursorAction,
    ICodeCreatedAction,
    IEditCellAction,
    ILinkClickAction,
    IOpenSettingsAction,
    IShowDataViewerAction
} from '../../interactive-common/redux/reducers/types';
import { IMonacoModelContentChangeEvent } from '../../react-common/monacoHelpers';

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

// See https://react-redux.js.org/using-react-redux/connect-mapdispatch#defining-mapdispatchtoprops-as-an-object
export const actionCreators = {
    executeCell: (cellId: string, code: string, moveOp: 'add' | 'select' | 'none') =>
        createIncomingActionWithPayload(CommonActionType.EXECUTE_CELL_AND_ADVANCE, { cellId, code, moveOp }),
    focusCell: (cellId: string, cursorPos: CursorPos = CursorPos.Current): CommonAction<ICellAndCursorAction> =>
        createIncomingActionWithPayload(CommonActionType.FOCUS_CELL, { cellId, cursorPos }),
    unfocusCell: (cellId: string, code: string) =>
        createIncomingActionWithPayload(CommonActionType.UNFOCUS_CELL, { cellId, code }),
    copyCellCode: (cellId: string): CommonAction<ICellAction> =>
        createIncomingActionWithPayload(CommonActionType.COPY_CELL_CODE, { cellId }),
    selectCell: (cellId: string, cursorPos: CursorPos = CursorPos.Current): CommonAction<ICellAndCursorAction> =>
        createIncomingActionWithPayload(CommonActionType.SELECT_CELL, { cellId, cursorPos }),
    restartKernel: (): CommonAction => createIncomingAction(CommonActionType.RESTART_KERNEL),
    interruptKernel: (): CommonAction => createIncomingAction(CommonActionType.INTERRUPT_KERNEL),
    clearAllOutputs: (): CommonAction => createIncomingAction(InteractiveWindowMessages.ClearAllOutputs),
    export: (): CommonAction => createIncomingAction(CommonActionType.EXPORT),
    exportAs: (): CommonAction => createIncomingAction(CommonActionType.EXPORT_NOTEBOOK_AS),
    save: (): CommonAction => createIncomingAction(CommonActionType.SAVE),
    showDataViewer: (variable: IJupyterVariable, columnSize: number): CommonAction<IShowDataViewerAction> =>
        createIncomingActionWithPayload(CommonActionType.SHOW_DATA_VIEWER, { variable, columnSize }),
    changeCellType: (cellId: string) => createIncomingActionWithPayload(CommonActionType.CHANGE_CELL_TYPE, { cellId }),
    toggleLineNumbers: (cellId: string): CommonAction<ICellAction> =>
        createIncomingActionWithPayload(CommonActionType.TOGGLE_LINE_NUMBERS, { cellId }),
    toggleOutput: (cellId: string): CommonAction<ICellAction> =>
        createIncomingActionWithPayload(CommonActionType.TOGGLE_OUTPUT, { cellId }),
    editCell: (cellId: string, e: IMonacoModelContentChangeEvent): CommonAction<IEditCellAction> =>
        createIncomingActionWithPayload(CommonActionType.EDIT_CELL, {
            cellId,
            version: e.versionId,
            modelId: e.model.id,
            forward: e.forward,
            reverse: e.reverse,
            id: cellId,
            code: e.model.getValue()
        }),
    linkClick: (href: string): CommonAction<ILinkClickAction> =>
        createIncomingActionWithPayload(CommonActionType.LINK_CLICK, { href }),
    showPlot: (imageHtml: string) => createIncomingActionWithPayload(InteractiveWindowMessages.ShowPlot, imageHtml),
    editorLoaded: (): CommonAction => createIncomingAction(CommonActionType.EDITOR_LOADED),
    codeCreated: (cellId: string | undefined, modelId: string): CommonAction<ICodeCreatedAction> =>
        createIncomingActionWithPayload(CommonActionType.CODE_CREATED, { cellId, modelId }),
    loadedAllCells: (): CommonAction => createIncomingAction(CommonActionType.LOADED_ALL_CELLS),
    editorUnmounted: (): CommonAction => createIncomingAction(CommonActionType.UNMOUNT),
    selectKernel: (): CommonAction => createIncomingAction(InteractiveWindowMessages.SelectKernel),
    selectServer: (): CommonAction => createIncomingAction(CommonActionType.SELECT_SERVER),
    launchNotebookTrustPrompt: (): CommonAction => createIncomingAction(CommonActionType.LAUNCH_NOTEBOOK_TRUST_PROMPT),
    openSettings: (setting?: string): CommonAction<IOpenSettingsAction> =>
        createIncomingActionWithPayload(CommonActionType.OPEN_SETTINGS, { setting }),
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
        }),
    widgetFailed: (ex: Error): CommonAction<Error> =>
        createIncomingActionWithPayload(CommonActionType.IPYWIDGET_RENDER_FAILURE, ex),
    runExternalCommand: (buttonId: string, cell: ICell): CommonAction<IExternalCommandFromWebview> =>
        createIncomingActionWithPayload(InteractiveWindowMessages.ExecuteExternalCommand, { buttonId, cell })
};
