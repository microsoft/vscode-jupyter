// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InteractiveWindowMessages, SharedMessages } from '../../../../../messageTypes';
import { CommonEffects } from '../../../interactive-common/redux/reducers/commonEffects';
import { Transfer } from '../../../interactive-common/redux/reducers/transfer';
import { CommonActionType } from '../../../interactive-common/redux/reducers/types';
import { IVariableViewPanelActionMapping } from '../mapping';

// Map of actions to reducers for the VariableViewPanel
export const reducerMap: Partial<IVariableViewPanelActionMapping> = {
    [CommonActionType.SHOW_DATA_VIEWER]: Transfer.showDataViewer,
    [CommonActionType.LINK_CLICK]: Transfer.linkClick,
    [InteractiveWindowMessages.Activate]: CommonEffects.activate,
    [SharedMessages.LocInit]: CommonEffects.handleLocInit,
    [CommonActionType.VARIABLE_VIEW_LOADED]: Transfer.variableViewStarted,
    [InteractiveWindowMessages.GetHTMLByIdRequest]: CommonEffects.getHTMLByIdRequest
};
