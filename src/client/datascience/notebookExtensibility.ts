import { injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import type { NotebookCell } from '../../../types/vscode-proposed';
import { noop } from '../common/utils/misc';
import { ICell, INotebookExecutionLogger, INotebookExtensibility } from './types';
import { translateCellToNative } from './utils';

export type NotebookEvent = {
    event: KernelState;
    languages?: string[];
    cell?: NotebookCell;
};

enum KernelState {
    started,
    executed,
    restarted
}

@injectable()
export class NotebookExtensibility implements INotebookExecutionLogger, INotebookExtensibility {
    private kernelStateChange = new EventEmitter<NotebookEvent>();

    public dispose() {
        noop();
    }

    public async preExecute(): Promise<void> {
        noop();
    }
    public async postExecute(cell: ICell, _silent: boolean, language: string): Promise<void> {
        const nbCell = translateCellToNative(cell, language);
        if (nbCell && nbCell.code.length > 0) {
            this.kernelStateChange.fire({
                event: KernelState.executed,
                cell: nbCell as NotebookCell
            });
        }
    }
    public onKernelStarted(languages: string[]): void {
        this.kernelStateChange.fire({
            event: KernelState.started,
            languages
        });
    }
    public onKernelRestarted(): void {
        this.kernelStateChange.fire({
            event: KernelState.restarted
        });
    }

    public get onKernelStateChange(): Event<NotebookEvent> {
        return this.kernelStateChange.event;
    }
}
