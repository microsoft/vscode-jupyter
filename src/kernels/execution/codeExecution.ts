// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as KernelMessage from '@jupyterlab/services/lib/kernel/messages';

import type { Kernel } from '@jupyterlab/services';
import { dispose } from '../../platform/common/utils/lifecycle';
import { traceError, traceInfoIfCI, traceVerbose } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import { createDeferred } from '../../platform/common/utils/async';
import { noop } from '../../platform/common/utils/misc';
import { IKernelSession, NotebookCellRunState } from '../../kernels/types';
import { SessionDisposedError } from '../../platform/errors/sessionDisposedError';
import { ICodeExecution } from './types';
import { executeSilentlyAndEmitOutput } from '../helpers';
import { EventEmitter, NotebookCellOutputItem } from 'vscode';

function traceExecMessage(executionId: string, message: string) {
    traceVerbose(`Execution Id:${executionId}. ${message}.`);
}

const extensionIdsPerExtension = new Map<string, number>();
/**
 * Responsible for execution of an individual cell and manages the state of the cell as it progresses through the execution phases.
 * Execution phases include - enqueue for execution (done in ctor), start execution, completed execution with/without errors, cancel execution or dequeue.
 *
 * WARNING: Do not dispose `request: Kernel.IShellFuture` object.
 * Even after request.done & execute_reply is sent we could have more messages coming from iopub.
 * E.g. we could have messages from a bg thread.
 * Further details here https://github.com/microsoft/vscode-jupyter/issues/232 & https://github.com/jupyter/jupyter_client/issues/297
 */
export class CodeExecution implements ICodeExecution, IDisposable {
    public readonly type = 'code';
    public get done(): Promise<void> {
        return this._done.promise;
    }
    public get result(): Promise<NotebookCellRunState> {
        return this._done.promise.catch(noop).then(() => NotebookCellRunState.Success);
    }
    private readonly _onDidEmitOutput = new EventEmitter<NotebookCellOutputItem[]>();
    public readonly onDidEmitOutput = this._onDidEmitOutput.event;
    private readonly _onRequestSent = new EventEmitter<void>();
    public readonly onRequestSent = this._onRequestSent.event;
    private readonly _onRequestAcknowledge = new EventEmitter<void>();
    public readonly onRequestAcknowledged = this._onRequestAcknowledge.event;
    private readonly _done = createDeferred<void>();
    private started?: boolean;

    private _completed?: boolean;
    private cancelHandled = false;
    private disposed?: boolean;
    private request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> | undefined;
    private readonly disposables: IDisposable[] = [];
    private session?: IKernelSession;
    private cancelRequested?: boolean;
    public readonly executionId: string;
    private constructor(
        public readonly code: string,
        public readonly extensionId: string
    ) {
        let executionId = extensionIdsPerExtension.get(extensionId) || 0;
        executionId += 1;
        extensionIdsPerExtension.set(extensionId, executionId);
        this.executionId = `${extensionId}-${executionId}`;
        this.disposables.push(this._onDidEmitOutput);
    }

    public static fromCode(code: string, extensionId: string) {
        return new CodeExecution(code, extensionId);
    }
    public async start(session: IKernelSession) {
        this.session = session;
        if (this.cancelHandled) {
            traceExecMessage(this.executionId, 'Not starting as it was cancelled');
            return;
        }
        traceExecMessage(this.executionId, 'Start Code execution');
        traceInfoIfCI(`Code Exec contents ${this.code.substring(0, 50)}...`);
        if (!session.kernel || session.kernel.isDisposed || session.isDisposed) {
            this._done.reject(new SessionDisposedError());
            return;
        }

        if (this.started) {
            traceExecMessage(this.executionId, 'Code has already been started yet CodeExecution.Start invoked again');
            traceError(`Code has already been started yet CodeExecution.Start invoked again ${this.executionId}`);
            // TODO: Send telemetry this should never happen, if it does we have problems.
            return this.done;
        }

        // Begin the request that will modify our cell.
        await this.execute(this.code.replace(/\r\n/g, '\n'), session).catch(noop);
    }

    /**
     * Cancel execution.
     * If execution has commenced, then interrupt and wait for execution to complete.
     * If execution has not commenced, then ensure dequeue it.
     */
    public async cancel() {
        if (this.cancelHandled || this._completed) {
            return;
        }
        this.cancelRequested = true;
        if (this.started) {
            // At this point the cell execution can only be stopped from kernel by interrupting it.
            // stop handling execution results & the like from the kernel.
            traceExecMessage(
                this.executionId,
                'Code is already running, interrupting and waiting for it to finish or kernel to start'
            );
            const kernel = this.session?.kernel;
            if (kernel) {
                await kernel.interrupt().catch(noop);
            }
            // This is the only time we cancel the request.
            // Else never cancel it as there could be background messages coming through (from bg threads).
            this.request?.dispose();
            await this.request?.done.catch(noop);
        }
        if (this.cancelHandled || this._completed) {
            return;
        }
        traceExecMessage(this.executionId, 'Execution cancelled');
        this.cancelHandled = true;
        this._done.resolve();
        this.dispose();
    }
    /**
     * This method is called when all execution has been completed (successfully or failed).
     * Or when execution has been cancelled.
     */
    public dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        if (!this._completed) {
            traceExecMessage(this.executionId, 'Execution disposed');
        }
        dispose(this.disposables);
    }

    private async execute(code: string, session: IKernelSession) {
        if (!session.kernel) {
            const error = new Error('No kernel available to execute code');
            this._done.resolve();
            throw error;
        }
        traceExecMessage(this.executionId, 'Send code for execution');

        const kernelConnection = session.kernel;
        try {
            this.started = true;
            this._onRequestSent.fire();
            traceExecMessage(this.executionId, `Execution Request Sent to Kernel`);
            // For Jupyter requests, silent === don't output, while store_history === don't update execution count
            // https://jupyter-client.readthedocs.io/en/stable/api/client.html#jupyter_client.KernelClient.execute
            this.request = await executeSilentlyAndEmitOutput(
                kernelConnection,
                code,
                () => this._onRequestAcknowledge.fire(),
                (outputs) => {
                    if (outputs.length) {
                        this._onDidEmitOutput.fire(outputs);
                    }
                }
            );
            // Don't want dangling promises.
            this.request.done.then(noop, noop);
        } catch (ex) {
            traceError(`Code execution failed without request, for exec ${this.executionId}`, ex);
            this._completed = true;
            this._done.resolve();
            return;
        }

        // WARNING: Do not dispose `request`.
        // Even after request.done & execute_reply is sent we could have more messages coming from iopub.
        // E.g. background threads.

        try {
            // When the request finishes we are done
            // request.done resolves even before all iopub messages have been sent through.
            // Solution is to wait for all messages to get processed.
            await this.request!.done.catch(noop);
            this._completed = true;
            this._done.resolve();
            traceExecMessage(this.executionId, 'Executed successfully');
        } catch (ex) {
            this._completed = true;
            if (this.cancelHandled) {
                return;
            }
            if (!this.disposed && !this.cancelRequested) {
                // @jupyterlab/services throws a `Canceled` error when the kernel is interrupted.
                // Or even when the kernel dies when running a cell with the code `os.kill(os.getpid(), 9)`
                traceError(`Error in waiting for code ${this.executionId} to complete`, ex);
            } else {
                traceError(`Some other execution error for exec ${this.executionId}`, ex);
            }
            this._done.resolve();
        }
    }
}
