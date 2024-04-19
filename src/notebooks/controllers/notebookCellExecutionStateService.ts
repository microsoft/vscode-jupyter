// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, type Event, type NotebookCell } from 'vscode';
import { DisposableBase, DisposableStore } from '../../platform/common/utils/lifecycle';
import { inject, injectable } from 'inversify';
import { IKernelProvider, type IKernel, type INotebookKernelExecution } from '../../kernels/types';
import {
    NotebookCellExecutionState,
    type INotebookCellExecutionStateService,
    type NotebookCellExecutionStateChangeEvent
} from './types';
import { IDisposableRegistry } from '../../platform/common/types';

@injectable()
export class NotebookCellExecutionStateService extends DisposableBase implements INotebookCellExecutionStateService {
    /**
     * An {@link Event} which fires when the execution state of a cell has changed.
     */
    // todo@API this is an event that is fired for a property that cells don't have and that makes me wonder
    // how a correct consumer works, e.g the consumer could have been late and missed an event?
    private readonly _onDidChangeNotebookCellExecutionState = this._register(
        new EventEmitter<NotebookCellExecutionStateChangeEvent>()
    );

    public get onDidChangeNotebookCellExecutionState() {
        return this._onDidChangeNotebookCellExecutionState.event;
    }
    private readonly trackedExecutions = new WeakSet<INotebookKernelExecution>();
    private readonly kernelExecutionMaps = new WeakMap<IKernel, INotebookKernelExecution>();
    private readonly kernelDisposables = new WeakMap<IKernel, DisposableStore>();
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        super();
        disposables.push(this);
        this._register(kernelProvider.onDidCreateKernel(this.monitorKernelExecutionEvents, this));
        this._register(kernelProvider.onDidStartKernel(this.monitorKernelExecutionEvents, this));
        this._register(kernelProvider.onDidDisposeKernel((k) => this.kernelDisposables.get(k)?.dispose(), this));
    }
    setPendingState(cell: NotebookCell): void {
        this.triggerStateChange(cell, NotebookCellExecutionState.Pending);
    }

    private monitorKernelExecutionEvents(kernel: IKernel) {
        const execution = this.kernelProvider.getKernelExecution(kernel);
        if (this.trackedExecutions.has(execution)) {
            return;
        }
        const disposableStore = this.kernelDisposables.get(kernel) || new DisposableStore();
        this.kernelDisposables.set(kernel, disposableStore);
        this._register(disposableStore);

        this.kernelExecutionMaps.set(kernel, execution);
        disposableStore.add(
            execution.onPreExecute((cell) => this.triggerStateChange(cell, NotebookCellExecutionState.Executing), this)
        );
        disposableStore.add(
            execution.onPostExecute((cell) => this.triggerStateChange(cell, NotebookCellExecutionState.Idle), this)
        );
    }

    private triggerStateChange(cell: NotebookCell, state: NotebookCellExecutionState) {
        this._onDidChangeNotebookCellExecutionState.fire({ cell, state: state });
    }
}
