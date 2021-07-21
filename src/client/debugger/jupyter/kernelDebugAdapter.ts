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
import { KernelMessage } from '@jupyterlab/services';
import { ICommandManager } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IKernelDebugAdapter } from '../types';

const debugRequest = (message: DebugProtocol.Request, jupyterSessionId: string): KernelMessage.IDebugRequestMsg => {
    return {
        channel: 'control',
        header: {
            msg_id: randomBytes(8).toString('hex'),
            date: new Date().toISOString(),
            version: '5.2',
            msg_type: 'debug_request',
            username: 'vscode',
            session: jupyterSessionId
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

const debugResponse = (message: DebugProtocol.Response, jupyterSessionId: string): KernelMessage.IDebugReplyMsg => {
    return {
        channel: 'control',
        header: {
            msg_id: randomBytes(8).toString('hex'),
            date: new Date().toISOString(),
            version: '5.2',
            msg_type: 'debug_reply',
            username: 'vscode',
            session: jupyterSessionId
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
export class KernelDebugAdapter implements DebugAdapter, IKernelDebugAdapter {
    private readonly fileToCell = new Map<string, NotebookCell>();
    private readonly cellToFile = new Map<string, string>();
    private readonly sendMessage = new EventEmitter<DebugProtocolMessage>();
    private isRunByLine = false;
    private runByLineThreadId: number = 1;
    private runByLineSeq: number = 0;

    onDidSendMessage: Event<DebugProtocolMessage> = this.sendMessage.event;

    constructor(
        private session: DebugSession,
        private notebookDocument: NotebookDocument,
        private readonly jupyterSession: IJupyterSession,
        private cellMap: IDebuggingCellMap,
        private commandManager: ICommandManager,
        private fs: IFileSystem
    ) {
        if (this.session.name.includes('RBL=')) {
            this.isRunByLine = true;
        }
        const iopubHandler = (msg: KernelMessage.IIOPubMessage) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const content = msg.content as any;
            if (content.event === 'stopped') {
                this.runByLineThreadId = content.body.threadId;
                this.runByLineSeq = content.seq;

                if (this.isRunByLine) {
                    this.RunByLineStackTrace();
                }
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
        if (
            !this.isRunByLine &&
            message.type === 'request' &&
            (message as DebugProtocol.Request).command === 'disconnect'
        ) {
            void this.commandManager.executeCommand('notebook.toggleBreakpointMargin', this.notebookDocument);
        }

        // initialize Run By Line
        if (
            this.isRunByLine &&
            message.type === 'request' &&
            (message as DebugProtocol.Request).command === 'configurationDone'
        ) {
            await this.initializeRunByLine(message.seq);
        }

        this.sendRequestToJupyterSession(message);
    }

    public runByLineContinue() {
        if (this.isRunByLine) {
            const message: DebugProtocol.StepInRequest = {
                seq: this.runByLineSeq,
                type: 'request',
                command: 'stepIn',
                arguments: {
                    threadId: this.runByLineThreadId
                }
            };

            this.sendRequestToJupyterSession(message);
        }
    }

    public runByLineStop() {
        if (this.isRunByLine) {
            const message: DebugProtocol.DisconnectRequest = {
                seq: this.runByLineSeq,
                type: 'request',
                command: 'disconnect',
                arguments: {
                    restart: false
                }
            };

            this.sendRequestToJupyterSession(message);
        }
    }

    dispose() {
        // clean temp files
        this.cellToFile.forEach((tempPath) => {
            const norm = path.normalize(tempPath);
            const dir = path.dirname(norm);
            try {
                void this.fs.deleteLocalFile(norm);
                void this.fs.deleteLocalDirectory(dir);
            } catch {
                traceError('Error deleting temporary debug files');
            }
        });
    }

    private RunByLineStackTrace(): void {
        const message: DebugProtocol.StackTraceRequest = {
            seq: this.runByLineSeq,
            type: 'request',
            command: 'stackTrace',
            arguments: {
                threadId: this.runByLineThreadId
            }
        };

        this.sendRequestToJupyterSession(message);
    }

    private runByLineScope(frameId: number): void {
        const message: DebugProtocol.ScopesRequest = {
            seq: this.runByLineSeq,
            type: 'request',
            command: 'scopes',
            arguments: {
                frameId: frameId
            }
        };

        this.sendRequestToJupyterSession(message);
    }

    private RunByLineVariables(variablesReference: number): void {
        const message: DebugProtocol.VariablesRequest = {
            seq: this.runByLineSeq,
            type: 'request',
            command: 'variables',
            arguments: {
                variablesReference: variablesReference
            }
        };

        this.sendRequestToJupyterSession(message);
        // this.sendMessage.fire(message);
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

    private sendRequestToJupyterSession(message: DebugProtocol.ProtocolMessage) {
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
            const request = debugRequest(message as DebugProtocol.Request, this.jupyterSession.sessionId);
            const control = this.jupyterSession.requestDebug({
                seq: request.content.seq,
                type: 'request',
                command: request.content.command,
                arguments: request.content.arguments
            });

            if (control) {
                control.onReply = (msg) => this.controlCallback(msg.content as DebugProtocol.ProtocolMessage);
                control.onIOPub = (msg) => this.controlCallback(msg.content as DebugProtocol.ProtocolMessage);
            }
        } else if (message.type === 'response') {
            // responses of reverse requests
            const response = debugResponse(message as DebugProtocol.Response, this.jupyterSession.sessionId);
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

        if ((message as DebugProtocol.StackTraceResponse).command === 'stackTrace') {
            (message as DebugProtocol.StackTraceResponse).body.stackFrames.forEach((sf) => {
                this.runByLineScope(sf.id);
                // check if sf.source?.path is on the cell, if its not, stepInto again
            });
        }

        if ((message as DebugProtocol.ScopesResponse).command === 'scopes') {
            (message as DebugProtocol.ScopesResponse).body.scopes.forEach((s) => {
                this.RunByLineVariables(s.variablesReference);
            });
        }

        if ((message as DebugProtocol.VariablesResponse).command === 'variables') {
            console.error('-----------------------');
            console.error(message as DebugProtocol.VariablesResponse);
        }

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

    private async initializeRunByLine(seq: number) {
        const response = await this.session.customRequest('debugInfo');

        // If there's breakpoints at this point, send a message to VS Code to delete them
        (response as debugInfoResponse).breakpoints.forEach((breakpoint) => {
            const message: DebugProtocol.SetBreakpointsRequest = {
                seq: 0,
                type: 'request',
                command: 'setBreakpoints',
                arguments: {
                    source: {
                        path: breakpoint.source
                    },
                    breakpoints: []
                }
            };
            this.sendMessage.fire(message);
        });

        // put breakpoint at the beginning of the cell
        const index = this.session.name.indexOf('RBL=');
        const cellIndex = Number(this.session.name.substring(index + 4));
        const cell = this.notebookDocument.cellAt(cellIndex);

        const initialBreakpoint: DebugProtocol.SourceBreakpoint = {
            line: 1
        };
        const splitPath = cell.notebook.uri.path.split('/');
        const name = splitPath[splitPath.length - 1];
        const message: DebugProtocol.SetBreakpointsRequest = {
            seq: seq + 1,
            type: 'request',
            command: 'setBreakpoints',
            arguments: {
                source: {
                    name: name,
                    path: cell.document.uri.toString()
                },
                lines: [1],
                breakpoints: [initialBreakpoint],
                sourceModified: false
            }
        };

        const args = (message as DebugProtocol.Request).arguments;
        if (args.source && args.source.path && args.source.path.indexOf('vscode-notebook-cell:') === 0) {
            await this.dumpCell(args.source.path);
        }

        this.sendRequestToJupyterSession(message);

        // Run cell
        await this.commandManager.executeCommand('notebook.cell.execute');
    }
}
