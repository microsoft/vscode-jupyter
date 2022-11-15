// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { DebugProtocol } from 'vscode-debugprotocol';
import { IDebugService } from '../../platform/common/application/types';
import {
    DebugAdapter,
    DebugAdapterTracker,
    DebugConfiguration,
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
    /* These methods make requests via roundtrip to the client */
    stepIn(threadId: number): Thenable<DebugProtocol.StepInResponse['body']>;
    stackTrace(args: DebugProtocol.StackTraceArguments): Thenable<DebugProtocol.StackTraceResponse['body']>;
    setBreakpoints(args: DebugProtocol.SetBreakpointsArguments): Thenable<DebugProtocol.SetBreakpointsResponse['body']>;
    debugInfo(): Thenable<IDebugInfoResponse>;
    disconnect(): Promise<void>;

    /**
     * Makes a request directly to the Jupyter debug connection- no roundtrip but no response either
     */
    continueDirect(threadId: number): void;

    onDidEndSession: Event<DebugSession>;
    dumpAllCells(): Promise<void>;
    getConfiguration(): IBaseNotebookDebugConfig;
}

export interface IDebuggingManager {
    readonly onDoneDebugging: Event<void>;
    isDebugging(notebook: NotebookDocument): boolean;
    getDebugMode(notebook: NotebookDocument): KernelDebugMode | undefined;
    getDebugSession(notebook: NotebookDocument): DebugSession | undefined;
    getDebugCell(notebook: NotebookDocument): NotebookCell | undefined;
    getDebugAdapter(notebook: NotebookDocument): IKernelDebugAdapter | undefined;
}

export const INotebookDebuggingManager = Symbol('INotebookDebuggingManager');
export interface INotebookDebuggingManager extends IDebuggingManager {
    tryToStartDebugging(mode: KernelDebugMode, cell: NotebookCell, skipIpykernelCheck?: boolean): Promise<void>;
    runByLineNext(cell: NotebookCell): void;
    runByLineStop(cell: NotebookCell): void;
}

export interface IDebuggingDelegate {
    /**
     * Called for every event sent from the debug adapter to the client. Returns true to signal that sending the message is vetoed.
     */
    willSendEvent?(msg: DebugProtocol.Event): Promise<boolean>;

    /**
     * Called for every request sent from the client to the debug adapter. Returns true to signal that the request was handled by the delegate.
     */
    willSendRequest?(request: DebugProtocol.Request): undefined | Promise<DebugProtocol.Response | undefined>;

    /**
     * Called for every response returned from the debug adapter to the client.
     */
    willSendResponse?(request: DebugProtocol.Response): Promise<void>;
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
    InteractiveWindow
}

interface IBaseNotebookDebugConfig extends DebugConfiguration {
    __mode: KernelDebugMode;
    __notebookUri: string;
}

export type INotebookDebugConfig = IRunByLineDebugConfig | ICellDebugConfig | IInteractiveWindowDebugConfig;

export interface IRunByLineDebugConfig extends IBaseNotebookDebugConfig {
    __mode: KernelDebugMode.RunByLine;
    __cellIndex: number;
}

export interface ICellDebugConfig extends IBaseNotebookDebugConfig {
    __mode: KernelDebugMode.Cell;
    __cellIndex: number;
}

export interface IInteractiveWindowDebugConfig extends IBaseNotebookDebugConfig {
    __mode: KernelDebugMode.InteractiveWindow;
    __cellIndex: number;
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
