// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IOutput } from '@jupyterlab/nbformat';
import { NotebookCell, EventEmitter, notebooks, NotebookCellExecutionState } from 'vscode';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IDisposable } from '../platform/common/types';
import { noop } from '../platform/common/utils/misc';
import { traceVerbose } from '../platform/logging';
import { Telemetry } from '../telemetry';
import { DisplayOptions } from './displayOptions';
import { traceCellMessage } from './execution/helpers';
import { KernelExecution } from './execution/kernelExecution';
import { executeSilently } from './helpers';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from './telemetry/helper';
import { sendKernelTelemetryEvent } from './telemetry/sendKernelTelemetryEvent';
import { IKernel, INotebookKernelExecution, NotebookCellRunState } from './types';

export class NotebookKernelExecution implements INotebookKernelExecution {
    private readonly disposables: IDisposable[] = [];
    get executionCount(): number {
        return this._visibleExecutionCount;
    }
    private _visibleExecutionCount = 0;
    private readonly _onPreExecute = new EventEmitter<NotebookCell>();
    public readonly onPreExecute = this._onPreExecute.event;

    constructor(private readonly kernel: IKernel, private readonly kernelExecution: KernelExecution) {
        notebooks.onDidChangeNotebookCellExecutionState((e) => {
            if (e.cell.notebook === kernel.notebook) {
                if (e.state === NotebookCellExecutionState.Idle && e.cell.executionSummary?.executionOrder) {
                    this._visibleExecutionCount = Math.max(
                        this._visibleExecutionCount,
                        e.cell.executionSummary.executionOrder
                    );
                }
            }
        });
        kernel.onRestarted(() => (this._visibleExecutionCount = 0), this, this.disposables);
        kernel.onStarted(() => (this._visibleExecutionCount = 0), this, this.disposables);
        this.kernelExecution.onPreExecute((c) => this._onPreExecute.fire(c), this, this.disposables);
        this.disposables.push(this._onPreExecute);
    }
    public get pendingCells(): readonly NotebookCell[] {
        return this.kernelExecution.queue;
    }

    public async executeCell(cell: NotebookCell, codeOverride?: string | undefined): Promise<NotebookCellRunState> {
        traceCellMessage(cell, `kernel.executeCell, ${getDisplayPath(cell.notebook.uri)}`);
        await initializeInteractiveOrNotebookTelemetryBasedOnUserAction(
            this.kernel.resourceUri,
            this.kernel.kernelConnectionMetadata
        );
        sendKernelTelemetryEvent(this.kernel.resourceUri, Telemetry.ExecuteCell);
        const sessionPromise = this.kernel.start(new DisplayOptions(false));
        const promise = this.kernelExecution.executeCell(sessionPromise, cell, codeOverride);
        promise.then((state) => traceVerbose(`Cell ${cell.index} executed with state ${state}`), noop);
        return promise;
    }
    executeHidden(code: string): Promise<IOutput[]> {
        const sessionPromise = this.kernel.start();
        return sessionPromise.then((session) => executeSilently(session, code));
    }
}
