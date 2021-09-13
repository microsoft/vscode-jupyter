// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DebugProtocolMessage, DebugSession, Event, NotebookDocument } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';

export type ConsoleType = 'internalConsole' | 'integratedTerminal' | 'externalTerminal';

export interface IKernelDebugAdapter {
    debugSession: DebugSession;
    stepIn(threadId: number): Thenable<DebugProtocol.StepInResponse['body']>;
    stackTrace(args: DebugProtocol.StackTraceArguments): Thenable<DebugProtocol.StackTraceResponse['body']>;
    setBreakpoints(args: DebugProtocol.SetBreakpointsArguments): Thenable<DebugProtocol.SetBreakpointsResponse['body']>;
    disconnect(): void;
    onDidEndSession: Event<DebugSession>;
    dumpCell(index: number): Promise<void>;
}

export const IDebuggingManager = Symbol('IDebuggingManager');
export interface IDebuggingManager {
    readonly onDidFireVariablesEvent: Event<void>;
    isDebugging(notebook: NotebookDocument): boolean;
}

export interface DebuggingDelegate {
    /**
     * Called for every event sent from the debug adapter to the client. Returns true to signal that sending the message is vetoed.
     */
    willSendEvent(msg: DebugProtocolMessage): Promise<boolean>;

    /**
     * Called for every request sent from the client to the debug adapter.
     */
    willSendRequest(request: DebugProtocol.Request): Promise<void>;
}
