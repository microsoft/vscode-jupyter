import { IWebviewViewProvider } from '../types';

export const IVariableViewProvider = Symbol('IVariableViewProvider');
export interface IVariableViewProvider extends IWebviewViewProvider {}
