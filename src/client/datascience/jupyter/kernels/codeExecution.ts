// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import { IDisposable, IDisposableRegistry } from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { IDataScienceErrorHandler, IJupyterSession, INotebook } from '../../types';
import { disposeAllDisposables } from '../../../common/helpers';
import { createDeferred } from '../../../common/utils/async';
import * as uuid from 'uuid/v4';

export class CodeExecutionFactory {
    constructor(
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly disposables: IDisposableRegistry
    ) {}

    public create(code: string) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return CodeExecution.fromCode(code, this.errorHandler, this.disposables);
    }
}

/**
 * Responsible for execution of an individual cell and manages the state of the cell as it progresses through the execution phases.
 * Execution phases include - enqueue for execution (done in ctor), start execution, completed execution with/without errors, cancel execution or dequeue.
 *
 * WARNING: Do not dispose `request: Kernel.IShellFuture` object.
 * Even after request.done & execute_reply is sent we could have more messages coming from iopub.
 * Further details here https://github.com/microsoft/vscode-jupyter/issues/232 & https://github.com/jupyter/jupyter_client/issues/297
 *
 */
export class CodeExecution implements IDisposable {
    public get output(): Promise<nbformat.IOutput[]> {
        return this._output.promise;
    }
    public id = uuid();
    private started?: boolean;
    private _completed?: boolean;
    private cancelHandled = false;
    private readonly _output = createDeferred<nbformat.IOutput[]>();

    private readonly disposables: IDisposable[] = [];
    private constructor(
        public readonly code: string,
        private readonly errorHandler: IDataScienceErrorHandler,
        disposables: IDisposableRegistry
    ) {
        disposables.push(this);
    }

    public static fromCode(code: string, errorHandler: IDataScienceErrorHandler, disposables: IDisposableRegistry) {
        return new CodeExecution(code, errorHandler, disposables);
    }
    public async start(notebook: INotebook) {
        if (this.started) {
            // TODO: Send telemetry this should never happen, if it does we have problems.
            return;
        }
        this.started = true;

        // Begin the request that will modify our cell.
        this.executeCode(notebook.session)
            .catch((e) => this.completedWithErrors(e))
            .finally(() => this.dispose())
            .catch(noop);
    }
    /**
     * Cancel execution.
     * If execution has commenced, then wait for execution to complete or kernel to start.
     * If execution has not commenced, then ensure dequeue it & revert the status to not-queued (remove spinner, etc).
     * @param {boolean} [forced=false]
     * If `true`, then do not wait for cell execution to complete gracefully (just kill it).
     * This is used when we restart the kernel (either as a result of kernel interrupt or user initiated).
     * When restarted, the execution needs to stop as jupyter will not send more messages.
     * Hence `forced=true` is more like a hard kill.
     */
    public async cancel(forced = false) {
        if (this.started && !forced) {
            return;
        }
        if (this.cancelHandled || this._completed) {
            return;
        }
        this.cancelHandled = true;

        this._completed = true;
        this._output.resolve([]);
        this.dispose();
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    private completedWithErrors(error: Partial<Error>) {
        this._completed = true;
        this._output.resolve([]);
        this.errorHandler.handleError((error as unknown) as Error).ignoreErrors();
    }

    private async executeCode(session: IJupyterSession) {
        // Skip if no code to execute
        if (this.code.trim().length === 0) {
            this._completed = true;
            this._output.resolve([]);
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        const request = session.requestExecute(
            {
                code: this.code.replace(/\r\n/g, '\n'),
                silent: false,
                stop_on_error: false,
                allow_stdin: true,
                store_history: false
            },
            true
        );
        if (!request) {
            this._completed = true;
            this._output.resolve([]);
            return;
        }
        const outputs: nbformat.IOutput[] = [];
        request.onIOPub = (msg) => {
            if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
                if (
                    outputs.length > 0 &&
                    outputs[outputs.length - 1].output_type === 'stream' &&
                    outputs[outputs.length - 1].name === msg.content.name
                ) {
                    const streamOutput = outputs[outputs.length - 1] as nbformat.IStream;
                    streamOutput.text += msg.content.text;
                } else {
                    const streamOutput: nbformat.IStream = {
                        name: msg.content.name,
                        text: msg.content.text,
                        output_type: 'stream'
                    };
                    outputs.push(streamOutput);
                }
            } else if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
                const output: nbformat.IExecuteResult = {
                    data: msg.content.data,
                    execution_count: msg.content.execution_count,
                    metadata: msg.content.metadata,
                    output_type: 'execute_result'
                };
                outputs.push(output);
            } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
                const output: nbformat.IDisplayData = {
                    data: msg.content.data,
                    metadata: msg.content.metadata,
                    output_type: 'display_data'
                };
                outputs.push(output);
            } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
                const output: nbformat.IError = {
                    ename: msg.content.ename,
                    evalue: msg.content.evalue,
                    traceback: msg.content.traceback,
                    output_type: 'error'
                };
                outputs.push(output);
            }
        };
        await request.done;

        this._completed = true;
        this._output.resolve(outputs);
    }
}
