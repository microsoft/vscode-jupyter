import { IWebviewViewProvider } from '../types';

export const IVariableViewProvider = Symbol('IVariableViewProvider');
export interface IVariableViewProvider extends IWebviewViewProvider {}

// Map all messages to specific payloads
export type IVariableViewMapping = {};
