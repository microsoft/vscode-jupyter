// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
//import { VariableViewPanelMessages } from '../../../../client/datascience/variablesView/variableViewPanelTypes';
import { InteractiveWindowMessages } from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { CssMessages, SharedMessages } from '../../../../client/datascience/messages';
import { CommonEffects } from '../../../interactive-common/redux/reducers/commonEffects';
import { Transfer } from '../../../interactive-common/redux/reducers/transfer';
import { CommonActionType } from '../../../interactive-common/redux/reducers/types';
//import { IInteractiveActionMapping } from '../mapping';
import { IVariableViewPanelActionMapping } from '../mapping';
import { Effects } from './effects';

// The list of reducers. 1 per message/action.
export const reducerMap: Partial<IVariableViewPanelActionMapping> = {
    // State updates
    [CommonActionType.SHOW_DATA_VIEWER]: Transfer.showDataViewer,
    [InteractiveWindowMessages.ShowPlot]: Transfer.showPlot,
    [CommonActionType.LINK_CLICK]: Transfer.linkClick,
    [InteractiveWindowMessages.Activate]: CommonEffects.activate,
    [CssMessages.GetCssResponse]: CommonEffects.handleCss,
    [SharedMessages.UpdateSettings]: Effects.updateSettings,
    [SharedMessages.LocInit]: CommonEffects.handleLocInit,
    [CommonActionType.EDITOR_LOADED]: Transfer.started
};
