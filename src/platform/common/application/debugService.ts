// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import {
    Breakpoint,
    BreakpointsChangeEvent,
    debug,
    DebugConfiguration,
    DebugConsole,
    DebugSession,
    DebugSessionCustomEvent,
    Disposable,
    Event,
    WorkspaceFolder
} from 'vscode';
import { traceInfoIfCI } from '../../logging';
import { IDebugService } from './types';

/**
 * Wrapper around the vscode debug namespace.
 */
@injectable()
export class DebugService implements IDebugService {
    public static instance = new DebugService();
    public get activeDebugConsole(): DebugConsole {
        return debug.activeDebugConsole;
    }
    public get activeDebugSession(): DebugSession | undefined {
        traceInfoIfCI(`Getting active debug session, ${debug.activeDebugSession?.name}`);
        return debug.activeDebugSession;
    }
    public get breakpoints(): readonly Breakpoint[] {
        return debug.breakpoints;
    }
    public get onDidChangeActiveDebugSession(): Event<DebugSession | undefined> {
        return debug.onDidChangeActiveDebugSession;
    }
    public get onDidStartDebugSession(): Event<DebugSession> {
        return debug.onDidStartDebugSession;
    }
    public get onDidReceiveDebugSessionCustomEvent(): Event<DebugSessionCustomEvent> {
        return debug.onDidReceiveDebugSessionCustomEvent;
    }
    public get onDidTerminateDebugSession(): Event<DebugSession> {
        return debug.onDidTerminateDebugSession;
    }
    public get onDidChangeBreakpoints(): Event<BreakpointsChangeEvent> {
        return debug.onDidChangeBreakpoints;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public registerDebugConfigurationProvider(debugType: string, provider: any): Disposable {
        return debug.registerDebugConfigurationProvider(debugType, provider);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public registerDebugAdapterTrackerFactory(debugType: string, provider: any): Disposable {
        return debug.registerDebugAdapterTrackerFactory(debugType, provider);
    }
    public startDebugging(
        folder: WorkspaceFolder | undefined,
        nameOrConfiguration: string | DebugConfiguration,
        parentSession?: DebugSession
    ): Thenable<boolean> {
        return debug.startDebugging(folder, nameOrConfiguration, parentSession);
    }
    public addBreakpoints(breakpoints: Breakpoint[]): void {
        debug.addBreakpoints(breakpoints);
    }
    public removeBreakpoints(breakpoints: Breakpoint[]): void {
        debug.removeBreakpoints(breakpoints);
    }
}
