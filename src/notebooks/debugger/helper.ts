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
    const delimiter = `5dc3a68c-e34e-4080-9c3e-2a532b2ccb4d`;
    const code = `import builtins
import ipykernel
builtins.print("${delimiter}" + ipykernel.__version__ + "${delimiter}")`;
    const output = await execution.executeHidden(code);

    const versionRegex: RegExp = /^(\d+)\.\d+\.\d+$/;

    // It is necessary to traverse all the output to determine the version of ipykernel, some jupyter servers may return extra status metadata
    for (const line of output) {
        if (line.output_type !== 'stream') continue;

        let lineText = line.text?.toString().trim() ?? '';
        if (!lineText.includes(delimiter)) {
            continue;
        }
        const matches: RegExpMatchArray | null = lineText.split(delimiter)[1].trim().match(versionRegex);
        if (matches) {
            const majorVersion: string = matches[1];
            if (Number(majorVersion) >= 6) {
                return IpykernelCheckResult.Ok;
            }
            return IpykernelCheckResult.Outdated;
        }
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
        location: { source?: DebugProtocol.Source; line?: number; endLine?: number },
        source?: DebugProtocol.Source
    ) => void
): void {
    switch (msg.type) {
        case 'event':
            const event = msg as DebugProtocol.Event;
            switch (event.event) {
                case 'output':
                    sourceHook((event as DebugProtocol.OutputEvent).body);
                    break;
                case 'loadedSource':
                    sourceHook((event as DebugProtocol.LoadedSourceEvent).body);
                    break;
                case 'breakpoint':
                    sourceHook((event as DebugProtocol.BreakpointEvent).body.breakpoint);
                    break;
                default:
                    break;
            }
            break;
        case 'request':
            const request = msg as DebugProtocol.Request;
            switch (request.command) {
                case 'setBreakpoints':
                    const args = request.arguments as DebugProtocol.SetBreakpointsArguments;
                    const breakpoints = args.breakpoints;
                    if (breakpoints && breakpoints.length) {
                        const originalLine = breakpoints[0].line;
                        breakpoints.forEach((bp) => {
                            sourceHook(bp, { ...args.source });
                        });
                        const objForSource = { source: args.source, line: originalLine };
                        sourceHook(objForSource);
                        args.source = objForSource.source;
                    }
                    break;
                case 'breakpointLocations':
                    // TODO this technically would have to be mapped to two different sources, in reality, I don't think that will happen in vscode
                    sourceHook(request.arguments as DebugProtocol.BreakpointLocationsArguments);
                    break;
                case 'source':
                    sourceHook(request.arguments as DebugProtocol.SourceArguments);
                    break;
                case 'gotoTargets':
                    sourceHook(request.arguments as DebugProtocol.GotoTargetsArguments);
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
                            sourceHook(frame);
                        });
                        break;
                    case 'loadedSources':
                        (response as DebugProtocol.LoadedSourcesResponse).body.sources.forEach((source) => {
                            const fakeObj = { source };
                            sourceHook(fakeObj);
                            source.path = fakeObj.source.path;
                        });
                        break;
                    case 'scopes':
                        (response as DebugProtocol.ScopesResponse).body.scopes.forEach((scope) => {
                            sourceHook(scope);
                        });
                        break;
                    case 'setFunctionBreakpoints':
                        (response as DebugProtocol.SetFunctionBreakpointsResponse).body.breakpoints.forEach((bp) => {
                            sourceHook(bp);
                        });
                        break;
                    case 'setBreakpoints':
                        (response as DebugProtocol.SetBreakpointsResponse).body.breakpoints.forEach((bp) => {
                            sourceHook(bp);
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
