// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import {
    NotebookDocument,
    DebugSession,
    DebugAdapter,
    NotebookCell,
    Event,
    EventEmitter,
    DebugProtocolMessage
} from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { IDebuggingCellMap, IJupyterSession } from '../../datascience/types';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { ICommandManager } from '../../common/application/types';
import { traceError } from '../../common/logger';

const debugRequest = (message: DebugProtocol.Request): KernelMessage.IDebugRequestMsg => {
    return {
        channel: 'control',
        header: {
            msg_id: randomBytes(8).toString('hex'),
            date: new Date().toISOString(),
            version: '5.2',
            msg_type: 'debug_request',
            username: 'vscode',
            session: randomBytes(8).toString('hex')
        },
        metadata: {},
        parent_header: {},
        content: {
            seq: message.seq,
            type: 'request',
            command: message.command,
            arguments: message.arguments
        }
    };
};

const debugResponse = (message: DebugProtocol.Response): KernelMessage.IDebugReplyMsg => {
    return {
        channel: 'control',
        header: {
            msg_id: randomBytes(8).toString('hex'),
            date: new Date().toISOString(),
            version: '5.2',
            msg_type: 'debug_reply',
            username: 'vscode',
            session: randomBytes(8).toString('hex')
        },
        metadata: {},
        parent_header: {},
        content: {
            seq: message.seq,
            type: 'response',
            request_seq: message.request_seq,
            success: message.success,
            command: message.command,
            message: message.message,
            body: message.body
        }
    };
};

interface dumpCellResponse {
    sourcePath: string; // filename for the dumped source
}

interface debugInfoResponse {
    isStarted: boolean; // whether the debugger is started,
    hashMethod: string; // the hash method for code cell. Default is 'Murmur2',
    hashSeed: string; // the seed for the hashing of code cells,
    tmpFilePrefix: string; // prefix for temporary file names
    tmpFileSuffix: string; // suffix for temporary file names
    breakpoints: debugInfoResponseBreakpoint[]; // breakpoints currently registered in the debugger.
    stoppedThreads: number[]; // threads in which the debugger is currently in a stopped state
}

interface debugInfoResponseBreakpoint {
    source: string; // source file
    breakpoints: DebugProtocol.SourceBreakpoint[]; // list of breakpoints for that source file
}

// For info on the custom requests implemented by jupyter see:
// https://jupyter-client.readthedocs.io/en/stable/messaging.html#debug-request
// https://jupyter-client.readthedocs.io/en/stable/messaging.html#additions-to-the-dap
export class KernelDebugAdapter implements DebugAdapter {
    private readonly fileToCell = new Map<string, NotebookCell>();
    private readonly cellToFile = new Map<string, string>();
    private readonly sendMessage = new EventEmitter<DebugProtocolMessage>();
    private readonly messageListener = new Map<
        number,
        Kernel.IControlFuture<KernelMessage.IDebugRequestMsg, KernelMessage.IDebugReplyMsg>
    >();

    onDidSendMessage: Event<DebugProtocolMessage> = this.sendMessage.event;

    constructor(
        private session: DebugSession,
        private notebookDocument: NotebookDocument,
        private readonly jupyterSession: IJupyterSession,
        private cellMap: IDebuggingCellMap,
        private commandManager: ICommandManager
    ) {
        const iopubHandler = (msg: KernelMessage.IIOPubMessage) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((msg.content as any).event === 'stopped') {
                this.sendMessage.fire(msg.content);
            }
        };
        this.jupyterSession.onIOPubMessage(iopubHandler);

        void this.dumpCellsThatRanBeforeDebuggingBegan();
    }

    async handleMessage(message: DebugProtocol.ProtocolMessage) {
        // intercept 'setBreakpoints' request
        if (message.type === 'request' && (message as DebugProtocol.Request).command === 'setBreakpoints') {
            const args = (message as DebugProtocol.Request).arguments;
            if (args.source && args.source.path && args.source.path.indexOf('vscode-notebook-cell:') === 0) {
                await this.dumpCell(args.source.path);
            }
        }

        // after attaching, send a 'debugInfo' request
        // reset breakpoints and continue stopped threads if there are any
        // we do this in case the kernel is stopped when we attach
        // This might happen if VS Code or the extension host crashes
        if (message.type === 'request' && (message as DebugProtocol.Request).command === 'attach') {
            await this.debugInfo();
        }

        // after disconnecting, hide the breakpoint margin
        if (message.type === 'request' && (message as DebugProtocol.Request).command === 'disconnect') {
            void this.commandManager.executeCommand('notebook.toggleBreakpointMargin', this.notebookDocument);
        }

        // map Source paths from VS Code to Ipykernel temp files
        this.getMessageSourceAndHookIt(message, (source) => {
            if (source && source.path) {
                const path = this.cellToFile.get(source.path);
                if (path) {
                    source.path = path;
                }
            }
        });

        if (message.type === 'request') {
            const request = debugRequest(message as DebugProtocol.Request);
            const control = this.jupyterSession.requestDebug({
                seq: request.content.seq,
                type: 'request',
                command: request.content.command,
                arguments: request.content.arguments
            });

            if (control) {
                control.onReply = (msg) => this.controlCallback(msg.content as DebugProtocol.ProtocolMessage);
                control.onIOPub = (msg) => this.controlCallback(msg.content as DebugProtocol.ProtocolMessage);
                this.messageListener.set(message.seq, control);
            }
        } else if (message.type === 'response') {
            // responses of reverse requests
            const response = debugResponse(message as DebugProtocol.Response);
            this.jupyterSession.requestDebug({
                seq: response.content.seq,
                type: 'request',
                command: response.content.command
            });
        } else {
            // cannot send via iopub, no way to handle events even if they existed
            traceError(`Unknown message type to send ${message.type}`);
        }
    }

    dispose() {
        this.messageListener.forEach((ml) => ml.dispose());
        this.messageListener.clear();
    }

    private async dumpCellsThatRanBeforeDebuggingBegan() {
        this.cellMap.getCellsAnClearQueue(this.notebookDocument).forEach(async (cell) => {
            await this.dumpCell(cell.document.uri.toString());
        });
    }

    // Dump content of given cell into a tmp file and return path to file.
    private async dumpCell(uri: string): Promise<void> {
        const cell = this.notebookDocument.getCells().find((c) => c.document.uri.toString() === uri);
        if (cell) {
            try {
                const response = await this.session.customRequest('dumpCell', { code: cell.document.getText() });
                const norm = path.normalize((response as dumpCellResponse).sourcePath);
                this.fileToCell.set(norm, cell);
                this.cellToFile.set(cell.document.uri.toString(), norm);
            } catch (err) {
                traceError(err);
            }
        }
    }

    private async debugInfo(): Promise<void> {
        const response = await this.session.customRequest('debugInfo');

        // If there's breakpoints at this point, send a message to VS Code to keep them
        (response as debugInfoResponse).breakpoints.forEach((breakpoint) => {
            const message: DebugProtocol.SetBreakpointsRequest = {
                seq: 0,
                type: 'request',
                command: 'setBreakpoints',
                arguments: {
                    source: {
                        path: breakpoint.source
                    },
                    breakpoints: breakpoint.breakpoints
                }
            };
            this.sendMessage.fire(message);
        });

        // If there's stopped threads at this point, continue them all
        (response as debugInfoResponse).stoppedThreads.forEach((thread: number) => {
            this.jupyterSession.requestDebug({
                seq: 0,
                type: 'request',
                command: 'continue',
                arguments: {
                    threadId: thread
                }
            });
        });
    }

    private controlCallback(message: DebugProtocol.ProtocolMessage): void {
        this.getMessageSourceAndHookIt(message as DebugProtocol.ProtocolMessage, (source) => {
            if (source && source.path) {
                const cell = this.fileToCell.get(source.path);
                if (cell) {
                    source.name = path.basename(cell.document.uri.path);
                    if (cell.index >= 0) {
                        source.name += `, Cell ${cell.index + 1}`;
                    }
                    source.path = cell.document.uri.toString();
                }
            }
        });

        this.sendMessage.fire(message);
    }

    private getMessageSourceAndHookIt(
        msg: DebugProtocol.ProtocolMessage,
        sourceHook: (source: DebugProtocol.Source | undefined) => void
    ): void {
        switch (msg.type) {
            case 'event':
                const event = msg as DebugProtocol.Event;
                switch (event.event) {
                    case 'output':
                        sourceHook((event as DebugProtocol.OutputEvent).body.source);
                        break;
                    case 'loadedSource':
                        sourceHook((event as DebugProtocol.LoadedSourceEvent).body.source);
                        break;
                    case 'breakpoint':
                        sourceHook((event as DebugProtocol.BreakpointEvent).body.breakpoint.source);
                        break;
                    default:
                        break;
                }
                break;
            case 'request':
                const request = msg as DebugProtocol.Request;
                switch (request.command) {
                    case 'setBreakpoints':
                        sourceHook((request.arguments as DebugProtocol.SetBreakpointsArguments).source);
                        break;
                    case 'breakpointLocations':
                        sourceHook((request.arguments as DebugProtocol.BreakpointLocationsArguments).source);
                        break;
                    case 'source':
                        sourceHook((request.arguments as DebugProtocol.SourceArguments).source);
                        break;
                    case 'gotoTargets':
                        sourceHook((request.arguments as DebugProtocol.GotoTargetsArguments).source);
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
                            (response as DebugProtocol.StackTraceResponse).body.stackFrames.forEach((frame) =>
                                sourceHook(frame.source)
                            );
                            break;
                        case 'loadedSources':
                            (response as DebugProtocol.LoadedSourcesResponse).body.sources.forEach((source) =>
                                sourceHook(source)
                            );
                            break;
                        case 'scopes':
                            (response as DebugProtocol.ScopesResponse).body.scopes.forEach((scope) =>
                                sourceHook(scope.source)
                            );
                            break;
                        case 'setFunctionBreakpoints':
                            (response as DebugProtocol.SetFunctionBreakpointsResponse).body.breakpoints.forEach((bp) =>
                                sourceHook(bp.source)
                            );
                            break;
                        case 'setBreakpoints':
                            (response as DebugProtocol.SetBreakpointsResponse).body.breakpoints.forEach((bp) =>
                                sourceHook(bp.source)
                            );
                            break;
                        default:
                            break;
                    }
                }
                break;
        }
    }
}
