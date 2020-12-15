// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { InteractiveWindowMessages } from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { CssMessages, SharedMessages } from '../../../../client/datascience/messages';
import { Effects } from '../../../history-react/redux/reducers/effects'; // Reuse the updateSettings from history-react
import { CommonEffects } from '../../../interactive-common/redux/reducers/commonEffects';
import { Transfer } from '../../../interactive-common/redux/reducers/transfer';
import { CommonActionType } from '../../../interactive-common/redux/reducers/types';
import { IVariableViewPanelActionMapping } from '../mapping';

// Map of actions to reducers for the VariableViewPanel
export const reducerMap: Partial<IVariableViewPanelActionMapping> = {
    [CommonActionType.SHOW_DATA_VIEWER]: Transfer.showDataViewer,
    [CommonActionType.LINK_CLICK]: Transfer.linkClick,
    [InteractiveWindowMessages.Activate]: CommonEffects.activate,
    [CssMessages.GetCssResponse]: CommonEffects.handleCss,
    [SharedMessages.UpdateSettings]: Effects.updateSettings,
    [SharedMessages.LocInit]: CommonEffects.handleLocInit,
    [CommonActionType.VARIABLE_VIEW_LOADED]: Transfer.variableViewStarted
};
