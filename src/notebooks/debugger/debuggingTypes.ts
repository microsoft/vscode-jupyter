// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { DebugProtocol } from 'vscode-debugprotocol';
import { IDebugService } from '../../platform/common/application/types';
import {
    DebugAdapter,
    DebugAdapterTracker,
    DebugConfiguration,
    DebugProtocolMessage,
    DebugSession,
    Event,
    NotebookCell,
    NotebookDocument
} from 'vscode';

export interface ISourceMapMapping {
    line: number;
    endLine: number;
    runtimeSource: { path: string };
    runtimeLine: number;
}

export interface ISourceMapRequest {
    source: { path: string };
    pydevdSourceMaps: ISourceMapMapping[];
}

export const IJupyterDebugService = Symbol('IJupyterDebugService');
export interface IJupyterDebugService extends IDebugService {
    /**
     * Event fired when a breakpoint is hit (debugger has stopped)
     */
    readonly onBreakpointHit: Event<void>;
    /**
     * Start debugging a notebook cell.
     * @param nameOrConfiguration Either the name of a debug or compound configuration or a [DebugConfiguration](#DebugConfiguration) object.
     * @return A thenable that resolves when debugging could be successfully started.
     */
    startRunByLine(config: DebugConfiguration): Thenable<boolean>;
    /**
     * Gets the current stack frame for the current thread
     */
    getStack(): Promise<DebugProtocol.StackFrame[]>;
    /**
     * Steps the current thread. Returns after the request is sent. Wait for onBreakpointHit or onDidTerminateDebugSession to determine when done.
     */
    step(): Promise<void>;
    /**
     * Runs the current thread. Will keep running until a breakpoint or end of session.
     */
    continue(): Promise<void>;
    /**
     * Force a request for variables. DebugAdapterTrackers can listen for the results.
     */
    requestVariables(): Promise<void>;
    /**
     * Stop debugging
     */
    stop(): void;
}

export interface IKernelDebugAdapter extends DebugAdapter {
    stepIn(threadId: number): Thenable<DebugProtocol.StepInResponse['body']>;
    stackTrace(args: DebugProtocol.StackTraceArguments): Thenable<DebugProtocol.StackTraceResponse['body']>;
    setBreakpoints(args: DebugProtocol.SetBreakpointsArguments): Thenable<DebugProtocol.SetBreakpointsResponse['body']>;
    disconnect(): Promise<void>;
    onDidEndSession: Event<DebugSession>;
    dumpAllCells(): Promise<void>;
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
    Everything,
    InteractiveWindow
}

export interface IKernelDebugAdapterConfig extends DebugConfiguration {
    __mode: KernelDebugMode;
    __cellIndex?: number;
    __interactiveWindowNotebookUri?: string;
}

export interface IDebugLocation {
    fileName: string;
    lineNumber: number;
    column: number;
}
export const IDebugLocationTrackerFactory = Symbol('IDebugLocationTrackerFactory');
export interface IDebugLocationTrackerFactory {
    createDebugAdapterTracker(session: DebugSession): DebugAdapterTracker;
}

export const IDebugLocationTracker = Symbol('IDebugLocationTracker');
export interface IDebugLocationTracker {
    updated: Event<void>;
    getLocation(debugSession: DebugSession): IDebugLocation | undefined;
}
