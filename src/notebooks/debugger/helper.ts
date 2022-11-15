// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { IDebugEventMsg } from '@jupyterlab/services/lib/kernel/messages';
import { DebugProtocol } from 'vscode-debugprotocol';
import { INotebookKernelExecution } from '../../kernels/types';
import {
    IInteractiveWindowDebugConfig,
    IKernelDebugAdapter,
    INotebookDebugConfig,
    KernelDebugMode
} from './debuggingTypes';

export enum IpykernelCheckResult {
    Unknown,
    Ok,
    Outdated,
    NotInstalled,
    ControllerNotSelected
}

export async function isUsingIpykernel6OrLater(execution: INotebookKernelExecution): Promise<IpykernelCheckResult> {
    const code = `import builtins
import ipykernel
builtins.print(ipykernel.__version__)`;
    const output = await execution.executeHidden(code);

    if (output[0].text) {
        const version = output[0].text.toString().split('.');
        const majorVersion = Number(version[0]);
        return majorVersion >= 6 ? IpykernelCheckResult.Ok : IpykernelCheckResult.Outdated;
    }

    return IpykernelCheckResult.Unknown;
}

export function assertIsDebugConfig(thing: unknown): asserts thing is INotebookDebugConfig {
    const config = thing as INotebookDebugConfig;
    if (
        typeof config.__notebookUri === 'undefined' ||
        typeof config.__mode === 'undefined' ||
        ((config.__mode === KernelDebugMode.Cell ||
            config.__mode === KernelDebugMode.InteractiveWindow ||
            config.__mode === KernelDebugMode.RunByLine) &&
            typeof config.__cellIndex === 'undefined')
    ) {
        throw new Error('Invalid launch configuration');
    }
}

export function assertIsInteractiveWindowDebugConfig(thing: unknown): asserts thing is IInteractiveWindowDebugConfig {
    assertIsDebugConfig(thing);
    if (thing.__mode !== KernelDebugMode.InteractiveWindow) {
        throw new Error('Invalid launch configuration');
    }
}

export function getMessageSourceAndHookIt(
    msg: DebugProtocol.ProtocolMessage,
    sourceHook: (
        source: DebugProtocol.Source | undefined,
        lines?: { line?: number; endLine?: number; lines?: number[] }
    ) => void
): void {
    switch (msg.type) {
        case 'event':
            const event = msg as DebugProtocol.Event;
            switch (event.event) {
                case 'output':
                    sourceHook(
                        (event as DebugProtocol.OutputEvent).body.source,
                        (event as DebugProtocol.OutputEvent).body
                    );
                    break;
                case 'loadedSource':
                    sourceHook(
                        (event as DebugProtocol.LoadedSourceEvent).body.source,
                        (event as DebugProtocol.OutputEvent).body
                    );
                    break;
                case 'breakpoint':
                    sourceHook(
                        (event as DebugProtocol.BreakpointEvent).body.breakpoint.source,
                        (event as DebugProtocol.OutputEvent).body
                    );
                    break;
                default:
                    break;
            }
            break;
        case 'request':
            const request = msg as DebugProtocol.Request;
            switch (request.command) {
                case 'setBreakpoints':
                    // Keep track of the original source to be passed for other hooks.
                    const originalSource = { ...(request.arguments as DebugProtocol.SetBreakpointsArguments).source };
                    sourceHook((request.arguments as DebugProtocol.SetBreakpointsArguments).source, request.arguments);
                    const breakpoints = (request.arguments as DebugProtocol.SetBreakpointsArguments).breakpoints;
                    if (breakpoints && Array.isArray(breakpoints)) {
                        breakpoints.forEach((bk) => {
                            // Pass the original source to the hook (without the translation).
                            sourceHook({ ...originalSource }, bk);
                        });
                    }
                    break;
                case 'breakpointLocations':
                    sourceHook(
                        (request.arguments as DebugProtocol.BreakpointLocationsArguments).source,
                        request.arguments
                    );
                    break;
                case 'source':
                    sourceHook((request.arguments as DebugProtocol.SourceArguments).source);
                    break;
                case 'gotoTargets':
                    sourceHook((request.arguments as DebugProtocol.GotoTargetsArguments).source, request.arguments);
                    break;
                default:
                    break;
            }
            break;
        case 'response':
            const response = msg as DebugProtocol.Response;
            if (response.success && response.body) {
                switch (response.command) {
                    case 'stackTrace':
                        (response as DebugProtocol.StackTraceResponse).body.stackFrames.forEach((frame) => {
                            sourceHook(frame.source, frame);
                        });
                        break;
                    case 'loadedSources':
                        (response as DebugProtocol.LoadedSourcesResponse).body.sources.forEach((source) =>
                            sourceHook(source)
                        );
                        break;
                    case 'scopes':
                        (response as DebugProtocol.ScopesResponse).body.scopes.forEach((scope) => {
                            sourceHook(scope.source, scope);
                        });
                        break;
                    case 'setFunctionBreakpoints':
                        (response as DebugProtocol.SetFunctionBreakpointsResponse).body.breakpoints.forEach((bp) => {
                            sourceHook(bp.source, bp);
                        });
                        break;
                    case 'setBreakpoints':
                        (response as DebugProtocol.SetBreakpointsResponse).body.breakpoints.forEach((bp) => {
                            sourceHook(bp.source, bp);
                        });
                        break;
                    default:
                        break;
                }
            }
            break;
    }
}

export function isShortNamePath(path: string): boolean {
    return /~\d+\\/.test(path);
}

export function shortNameMatchesLongName(shortNamePath: string, longNamePath: string): boolean {
    const r = new RegExp(shortNamePath.replace(/\\/g, '\\\\').replace(/~\d+\\\\/g, '[^\\\\]+\\\\'), 'i');
    return r.test(longNamePath);
}

export async function cellDebugSetup(
    execution: INotebookKernelExecution,
    debugAdapter: IKernelDebugAdapter
): Promise<void> {
    // remove this if when https://github.com/microsoft/debugpy/issues/706 is fixed and ipykernel ships it
    // executing this code restarts debugpy and fixes https://github.com/microsoft/vscode-jupyter/issues/7251
    const code = 'import debugpy\ndebugpy.debug_this_thread()';
    await execution.executeHidden(code);

    await debugAdapter.dumpAllCells();
}

export function isDebugEventMsg(msg: unknown): msg is IDebugEventMsg {
    return !!(msg as IDebugEventMsg).header && (msg as IDebugEventMsg).header.msg_type === 'debug_event';
}
