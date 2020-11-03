import { CssMessages, IGetCssRequest, IGetCssResponse, SharedMessages } from '../messages';
import { IWebviewViewProvider } from '../types';

export namespace VariableViewMessages {
    export const Started = SharedMessages.Started;
    export const UpdateSettings = SharedMessages.UpdateSettings;
}

// Map all messages to specific payloads
export class IVariableViewMapping {
    public [VariableViewMessages.Started]: never | undefined;
    public [VariableViewMessages.UpdateSettings]: string;
    public [CssMessages.GetCssRequest]: IGetCssRequest;
    public [CssMessages.GetCssResponse]: IGetCssResponse;
}

export const IVariableViewProvider = Symbol('IVariableViewProvider');
export interface IVariableViewProvider extends IWebviewViewProvider {}
