// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { KernelMessage } from '@jupyterlab/services';
import * as path from 'path';
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
    NotebookCellKind,
    NotebookCellsChangeEvent,
    NotebookDocument,
    notebooks
} from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { traceError, traceVerbose } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IDisposable } from '../../common/types';
import { IKernel } from '../../datascience/jupyter/kernels/types';
import { IJupyterSession } from '../../datascience/types';
import { sendTelemetryEvent } from '../../telemetry';
import { DebuggingTelemetry } from '../constants';
import {
    IDebuggingDelegate,
    IDebugInfoResponse,
    IDumpCellResponse,
    IKernelDebugAdapter,
    IKernelDebugAdapterConfig,
    KernelDebugMode
} from '../types';
import { assertIsDebugConfig, getMessageSourceAndHookIt } from './helper';

// For info on the custom requests implemented by jupyter see:
// https://jupyter-client.readthedocs.io/en/stable/messaging.html#debug-request
// https://jupyter-client.readthedocs.io/en/stable/messaging.html#additions-to-the-dap
export class KernelDebugAdapter implements DebugAdapter, IKernelDebugAdapter, IDisposable {
    private readonly fileToCell = new Map<string, NotebookCell>();
    private readonly cellToFile = new Map<string, string>();
    private readonly sendMessage = new EventEmitter<DebugProtocolMessage>();
    private readonly endSession = new EventEmitter<DebugSession>();
    private readonly configuration: IKernelDebugAdapterConfig;
    private readonly disposables: IDisposable[] = [];
    private delegate: IDebuggingDelegate | undefined;
    onDidSendMessage: Event<DebugProtocolMessage> = this.sendMessage.event;
    onDidEndSession: Event<DebugSession> = this.endSession.event;
    public readonly debugCell: NotebookCell | undefined;
    private disconected: boolean = false;

    constructor(
        private session: DebugSession,
        private notebookDocument: NotebookDocument,
        private readonly jupyterSession: IJupyterSession,
        private fs: IFileSystem,
        private readonly kernel: IKernel | undefined
    ) {
        const configuration = this.session.configuration;
        assertIsDebugConfig(configuration);
        this.configuration = configuration;

        if (configuration.__mode === KernelDebugMode.Cell || configuration.__mode === KernelDebugMode.RunByLine) {
            this.debugCell = notebookDocument.cellAt(configuration.__cellIndex!);
        }

        this.disposables.push(
            this.jupyterSession.onIOPubMessage(async (msg: KernelMessage.IIOPubMessage) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const anyMsg = msg as any;

                if (anyMsg.header.msg_type === 'debug_event') {
                    this.trace('event', JSON.stringify(msg));
                    if (!(await this.delegate?.willSendEvent(anyMsg))) {
                        this.sendMessage.fire(msg.content);
                    }
                }
            })
        );

        if (this.kernel) {
            this.disposables.push(
                this.kernel.onWillRestart(() => {
                    sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onARestart' });
                    this.disconnect();
                })
            );
            this.disposables.push(
                this.kernel.onWillInterrupt(() => {
                    sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onAnInterrupt' });
                    this.disconnect();
                })
            );
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
                        !this.disconected
                    ) {
                        sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'normally' });
                        this.disconnect();
                    }
                },
                this,
                this.disposables
            )
        );

        this.disposables.push(
            notebooks.onDidChangeNotebookCells(
                (e: NotebookCellsChangeEvent) => {
                    e.changes.forEach((change) => {
                        change.deletedItems.forEach((cell: NotebookCell) => {
                            if (cell === this.debugCell) {
                                this.disconnect();
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
            void this.dumpAllCells();
        }

        if (message.type === 'request') {
            await this.delegate?.willSendRequest(message as DebugProtocol.Request);
        }

        this.sendRequestToJupyterSession(message);
    }

    public getConfiguration(): IKernelDebugAdapterConfig {
        return this.configuration;
    }

    public stepIn(threadId: number): Thenable<DebugProtocol.StepInResponse['body']> {
        return this.session.customRequest('stepIn', { threadId });
    }

    public disconnect() {
        void this.session.customRequest('disconnect', { restart: false });
        this.endSession.fire(this.session);
        this.disconected = true;
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
        // clean temp files
        this.cellToFile.forEach((tempPath) => {
            const norm = path.normalize(tempPath);
            try {
                void this.fs.deleteLocalFile(norm);
            } catch {
                traceError('Error deleting temporary debug files');
            }
        });
    }

    public stackTrace(args: DebugProtocol.StackTraceArguments): Thenable<DebugProtocol.StackTraceResponse['body']> {
        return this.session.customRequest('stackTrace', args);
    }

    public setBreakpoints(
        args: DebugProtocol.SetBreakpointsArguments
    ): Thenable<DebugProtocol.SetBreakpointsResponse['body']> {
        return this.session.customRequest('setBreakpoints', args);
    }

    private dumpAllCells() {
        this.notebookDocument.getCells().forEach(async (cell) => {
            if (cell.kind === NotebookCellKind.Code) {
                await this.dumpCell(cell.index);
            }
        });
    }

    // Dump content of given cell into a tmp file and return path to file.
    public async dumpCell(index: number): Promise<void> {
        const cell = this.notebookDocument.cellAt(index);
        if (cell) {
            try {
                const response = await this.session.customRequest('dumpCell', {
                    code: cell.document.getText().replace(/\r\n/g, '\n')
                });
                const norm = path.normalize((response as IDumpCellResponse).sourcePath);
                this.fileToCell.set(norm, cell);
                this.cellToFile.set(cell.document.uri.toString(), norm);
            } catch (err) {
                traceError(err);
            }
        }
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

    private sendRequestToJupyterSession(message: DebugProtocol.ProtocolMessage) {
        // map Source paths from VS Code to Ipykernel temp files
        getMessageSourceAndHookIt(message, (source) => {
            if (source && source.path) {
                const path = this.cellToFile.get(source.path);
                if (path) {
                    source.path = path;
                }
            }
        });

        this.trace('to kernel', JSON.stringify(message));
        if (message.type === 'request') {
            const request = message as DebugProtocol.Request;
            const control = this.jupyterSession.requestDebug({
                seq: request.seq,
                type: 'request',
                command: request.command,
                arguments: request.arguments
            });

            control.onReply = (msg) => {
                const message = msg.content as DebugProtocol.ProtocolMessage;
                getMessageSourceAndHookIt(message, (source) => {
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

                this.trace('response', JSON.stringify(message));
                this.sendMessage.fire(message);
            };
        } else if (message.type === 'response') {
            // responses of reverse requests
            const response = message as DebugProtocol.Response;
            this.jupyterSession.requestDebug({
                seq: response.seq,
                type: 'request',
                command: response.command
            });
        } else {
            // cannot send via iopub, no way to handle events even if they existed
            traceError(`Unknown message type to send ${message.type}`);
        }
    }
}
