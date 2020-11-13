import { IVariableExplorerHeight } from '../../../datascience-ui/interactive-common/redux/reducers/types';
import { CssMessages, IGetCssRequest, IGetCssResponse, SharedMessages } from '../messages';
import { IJupyterVariable, IJupyterVariablesRequest, IJupyterVariablesResponse } from '../types';

export interface IShowDataViewer {
    variable: IJupyterVariable;
    columnSize: number;
}

//export enum VariableViewPanelMessages {
//Activate = 'activate',
//SettingsUpdated = 'settings_updated',
//ShowDataViewer = 'show_data_explorer',
//GetVariablesRequest = 'get_variables_request',
//GetVariablesResponse = 'get_variables_response',
//VariableExplorerToggle = 'variable_explorer_toggle',
//SetVariableExplorerHeight = 'set_variable_explorer_height',
//VariableExplorerHeightResponse = 'variable_explorer_height_response',
//ForceVariableRefresh = 'force_variable_refresh',
//OpenLink = 'open_link',
//ShowPlot = 'show_plot',
//VariablesComplete = 'variables_complete'
//}

//// Map all messages to specific payloads
//export class IVariableViewPanelMapping {
//public [VariableViewPanelMessages.ForceVariableRefresh]: never | undefined;
//public [VariableViewPanelMessages.SettingsUpdated]: string;
//public [VariableViewPanelMessages.Activate]: never | undefined;
//public [VariableViewPanelMessages.ShowDataViewer]: IShowDataViewer;
//public [VariableViewPanelMessages.GetVariablesRequest]: IJupyterVariablesRequest;
//public [VariableViewPanelMessages.GetVariablesResponse]: IJupyterVariablesResponse;
//public [VariableViewPanelMessages.VariableExplorerToggle]: boolean;
//public [VariableViewPanelMessages.SetVariableExplorerHeight]: IVariableExplorerHeight;
//public [VariableViewPanelMessages.VariableExplorerHeightResponse]: IVariableExplorerHeight;
//public [CssMessages.GetCssRequest]: IGetCssRequest;
//public [CssMessages.GetCssResponse]: IGetCssResponse;
//public [VariableViewPanelMessages.OpenLink]: string | undefined;
//public [VariableViewPanelMessages.ShowPlot]: string | undefined;
//public [VariableViewPanelMessages.VariablesComplete]: never | undefined;
//public [SharedMessages.UpdateSettings]: string;
//public [SharedMessages.LocInit]: string;
//}
