// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import {
    debug,
    DebugAdapter,
    DebugProtocolMessage,
    DebugSession,
    Disposable,
    Event,
    EventEmitter,
    NotebookCell,
    NotebookCellExecutionState,
    NotebookCellExecutionStateChangeEvent,
    NotebookCellKind,
    NotebookDocument,
    notebooks,
    Uri,
    workspace
} from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { executeSilently } from '../../kernels/helpers';
import { IKernel, IKernelSession } from '../../kernels/types';
import { IDebugService } from '../../platform/common/application/types';
import { IPlatformService } from '../../platform/common/platform/types';
import { IDisposable } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { traceError, traceInfo, traceInfoIfCI, traceVerbose, traceWarning } from '../../platform/logging';
import * as path from '../../platform/vscode-path/path';
import { sendTelemetryEvent } from '../../telemetry';
import { DebuggingTelemetry } from './constants';
import { ResetKernelController } from './controllers/resetKernelController';
import { IDebuggingDelegate, IDebugInfoResponse, IKernelDebugAdapter, INotebookDebugConfig } from './debuggingTypes';
import {
    assertIsDebugConfig,
    getMessageSourceAndHookIt,
    isDebugEventMsg,
    isShortNamePath,
    shortNameMatchesLongName
} from './helper';
import { SessionDisposedError } from '../../platform/errors/sessionDisposedError';

/**
 * For info on the custom requests implemented by jupyter see:
 * https://jupyter-client.readthedocs.io/en/stable/messaging.html#debug-request
 * https://jupyter-client.readthedocs.io/en/stable/messaging.html#additions-to-the-dap
 */

/**
 * Base class for a debug adapter for connecting to a jupyter kernel. The DebugAdapter is responsible for translating DAP requests for a kernel.
 */
export abstract class KernelDebugAdapterBase implements DebugAdapter, IKernelDebugAdapter, IDisposable {
    protected readonly fileToCell = new Map<string, Uri>();
    private readonly sendMessage = new EventEmitter<DebugProtocolMessage>();
    private readonly endSession = new EventEmitter<DebugSession>();
    private readonly configuration: INotebookDebugConfig;
    protected readonly disposables: IDisposable[] = [];
    private delegates: IDebuggingDelegate[] = [];
    onDidSendMessage: Event<DebugProtocolMessage> = this.sendMessage.event;
    onDidEndSession: Event<DebugSession> = this.endSession.event;
    public readonly debugCell: NotebookCell | undefined;
    private disconnected: boolean = false;
    constructor(
        protected session: DebugSession,
        protected notebookDocument: NotebookDocument,
        protected readonly jupyterSession: IKernelSession,
        private readonly kernel: IKernel | undefined,
        private readonly platformService: IPlatformService,
        private readonly debugService: IDebugService
    ) {
        traceInfoIfCI(`Creating kernel debug adapter for debugging notebooks`);
        const configuration = this.session.configuration;
        assertIsDebugConfig(configuration);
        this.configuration = configuration;
        this.debugCell = notebookDocument.cellAt(configuration.__cellIndex!);

        this.addDebuggingDelegates([new ResetKernelController(this)]);

        this.jupyterSession.kernel?.iopubMessage.connect(this.onIOPubMessage, this);
        this.disposables.push(
            new Disposable(() => this.jupyterSession.kernel?.iopubMessage.disconnect(this.onIOPubMessage, this))
        );

        if (this.kernel) {
            this.kernel.addHook('willRestart', () => this.disconnect(), this, this.disposables);
            this.kernel.addHook('interruptCompleted', () => this.disconnect(), this, this.disposables);
            this.disposables.push(
                this.kernel.onDisposed(() => {
                    if (!this.disconnected) {
                        debug.stopDebugging(this.session).then(noop, noop);
                        this.disconnect().catch(noop);
                        sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onKernelDisposed' });
                    }
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
                        this.disconnect().catch(noop);
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
                                this.disconnect().catch(noop);
                            }
                        });
                    });
                },
                this,
                this.disposables
            )
        );
        this.disposables.push(
            this.debugService.onDidTerminateDebugSession((e) => {
                if (e === this.session || e === this.session) {
                    this.disconnect().catch(noop);
                }
            })
        );
    }

    public addDebuggingDelegates(delegates: IDebuggingDelegate[]) {
        this.delegates.push(...delegates);
    }

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug] ${tag}: ${msg}`);
    }

    async onIOPubMessage(_: unknown, msg: KernelMessage.IIOPubMessage) {
        traceInfoIfCI(`Debug IO Pub message: ${JSON.stringify(msg)}`);
        if (isDebugEventMsg(msg)) {
            this.trace('event', JSON.stringify(msg));
            for (const d of this.delegates ?? []) {
                if (await d?.willSendEvent?.(msg.content)) {
                    return;
                }
            }

            this.sendMessage.fire(msg.content);
        }
    }

    /**
     * Handle a message from the client to the debug adapter.
     */
    handleMessage(message: DebugProtocol.ProtocolMessage): void {
        this.handleClientMessageAsync(message).catch(noop);
    }

    protected async handleClientMessageAsync(message: DebugProtocol.ProtocolMessage): Promise<void> {
        try {
            traceInfoIfCI(`KernelDebugAdapter::handleMessage ${JSON.stringify(message, undefined, ' ')}`);

            // Necessary, since dumpCell usually runs before debugging starts?
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

            if (message.type === 'request') {
                for (const d of this.delegates ?? []) {
                    const response = await d?.willSendRequest?.(message as DebugProtocol.Request);
                    if (response) {
                        this.trace('response', JSON.stringify(response));
                        this.sendMessage.fire(response);
                        return;
                    }
                }
            }

            await this.sendMessageToJupyterSession(message);
        } catch (e) {
            traceError(`KernelDebugAdapter::handleMessage failure: ${e}`);
        }
    }

    public getConfiguration(): INotebookDebugConfig {
        return this.configuration;
    }

    public stepIn(threadId: number): Thenable<DebugProtocol.StepInResponse['body']> {
        return this.session.customRequest('stepIn', { threadId });
    }

    public async debugInfo(): Promise<IDebugInfoResponse> {
        return await this.session.customRequest('debugInfo');
    }

    public continueDirect(threadId: number): void {
        if (!this.jupyterSession.kernel) {
            throw new SessionDisposedError();
        }
        this.jupyterSession.kernel.requestDebug({
            seq: 0,
            type: 'request',
            command: 'continue',
            arguments: {
                threadId
            }
        });
    }

    public async disconnect() {
        if (!this.disconnected) {
            this.disconnected = true;
            if (
                this.debugService.activeDebugSession === this.session ||
                this.debugService.activeDebugSession?.id === this.session.id
            ) {
                try {
                    await Promise.all([
                        this.deleteDumpedFiles().catch((ex) =>
                            traceWarning('Error deleting temporary debug files.', ex)
                        ),
                        this.session.customRequest('disconnect', { restart: false })
                    ]);
                } catch (e) {
                    traceError(`Failed to disconnect debug session`, e);
                }
            }
            this.endSession.fire(this.session);
        }
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

    public async dumpAllCells() {
        await Promise.all(
            this.notebookDocument.getCells().map(async (cell) => {
                if (cell.kind === NotebookCellKind.Code) {
                    await this.dumpCell(cell.index);
                }
            })
        );
    }
    protected abstract dumpCell(index: number): Promise<void>;

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

    protected async sendMessageToJupyterSession(message: DebugProtocol.ProtocolMessage) {
        if (this.jupyterSession.isDisposed || this.jupyterSession.status === 'dead' || !this.jupyterSession.kernel) {
            traceInfo(`Skipping sending message ${message.type} because session is disposed`);
            return;
        }

        this.trace('to kernel', JSON.stringify(message));
        if (message.type === 'request') {
            const response = await this.sendRequestToJupyterSession(message);
            if (response) {
                this.sendMessage.fire(response);
            }
        } else if (message.type === 'response') {
            getMessageSourceAndHookIt(message, this.translateRealLocationToDebuggerLocation.bind(this));
            // responses of reverse requests
            const response = message as DebugProtocol.Response;
            const control = this.jupyterSession.kernel.requestDebug(
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

    protected async sendRequestToJupyterSession(
        message: DebugProtocol.ProtocolMessage
    ): Promise<DebugProtocol.Response> {
        getMessageSourceAndHookIt(message, this.translateRealLocationToDebuggerLocation.bind(this));
        if (!this.jupyterSession.kernel) {
            throw new SessionDisposedError();
        }

        this.trace('to kernel, mapped', JSON.stringify(message));
        const request = message as DebugProtocol.Request;
        const control = this.jupyterSession.kernel.requestDebug(
            {
                seq: request.seq,
                type: 'request',
                command: request.command,
                arguments: request.arguments
            },
            true
        );
        const msg = await control.done;
        const response = msg.content as DebugProtocol.Response;
        getMessageSourceAndHookIt(response, this.translateDebuggerLocationToRealLocation.bind(this));

        for (const d of this.delegates ?? []) {
            await d?.willSendResponse?.(response);
        }

        this.trace('response', JSON.stringify(response));
        return response;
    }

    protected translateDebuggerLocationToRealLocation(
        location: {
            source?: DebugProtocol.Source;
            line?: number;
            endLine?: number;
        },
        source?: DebugProtocol.Source
    ) {
        source = location?.source ?? source;
        if (source && source.path) {
            const mapping = this.fileToCell.get(source.path) ?? this.lookupCellByLongName(source.path);
            if (mapping) {
                source.name = path.basename(mapping.path);
                source.path = mapping.toString();
            }
        }
    }

    protected abstract translateRealLocationToDebuggerLocation(
        location: {
            source?: DebugProtocol.Source;
            line?: number;
            endLine?: number;
        },
        source?: DebugProtocol.Source
    ): void;

    protected abstract getDumpFilesForDeletion(): string[];
    private async deleteDumpedFiles(): Promise<void> {
        const fileValues = this.getDumpFilesForDeletion();
        // Need to have our Jupyter Session and some dumpCell files to delete
        if (this.jupyterSession.kernel && fileValues.length) {
            // Create our python string of file names
            const fileListString = fileValues
                .map((filePath) => {
                    // escape Windows path separators again for python
                    return '"' + filePath.replace(/\\/g, '\\\\') + '"';
                })
                .join(',');

            // Insert into our delete snippet
            const deleteFilesCode = `import os as _VSCODE_os
_VSCODE_fileList = [${fileListString}]
for file in _VSCODE_fileList:
    try:
        _VSCODE_os.remove(file)
    except:
        pass
del _VSCODE_fileList
del _VSCODE_os`;

            await executeSilently(this.jupyterSession.kernel, deleteFilesCode, {
                traceErrors: true,
                traceErrorsMessage: 'Error deleting temporary debugging files'
            });
        }
    }
}
