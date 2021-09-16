// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
    DebugAdapter,
    DebugConfiguration,
    DebugProtocolMessage,
    DebugSession,
    Event,
    NotebookCell,
    NotebookDocument
} from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';

export interface IKernelDebugAdapter extends DebugAdapter {
    stepIn(threadId: number): Thenable<DebugProtocol.StepInResponse['body']>;
    stackTrace(args: DebugProtocol.StackTraceArguments): Thenable<DebugProtocol.StackTraceResponse['body']>;
    setBreakpoints(args: DebugProtocol.SetBreakpointsArguments): Thenable<DebugProtocol.SetBreakpointsResponse['body']>;
    disconnect(): void;
    onDidEndSession: Event<DebugSession>;
    dumpCell(index: number): Promise<void>;
    getConfiguration(): IKernelDebugAdapterConfig;
}

export const IDebuggingManager = Symbol('IDebuggingManager');
export interface IDebuggingManager {
    readonly onDoneDebugging: Event<void>;
    isDebugging(notebook: NotebookDocument): boolean;
    getDebugMode(notebook: NotebookDocument): KernelDebugMode | undefined;
    getDebugSession(notebook: NotebookDocument): Promise<DebugSession> | undefined;
    getDebugCell(notebook: NotebookDocument): NotebookCell | undefined;
    getDebugAdapter(notebook: NotebookDocument): IKernelDebugAdapter | undefined;
}

export interface IDebuggingDelegate {
    /**
     * Called for every event sent from the debug adapter to the client. Returns true to signal that sending the message is vetoed.
     */
    willSendEvent(msg: DebugProtocolMessage): Promise<boolean>;

    /**
     * Called for every request sent from the client to the debug adapter.
     */
    willSendRequest(request: DebugProtocol.Request): Promise<void>;
}

export interface IDumpCellResponse {
    sourcePath: string; // filename for the dumped source
}

export interface IDebugInfoResponse {
    isStarted: boolean; // whether the debugger is started,
    hashMethod: string; // the hash method for code cell. Default is 'Murmur2',
    hashSeed: string; // the seed for the hashing of code cells,
    tmpFilePrefix: string; // prefix for temporary file names
    tmpFileSuffix: string; // suffix for temporary file names
    breakpoints: IDebugInfoResponseBreakpoint[]; // breakpoints currently registered in the debugger.
    stoppedThreads: number[]; // threads in which the debugger is currently in a stopped state
}

export interface IDebugInfoResponseBreakpoint {
    source: string; // source file
    breakpoints: DebugProtocol.SourceBreakpoint[]; // list of breakpoints for that source file
}

export enum KernelDebugMode {
    RunByLine,
    Cell,
    Everything
}

export interface IKernelDebugAdapterConfig extends DebugConfiguration {
    __mode: KernelDebugMode;
    __cellIndex?: number;
}
