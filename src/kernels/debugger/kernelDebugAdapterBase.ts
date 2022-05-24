// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { KernelMessage } from '@jupyterlab/services';
import * as path from '../../platform/vscode-path/path';
import {
    debug,
    DebugAdapter,
    DebugProtocolMessage,
    DebugSession,
    Event,
    EventEmitter,
    NotebookCell,
    NotebookCellExecutionState,
    NotebookCellExecutionStateChangeEvent,
    NotebookDocument,
    notebooks,
    Uri,
    workspace
} from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IJupyterSession, IKernel } from '../types';
import { IPlatformService } from '../../platform/common/platform/types';
import { DebuggingTelemetry } from './constants';
import {
    IKernelDebugAdapter,
    IKernelDebugAdapterConfig,
    IDebuggingDelegate,
    KernelDebugMode,
    IDebugInfoResponse
} from './types';
import { sendTelemetryEvent } from '../../telemetry';
import { IDisposable } from '../../platform/common/types';
import { traceError, traceInfo, traceInfoIfCI, traceVerbose } from '../../platform/logging';
import {
    assertIsDebugConfig,
    isShortNamePath,
    shortNameMatchesLongName,
    getMessageSourceAndHookIt
} from '../../notebooks/debugger/helper';

/**
 * For info on the custom requests implemented by jupyter see:
 * https://jupyter-client.readthedocs.io/en/stable/messaging.html#debug-request
 * https://jupyter-client.readthedocs.io/en/stable/messaging.html#additions-to-the-dap
 */
export abstract class KernelDebugAdapterBase implements DebugAdapter, IKernelDebugAdapter, IDisposable {
    protected readonly fileToCell = new Map<
        string,
        {
            uri: Uri;
            lineOffset?: number;
        }
    >();
    protected readonly cellToFile = new Map<
        string,
        {
            path: string;
            lineOffset?: number;
        }
    >();
    private readonly sendMessage = new EventEmitter<DebugProtocolMessage>();
    private readonly endSession = new EventEmitter<DebugSession>();
    private readonly configuration: IKernelDebugAdapterConfig;
    protected readonly disposables: IDisposable[] = [];
    private delegate: IDebuggingDelegate | undefined;
    onDidSendMessage: Event<DebugProtocolMessage> = this.sendMessage.event;
    onDidEndSession: Event<DebugSession> = this.endSession.event;
    public readonly debugCell: NotebookCell | undefined;
    private disconnected: boolean = false;
    private kernelEventHook = (_event: 'willRestart' | 'willInterrupt') => this.disconnect();
    constructor(
        protected session: DebugSession,
        protected notebookDocument: NotebookDocument,
        protected readonly jupyterSession: IJupyterSession,
        private readonly kernel: IKernel | undefined,
        private readonly platformService: IPlatformService
    ) {
        traceInfoIfCI(`Creating kernel debug adapter for debugging notebooks`);
        const configuration = this.session.configuration;
        assertIsDebugConfig(configuration);
        this.configuration = configuration;

        if (
            configuration.__mode === KernelDebugMode.InteractiveWindow ||
            configuration.__mode === KernelDebugMode.Cell ||
            configuration.__mode === KernelDebugMode.RunByLine
        ) {
            this.debugCell = notebookDocument.cellAt(configuration.__cellIndex!);
        }

        this.disposables.push(
            this.jupyterSession.onIOPubMessage(async (msg: KernelMessage.IIOPubMessage) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const anyMsg = msg as any;
                traceInfoIfCI(`Debug IO Pub message: ${JSON.stringify(msg)}`);
                if (anyMsg.header.msg_type === 'debug_event') {
                    this.trace('event', JSON.stringify(msg));
                    if (!(await this.delegate?.willSendEvent(anyMsg))) {
                        this.sendMessage.fire(msg.content);
                    }
                }
            })
        );

        if (this.kernel) {
            this.kernel.addEventHook(this.kernelEventHook);
            this.disposables.push(
                this.kernel.onDisposed(() => {
                    void debug.stopDebugging(this.session);
                    this.endSession.fire(this.session);
                    sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onKernelDisposed' });
                })
            );
        }

        this.disposables.push(
            notebooks.onDidChangeNotebookCellExecutionState(
                (cellStateChange: NotebookCellExecutionStateChangeEvent) => {
                    // If a cell has moved to idle, stop the debug session
                    if (
                        this.configuration.__cellIndex === cellStateChange.cell.index &&
                        cellStateChange.state === NotebookCellExecutionState.Idle &&
                        !this.disconnected
                    ) {
                        sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'normally' });
                        void this.disconnect();
                    }
                },
                this,
                this.disposables
            )
        );

        this.disposables.push(
            workspace.onDidChangeNotebookDocument(
                (e) => {
                    e.contentChanges.forEach((change) => {
                        change.removedCells.forEach((cell: NotebookCell) => {
                            if (cell === this.debugCell) {
                                void this.disconnect();
                            }
                        });
                    });
                },
                this,
                this.disposables
            )
        );
    }

    public setDebuggingDelegate(delegate: IDebuggingDelegate) {
        this.delegate = delegate;
    }

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug] ${tag}: ${msg}`);
    }

    async handleMessage(message: DebugProtocol.ProtocolMessage) {
        try {
            traceInfoIfCI(`KernelDebugAdapter::handleMessage ${JSON.stringify(message, undefined, ' ')}`);
            // intercept 'setBreakpoints' request
            if (message.type === 'request' && (message as DebugProtocol.Request).command === 'setBreakpoints') {
                const args = (message as DebugProtocol.Request).arguments;
                if (args.source && args.source.path && args.source.path.indexOf('vscode-notebook-cell:') === 0) {
                    const cell = this.notebookDocument
                        .getCells()
                        .find((c) => c.document.uri.toString() === args.source.path);
                    if (cell) {
                        await this.dumpCell(cell.index);
                    }
                }
            }

            // after attaching, send a 'debugInfo' request
            // reset breakpoints and continue stopped threads if there are any
            // we do this in case the kernel is stopped when we attach
            // This might happen if VS Code or the extension host crashes
            if (message.type === 'request' && (message as DebugProtocol.Request).command === 'attach') {
                await this.debugInfo();
            }

            if (message.type === 'request') {
                await this.delegate?.willSendRequest(message as DebugProtocol.Request);
            }

            return this.sendRequestToJupyterSession(message);
        } catch (e) {
            traceError(`KernelDebugAdapter::handleMessage failure: ${e}`);
        }
    }

    public getConfiguration(): IKernelDebugAdapterConfig {
        return this.configuration;
    }

    public stepIn(threadId: number): Thenable<DebugProtocol.StepInResponse['body']> {
        return this.session.customRequest('stepIn', { threadId });
    }

    public async disconnect() {
        await this.session.customRequest('disconnect', { restart: false });
        this.endSession.fire(this.session);
        this.disconnected = true;
        this.kernel?.removeEventHook(this.kernelEventHook);
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    public stackTrace(args: DebugProtocol.StackTraceArguments): Thenable<DebugProtocol.StackTraceResponse['body']> {
        return this.session.customRequest('stackTrace', args);
    }

    public setBreakpoints(
        args: DebugProtocol.SetBreakpointsArguments
    ): Thenable<DebugProtocol.SetBreakpointsResponse['body']> {
        return this.session.customRequest('setBreakpoints', args);
    }

    public abstract dumpAllCells(): Promise<void>;
    protected abstract dumpCell(index: number): Promise<void>;
    public getSourcePath(filePath: string) {
        return this.cellToFile.get(filePath)?.path;
    }

    private async debugInfo(): Promise<void> {
        const response = await this.session.customRequest('debugInfo');

        // If there's stopped threads at this point, continue them all
        (response as IDebugInfoResponse).stoppedThreads.forEach((thread: number) => {
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

    private lookupCellByLongName(sourcePath: string) {
        if (!this.platformService.isWindows) {
            return undefined;
        }

        sourcePath = path.normalize(sourcePath);
        for (let [file, cell] of this.fileToCell.entries()) {
            if (isShortNamePath(file) && shortNameMatchesLongName(file, sourcePath)) {
                return cell;
            }
        }

        return undefined;
    }

    private async sendRequestToJupyterSession(message: DebugProtocol.ProtocolMessage) {
        if (this.jupyterSession.disposed || this.jupyterSession.status === 'dead') {
            traceInfo(`Skipping sending message ${message.type} because session is disposed`);
            return;
        }
        // map Source paths from VS Code to Ipykernel temp files
        getMessageSourceAndHookIt(message, (source, lines?: { line?: number; endLine?: number; lines?: number[] }) => {
            if (source && source.path) {
                const mapping = this.cellToFile.get(source.path);
                if (mapping) {
                    source.path = mapping.path;
                    if (typeof lines?.endLine === 'number') {
                        lines.endLine = lines.endLine - (mapping.lineOffset || 0);
                    }
                    if (typeof lines?.line === 'number') {
                        lines.line = lines.line - (mapping.lineOffset || 0);
                    }
                    if (lines?.lines && Array.isArray(lines?.lines)) {
                        lines.lines = lines?.lines.map((line) => line - (mapping.lineOffset || 0));
                    }
                }
            }
        });

        this.trace('to kernel', JSON.stringify(message));
        if (message.type === 'request') {
            const request = message as DebugProtocol.Request;
            const control = this.jupyterSession.requestDebug(
                {
                    seq: request.seq,
                    type: 'request',
                    command: request.command,
                    arguments: request.arguments
                },
                true
            );

            control.onReply = (msg) => {
                const message = msg.content as DebugProtocol.ProtocolMessage;
                getMessageSourceAndHookIt(
                    message,
                    (source, lines?: { line?: number; endLine?: number; lines?: number[] }) => {
                        if (source && source.path) {
                            const mapping = this.fileToCell.get(source.path) ?? this.lookupCellByLongName(source.path);
                            if (mapping) {
                                source.name = path.basename(mapping.uri.path);
                                source.path = mapping.uri.toString();
                                if (typeof lines?.endLine === 'number') {
                                    lines.endLine = lines.endLine + (mapping.lineOffset || 0);
                                }
                                if (typeof lines?.line === 'number') {
                                    lines.line = lines.line + (mapping.lineOffset || 0);
                                }
                                if (lines?.lines && Array.isArray(lines?.lines)) {
                                    lines.lines = lines?.lines.map((line) => line + (mapping.lineOffset || 0));
                                }
                            }
                        }
                    }
                );

                this.trace('response', JSON.stringify(message));
                this.sendMessage.fire(message);
            };
            return control.done;
        } else if (message.type === 'response') {
            // responses of reverse requests
            const response = message as DebugProtocol.Response;
            const control = this.jupyterSession.requestDebug(
                {
                    seq: response.seq,
                    type: 'request',
                    command: response.command
                },
                true
            );
            return control.done;
        } else {
            // cannot send via iopub, no way to handle events even if they existed
            traceError(`Unknown message type to send ${message.type}`);
        }
    }
}
