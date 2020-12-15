import { IVariableExplorerHeight } from '../../../datascience-ui/interactive-common/redux/reducers/types';
import {
    InteractiveWindowMessages,
    IShowDataViewer
} from '../../datascience/interactive-common/interactiveWindowTypes';
import { CssMessages, IGetCssRequest, IGetCssResponse, SharedMessages } from '../messages';
import { IJupyterVariablesRequest, IJupyterVariablesResponse, IVSCWebviewViewProvider } from '../types';

// Mapping of Message to payload that our VariableViewPanel needs to support
export class IVariableViewPanelMapping {
    public [InteractiveWindowMessages.ForceVariableRefresh]: never | undefined;
    public [InteractiveWindowMessages.SettingsUpdated]: string;
    public [InteractiveWindowMessages.Activate]: never | undefined;
    public [InteractiveWindowMessages.ShowDataViewer]: IShowDataViewer;
    public [InteractiveWindowMessages.GetVariablesRequest]: IJupyterVariablesRequest;
    public [InteractiveWindowMessages.GetVariablesResponse]: IJupyterVariablesResponse;
    public [InteractiveWindowMessages.VariableExplorerToggle]: boolean;
    public [InteractiveWindowMessages.SetVariableExplorerHeight]: IVariableExplorerHeight;
    public [InteractiveWindowMessages.VariableExplorerHeightResponse]: IVariableExplorerHeight;
    public [CssMessages.GetCssRequest]: IGetCssRequest;
    public [CssMessages.GetCssResponse]: IGetCssResponse;
    public [InteractiveWindowMessages.OpenLink]: string | undefined;
    public [InteractiveWindowMessages.VariablesComplete]: never | undefined;
    public [SharedMessages.UpdateSettings]: string;
    public [SharedMessages.LocInit]: string;
}

export const IVariableViewProvider = Symbol('IVariableViewProvider');
export interface IVariableViewProvider extends IVSCWebviewViewProvider {}
