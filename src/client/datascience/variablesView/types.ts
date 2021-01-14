import { Event } from 'vscode';
import { IVariableExplorerHeight } from '../../../datascience-ui/interactive-common/redux/reducers/types';
import {
    IFinishCell,
    InteractiveWindowMessages,
    IShowDataViewer
} from '../../datascience/interactive-common/interactiveWindowTypes';
import { CssMessages, IGetCssRequest, IGetCssResponse, SharedMessages } from '../messages';
import { IJupyterVariablesRequest, IJupyterVariablesResponse, INotebook, IVSCWebviewViewProvider } from '../types';
import { VariableView } from './variableView';

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
    public [InteractiveWindowMessages.FinishCell]: IFinishCell;
    public [InteractiveWindowMessages.UpdateVariableViewExecutionCount]: { executionCount: number };
    public [InteractiveWindowMessages.GetHTMLByIdRequest]: string;
    public [InteractiveWindowMessages.GetHTMLByIdResponse]: string;
}

export const INotebookWatcher = Symbol('INotebookWatcher');
export interface INotebookWatcher {
    readonly activeVariableViewNotebook?: INotebook;
    readonly onDidChangeActiveVariableViewNotebook: Event<INotebook | undefined>;
    readonly onDidExecuteActiveVariableViewNotebook: Event<{ executionCount: number }>;
}

export const IVariableViewProvider = Symbol('IVariableViewProvider');
export interface IVariableViewProvider extends IVSCWebviewViewProvider {
    //activeVariableView?: VariableView;
    //readonly onDidResolveWebview: Event<VariableView>;
    readonly activeVariableView: Promise<VariableView>;
}
