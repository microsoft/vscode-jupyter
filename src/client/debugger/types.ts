// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DebugProtocolMessage, DebugSession, Event, NotebookDocument } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';

export type ConsoleType = 'internalConsole' | 'integratedTerminal' | 'externalTerminal';

export interface IKernelDebugAdapter {
    debugSession: DebugSession;
    stepIn(threadId: number): Thenable<DebugProtocol.StepInResponse['body']>;
    stackTrace(args?: {
        threadId: number;
        startFrame?: number;
        levels?: number;
    }): Thenable<DebugProtocol.StackTraceResponse['body']>;
    disconnect(): void;
    onDidEndSession: Event<DebugSession>;
}

export const IDebuggingManager = Symbol('IDebuggingManager');
export interface IDebuggingManager {
    readonly onDidFireVariablesEvent: Event<void>;
    isDebugging(notebook: NotebookDocument): boolean;
}

export interface DebuggingDelegate {
    /**
     * Returns true to signal that sending the message is vetoed.
     */
    willSendMessage(msg: DebugProtocolMessage): Promise<boolean>;
}
