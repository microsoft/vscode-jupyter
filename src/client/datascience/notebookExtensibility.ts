import { KernelMessage } from '@jupyterlab/services';
import { injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import type { NotebookCell } from '../../../types/vscode-proposed';
import { noop } from '../common/utils/misc';
import { ICell, INotebookExecutionLogger, INotebookExtensibility } from './types';
import { translateCellToNative } from './utils';

export type KernelStateEventArgs = {
    kernelId: string;
    state: KernelState;
    kernelMetadata?: KernelMessage.IInfoReply;
    cell?: NotebookCell;
};

enum KernelState {
    started,
    executed,
    restarted
}

@injectable()
export class NotebookExtensibility implements INotebookExecutionLogger, INotebookExtensibility {
    private kernelStateChange = new EventEmitter<KernelStateEventArgs>();

    public dispose() {
        noop();
    }

    public async preExecute(): Promise<void> {
        noop();
    }
    public async postExecute(cell: ICell, _silent: boolean, language: string, id: string): Promise<void> {
        const nbCell = translateCellToNative(cell, language);
        if (nbCell && nbCell.code.length > 0) {
            this.kernelStateChange.fire({
                kernelId: id,
                state: KernelState.executed,
                cell: nbCell as NotebookCell
            });
        }
    }
    public onKernelStarted(kernelMetadata: KernelMessage.IInfoReply, id: string): void {
        this.kernelStateChange.fire({
            kernelId: id,
            state: KernelState.started,
            kernelMetadata
        });
    }
    public onKernelRestarted(id: string): void {
        this.kernelStateChange.fire({
            kernelId: id,
            state: KernelState.restarted
        });
    }

    public get onKernelStateChange(): Event<KernelStateEventArgs> {
        return this.kernelStateChange.event;
    }
}
