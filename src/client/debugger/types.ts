// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { Event } from 'vscode';
import { IJupyterVariablesResponse } from '../datascience/types';

export type ConsoleType = 'internalConsole' | 'integratedTerminal' | 'externalTerminal';

export interface IKernelDebugAdapter {
    runByLineContinue(): void;

    runByLineStop(): void;
}

export const IDebuggingManager = Symbol('IDebuggingManager');
export interface IDebuggingManager {
    readonly onDidFireVariablesEvent: Event<IJupyterVariablesResponse>;
}