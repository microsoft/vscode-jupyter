// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { InteractiveWindowMessages } from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { CssMessages, SharedMessages } from '../../../../client/datascience/messages';
import { CommonEffects } from '../../../interactive-common/redux/reducers/commonEffects';
import { Transfer } from '../../../interactive-common/redux/reducers/transfer';
import { CommonActionType } from '../../../interactive-common/redux/reducers/types';
import { IVariableViewPanelActionMapping } from '../mapping';
import { Effects } from './effects';

// Map of actions to reducers for the VariableViewPanel
export const reducerMap: Partial<IVariableViewPanelActionMapping> = {
    [CommonActionType.SHOW_DATA_VIEWER]: Transfer.showDataViewer,
    [InteractiveWindowMessages.ShowPlot]: Transfer.showPlot,
    [CommonActionType.LINK_CLICK]: Transfer.linkClick,
    [InteractiveWindowMessages.Activate]: CommonEffects.activate,
    [CssMessages.GetCssResponse]: CommonEffects.handleCss,
    [SharedMessages.UpdateSettings]: Effects.updateSettings,
    [SharedMessages.LocInit]: CommonEffects.handleLocInit,
    [CommonActionType.EDITOR_LOADED]: Transfer.started
};
