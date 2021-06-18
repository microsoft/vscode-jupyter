// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { IJupyterSession } from '../../datascience/types';
import { Kernel, KernelMessage } from '@jupyterlab/services';

export class KernelDebugAdapter implements vscode.DebugAdapter {
    private readonly fileToCell = new Map<string, vscode.NotebookCell>();
    private readonly cellToFile = new Map<string, string>();
    private readonly sendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    private readonly messageListener = new Map<
        number,
        Kernel.IControlFuture<KernelMessage.IDebugRequestMsg, KernelMessage.IDebugReplyMsg>
    >();

    onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this.sendMessage.event;

    constructor(
        private session: vscode.DebugSession,
        private notebookDocument: vscode.NotebookDocument,
        private readonly jupyterSession: IJupyterSession
    ) {
        const iopubHandler = (msg: KernelMessage.IIOPubMessage) => {
            if ((msg.content as any).event === 'stopped') {
                this.sendMessage.fire(msg.content);
            }
        };
        this.jupyterSession.onIOPubMessageSignal(iopubHandler);
    }

    async handleMessage(message: DebugProtocol.ProtocolMessage) {
        // intercept 'setBreakpoints' request
        if (message.type === 'request' && (message as DebugProtocol.Request).command === 'setBreakpoints') {
            const args = (message as DebugProtocol.Request).arguments;
            if (args.source && args.source.path && args.source.path.indexOf('vscode-notebook-cell:') === 0) {
                await this.dumpCell(args.source.path);
            }
        }

        // map Source paths from VS Code to Xeus
        visitSources(message, (source) => {
            if (source && source.path) {
                const p = this.cellToFile.get(source.path);
                if (p) {
                    source.path = p;
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
                control.onReply = (msg) => {
                    visitSources(msg.content, (source) => {
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

                    this.sendMessage.fire(msg.content);
                };
                control.onIOPub = (msg) => {
                    visitSources(msg.content as DebugProtocol.ProtocolMessage, (source) => {
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

                    this.sendMessage.fire(msg.content);
                };
                control.onStdin = (msg) => {
                    visitSources(msg.content as DebugProtocol.ProtocolMessage, (source) => {
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

                    this.sendMessage.fire(msg.content);
                };
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
            console.assert(false, `Unknown message type to send ${message.type}`);
        }
    }

    dispose() {
        this.messageListener.forEach((ml) => ml.dispose());
        this.messageListener.clear();
    }

    /**
     * Dump content of given cell into a tmp file and return path to file.
     */
    private async dumpCell(uri: string): Promise<void> {
        const cell = this.notebookDocument.getCells().find((c) => c.document.uri.toString() === uri);
        if (cell) {
            try {
                const response = await this.session.customRequest('dumpCell', { code: cell.document.getText() });
                const norm = path.normalize(response.sourcePath);
                this.fileToCell.set(norm, cell);
                this.cellToFile.set(cell.document.uri.toString(), norm);
            } catch (err) {
                console.log(err);
            }
        }
    }
}

// this vistor could be moved into the DAP npm module (it must be kept in sync with the DAP spec)
function visitSources(
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
