// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { debugRequest, debugResponse, MessageType, JupyterMessage, DebugMessage } from './messaging';
import { filter /*, tap*/ } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import * as path from 'path';
import { IJupyterSession } from '../../datascience/types';

//---- debug adapter for Jupyter debug protocol

const debugEvents: ReadonlySet<MessageType> = new Set(['debug_request', 'debug_reply', 'debug_event']);

const isDebugMessage = (msg: JupyterMessage): msg is DebugMessage => debugEvents.has(msg.header.msg_type);

/**
 * the XeusDebugAdapter delegates the DAP protocol to the xeus kernel
 * via Jupyter's experimental debug_request, debug_reply, debug_event messages.
 */
export class IpykernelDebugAdapter implements vscode.DebugAdapter {
    private readonly fileToCell = new Map<string, vscode.NotebookCell>();
    private readonly cellToFile = new Map<string, string>();
    private readonly sendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    private readonly messageListener: Subscription;

    onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this.sendMessage.event;

    constructor(
        private session: vscode.DebugSession,
        private notebookDocument: vscode.NotebookDocument,
        private readonly jupyterSession: IJupyterSession
    ) {
        this.messageListener = this.jupyterSession
            .registerMessageHook()
            .pipe(
                filter(isDebugMessage)
                //tap(msg => console.log('<- recv', msg.content)),
            )
            .subscribe((evt) => {
                // map Sources from Xeus to VS Code
                visitSources(evt.content, (source) => {
                    if (source && source.path) {
                        const cell = this.fileToCell.get(source.path);
                        if (cell) {
                            source.name = path.basename(cell.document.uri.path);
                            const cellIndex = cell.notebook.getCells().indexOf(cell);
                            if (cellIndex >= 0) {
                                source.name += `, Cell ${cellIndex + 1}`;
                            }
                            source.path = cell.document.uri.toString();
                        }
                    }
                });

                this.sendMessage.fire(evt.content);
            });
    }

    async handleMessage(message: DebugProtocol.ProtocolMessage) {
        // console.log('-> send', message);

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
            this.kernel.connection.sendRaw(debugRequest(message as DebugProtocol.Request));
        } else if (message.type === 'response') {
            // responses of reverse requests
            this.kernel.connection.sendRaw(debugResponse(message as DebugProtocol.Response));
        } else {
            // cannot send via iopub, no way to handle events even if they existed
            console.assert(false, `Unknown message type to send ${message.type}`);
        }
    }

    dispose() {
        this.messageListener.unsubscribe();
    }

    /**
     * Dump content of given cell into a tmp file and return path to file.
     */
    private async dumpCell(uri: string): Promise<void> {
        const cell = this.notebookDocument.getCells().find((c) => c.document.uri.toString() === uri);
        if (cell) {
            try {
                const response = await this.session.customRequest('dumpCell', { code: cell.document.getText() });
                this.fileToCell.set(response.sourcePath, cell);
                this.cellToFile.set(cell.document.uri.toString(), response.sourcePath);
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
                // case 'breakpointLocations':
                //     sourceHook((request.arguments as DebugProtocol.BreakpointLocationsArguments).source);
                //     break;
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
