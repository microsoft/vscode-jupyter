import { IVariableExplorerHeight } from '../../../datascience-ui/interactive-common/redux/reducers/types';
import {
    InteractiveWindowMessages,
    IShowDataViewer
} from '../../datascience/interactive-common/interactiveWindowTypes';
import { CssMessages, IGetCssRequest, IGetCssResponse, IGetMonacoThemeRequest, SharedMessages } from '../messages';
import { IGetMonacoThemeResponse } from '../monacoMessages';
import { IJupyterVariablesRequest, IJupyterVariablesResponse, IVSCWebviewViewProvider } from '../types';

//export namespace VariableViewMessages {
//export const Started = SharedMessages.Started;
//export const UpdateSettings = SharedMessages.UpdateSettings;
//}

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
    public [CssMessages.GetMonacoThemeRequest]: IGetMonacoThemeRequest; // Needed for started message
    public [CssMessages.GetMonacoThemeResponse]: IGetMonacoThemeResponse;
    public [InteractiveWindowMessages.OpenLink]: string | undefined;
    public [InteractiveWindowMessages.ShowPlot]: string | undefined;
    public [InteractiveWindowMessages.VariablesComplete]: never | undefined;
    public [SharedMessages.UpdateSettings]: string;
    public [SharedMessages.LocInit]: string;
}

// Map all messages to specific payloads
//export class IVariableViewMapping {
//public [VariableViewMessages.Started]: never | undefined;
//public [VariableViewMessages.UpdateSettings]: string;
//public [CssMessages.GetCssRequest]: IGetCssRequest;
//public [CssMessages.GetCssResponse]: IGetCssResponse;
//}

//export class IVariableViewMapping {
//public [InteractiveWindowMessages.ForceVariableRefresh]: never | undefined;
//public [InteractiveWindowMessages.FinishCell]: IFinishCell;
//public [InteractiveWindowMessages.UpdateCellWithExecutionResults]: ICell;
//public [InteractiveWindowMessages.GotoCodeCell]: IGotoCode;
//public [InteractiveWindowMessages.CopyCodeCell]: ICopyCode;
//public [InteractiveWindowMessages.NotebookExecutionActivated]: INotebookIdentity & { owningResource: Resource };
//public [InteractiveWindowMessages.RestartKernel]: never | undefined;
//public [InteractiveWindowMessages.SelectKernel]: IServerState | undefined;
//public [InteractiveWindowMessages.SelectJupyterServer]: never | undefined;
//public [InteractiveWindowMessages.OpenSettings]: string | undefined;
//public [InteractiveWindowMessages.Export]: ICell[];
//public [InteractiveWindowMessages.ExportNotebookAs]: ICell[];
//public [InteractiveWindowMessages.GetAllCells]: never | undefined;
//public [InteractiveWindowMessages.ReturnAllCells]: ICell[];
//public [InteractiveWindowMessages.DeleteAllCells]: IAddCellAction;
//public [InteractiveWindowMessages.Undo]: never | undefined;
//public [InteractiveWindowMessages.Redo]: never | undefined;
//public [InteractiveWindowMessages.ExpandAll]: never | undefined;
//public [InteractiveWindowMessages.CollapseAll]: never | undefined;
//public [InteractiveWindowMessages.StartProgress]: never | undefined;
//public [InteractiveWindowMessages.StopProgress]: never | undefined;
//public [InteractiveWindowMessages.Interrupt]: never | undefined;
//public [InteractiveWindowMessages.SettingsUpdated]: string;
//public [InteractiveWindowMessages.SubmitNewCell]: ISubmitNewCell;
//public [InteractiveWindowMessages.SendInfo]: IInteractiveWindowInfo;
//public [InteractiveWindowMessages.Started]: never | undefined;
//public [InteractiveWindowMessages.AddedSysInfo]: IAddedSysInfo;
//public [InteractiveWindowMessages.RemoteAddCode]: IRemoteAddCode;
//public [InteractiveWindowMessages.RemoteReexecuteCode]: IRemoteReexecuteCode;
//public [InteractiveWindowMessages.Activate]: never | undefined;
//public [InteractiveWindowMessages.ShowDataViewer]: IShowDataViewer;
//public [InteractiveWindowMessages.GetVariablesRequest]: IJupyterVariablesRequest;
//public [InteractiveWindowMessages.GetVariablesResponse]: IJupyterVariablesResponse;
//public [InteractiveWindowMessages.VariableExplorerToggle]: boolean;
//public [InteractiveWindowMessages.SetVariableExplorerHeight]: IVariableExplorerHeight;
//public [InteractiveWindowMessages.VariableExplorerHeightResponse]: IVariableExplorerHeight;
//public [CssMessages.GetCssRequest]: IGetCssRequest;
//public [CssMessages.GetCssResponse]: IGetCssResponse;
//public [CssMessages.GetMonacoThemeRequest]: IGetMonacoThemeRequest;
//public [CssMessages.GetMonacoThemeResponse]: IGetMonacoThemeResponse;
//public [InteractiveWindowMessages.ProvideCompletionItemsRequest]: IProvideCompletionItemsRequest;
//public [InteractiveWindowMessages.CancelCompletionItemsRequest]: ICancelIntellisenseRequest;
//public [InteractiveWindowMessages.ProvideCompletionItemsResponse]: IProvideCompletionItemsResponse;
//public [InteractiveWindowMessages.ProvideHoverRequest]: IProvideHoverRequest;
//public [InteractiveWindowMessages.CancelHoverRequest]: ICancelIntellisenseRequest;
//public [InteractiveWindowMessages.ProvideHoverResponse]: IProvideHoverResponse;
//public [InteractiveWindowMessages.ProvideSignatureHelpRequest]: IProvideSignatureHelpRequest;
//public [InteractiveWindowMessages.CancelSignatureHelpRequest]: ICancelIntellisenseRequest;
//public [InteractiveWindowMessages.ProvideSignatureHelpResponse]: IProvideSignatureHelpResponse;
//public [InteractiveWindowMessages.ResolveCompletionItemRequest]: IResolveCompletionItemRequest;
//public [InteractiveWindowMessages.CancelResolveCompletionItemRequest]: ICancelIntellisenseRequest;
//public [InteractiveWindowMessages.ResolveCompletionItemResponse]: IResolveCompletionItemResponse;
//public [InteractiveWindowMessages.LoadOnigasmAssemblyRequest]: never | undefined;
//public [InteractiveWindowMessages.LoadOnigasmAssemblyResponse]: Buffer;
//public [InteractiveWindowMessages.LoadTmLanguageRequest]: string;
//public [InteractiveWindowMessages.LoadTmLanguageResponse]: ILoadTmLanguageResponse;
//public [InteractiveWindowMessages.OpenLink]: string | undefined;
//public [InteractiveWindowMessages.ShowPlot]: string | undefined;
//public [InteractiveWindowMessages.SavePng]: string | undefined;
//public [InteractiveWindowMessages.StartDebugging]: never | undefined;
//public [InteractiveWindowMessages.StopDebugging]: never | undefined;
//public [InteractiveWindowMessages.LaunchNotebookTrustPrompt]: never | undefined;
//public [InteractiveWindowMessages.TrustNotebookComplete]: never | undefined;
//public [InteractiveWindowMessages.LoadAllCells]: ILoadAllCells;
//public [InteractiveWindowMessages.LoadAllCellsComplete]: ILoadAllCells;
//public [InteractiveWindowMessages.ScrollToCell]: IScrollToCell;
//public [InteractiveWindowMessages.ReExecuteCells]: IReExecuteCells;
//public [InteractiveWindowMessages.NotebookIdentity]: INotebookIdentity;
//public [InteractiveWindowMessages.NotebookClose]: INotebookIdentity;
//public [InteractiveWindowMessages.NotebookDirty]: never | undefined;
//public [InteractiveWindowMessages.NotebookClean]: never | undefined;
//public [InteractiveWindowMessages.SaveAll]: ISaveAll;
//public [InteractiveWindowMessages.Sync]: {
//type: InteractiveWindowMessages | SharedMessages | CommonActionType;
//// tslint:disable-next-line: no-any
//payload: BaseReduxActionPayload<any>;
//};
//public [InteractiveWindowMessages.NativeCommand]: INativeCommand;
//public [InteractiveWindowMessages.VariablesComplete]: never | undefined;
//public [InteractiveWindowMessages.NotebookRunAllCells]: never | undefined;
//public [InteractiveWindowMessages.NotebookRunSelectedCell]: never | undefined;
//public [InteractiveWindowMessages.NotebookAddCellBelow]: IAddCellAction;
//public [InteractiveWindowMessages.DoSave]: never | undefined;
//public [InteractiveWindowMessages.ExecutionRendered]: never | undefined;
//public [InteractiveWindowMessages.FocusedCellEditor]: IFocusedCellEditor;
//public [InteractiveWindowMessages.SelectedCell]: IFocusedCellEditor;
//public [InteractiveWindowMessages.OutputToggled]: never | undefined;
//public [InteractiveWindowMessages.UnfocusedCellEditor]: never | undefined;
//public [InteractiveWindowMessages.MonacoReady]: never | undefined;
//public [InteractiveWindowMessages.ClearAllOutputs]: never | undefined;
//public [InteractiveWindowMessages.UpdateKernel]: IServerState | undefined;
//public [InteractiveWindowMessages.UpdateModel]: NotebookModelChange;
//public [InteractiveWindowMessages.ReceivedUpdateModel]: never | undefined;
//public [SharedMessages.UpdateSettings]: string;
//public [SharedMessages.LocInit]: string;
//public [InteractiveWindowMessages.UpdateDisplayData]: KernelMessage.IUpdateDisplayDataMsg;
//public [InteractiveWindowMessages.IPyWidgetLoadSuccess]: LoadIPyWidgetClassLoadAction;
//public [InteractiveWindowMessages.IPyWidgetLoadFailure]: ILoadIPyWidgetClassFailureAction;
//public [InteractiveWindowMessages.IPyWidgetWidgetVersionNotSupported]: NotifyIPyWidgeWidgetVersionNotSupportedAction;
//public [InteractiveWindowMessages.ConvertUriForUseInWebViewRequest]: Uri;
//public [InteractiveWindowMessages.ConvertUriForUseInWebViewResponse]: { request: Uri; response: Uri };
//public [InteractiveWindowMessages.IPyWidgetRenderFailure]: Error;
//public [InteractiveWindowMessages.IPyWidgetUnhandledKernelMessage]: KernelMessage.IMessage;
//public [InteractiveWindowMessages.RunByLine]: IRunByLine;
//public [InteractiveWindowMessages.Continue]: never | undefined;
//public [InteractiveWindowMessages.ShowBreak]: { frames: DebugProtocol.StackFrame[]; cell: ICell };
//public [InteractiveWindowMessages.ShowContinue]: ICell;
//public [InteractiveWindowMessages.Step]: never | undefined;
//public [InteractiveWindowMessages.ShowingIp]: never | undefined;
//public [InteractiveWindowMessages.KernelIdle]: never | undefined;
//public [InteractiveWindowMessages.DebugStateChange]: IDebugStateChange;
//public [InteractiveWindowMessages.HasCell]: string;
//public [InteractiveWindowMessages.HasCellResponse]: { id: string; result: boolean };
//public [InteractiveWindowMessages.UpdateExternalCellButtons]: IExternalWebviewCellButton[];
//public [InteractiveWindowMessages.ExecuteExternalCommand]: IExternalCommandFromWebview;
//}

export const IVariableViewProvider = Symbol('IVariableViewProvider');
export interface IVariableViewProvider extends IVSCWebviewViewProvider {}
