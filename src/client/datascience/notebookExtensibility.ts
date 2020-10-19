import { injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import type { NotebookCell } from '../../../types/vscode-proposed';
import { noop } from '../common/utils/misc';
import { ICell, INotebookExecutionLogger, INotebookExtensibility } from './types';
import { cellTranslate } from './utils';

@injectable()
export class NotebookExtensibility implements INotebookExecutionLogger, INotebookExtensibility {
    private kernelExecute = new EventEmitter<NotebookCell>();

    private kernelRestart = new EventEmitter<void>();

    private kernelStart = new EventEmitter<string[]>();

    public dispose() {
        noop();
    }

    public async preExecute(): Promise<void> {
        noop();
    }
    public async postExecute(cell: ICell, _silent: boolean, language: string): Promise<void> {
        const nbCell = cellTranslate(cell, language);
        if (nbCell && nbCell.code.length > 0) {
            this.kernelExecute.fire(nbCell as NotebookCell);
        }
    }
    public onKernelStarted(languages: string[]): void {
        this.kernelStart.fire(languages);
    }
    public onKernelRestarted(): void {
        this.kernelRestart.fire();
    }

    public get onKernelPostExecute(): Event<NotebookCell> {
        return this.kernelExecute.event;
    }

    public get onKernelRestart(): Event<void> {
        return this.kernelRestart.event;
    }

    public get onKernelStart(): Event<string[]> {
        return this.kernelStart.event;
    }
}
