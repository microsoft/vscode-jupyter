// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { DebugSession, Event, NotebookDocument } from 'vscode';

export type ConsoleType = 'internalConsole' | 'integratedTerminal' | 'externalTerminal';

export interface IKernelDebugAdapter {
    debugSession: DebugSession;
    runByLineContinue(): void;
    disconnect(): void;
}

export const IDebuggingManager = Symbol('IDebuggingManager');
export interface IDebuggingManager {
    readonly onDidFireVariablesEvent: Event<void>;
    getDebugSession(notebook: NotebookDocument): DebugSession | undefined;
}
