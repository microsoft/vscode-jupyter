import { injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import type { NotebookCell } from 'vscode-proposed';
import { INotebookExtensibility } from './types';

@injectable()
export class NotebookExtensibility implements INotebookExtensibility {
    private kernelExecute = new EventEmitter<NotebookCell>();

    private kernelRestart = new EventEmitter<void>();

    private openWebview = new EventEmitter<string[]>();

    public get onKernelPostExecute(): Event<NotebookCell> {
        return this.kernelExecute.event;
    }

    public get onKernelRestart(): Event<void> {
        return this.kernelRestart.event;
    }

    public get onOpenWebview(): Event<string[]> {
        return this.openWebview.event;
    }

    public fireKernelRestart(): void {
        this.kernelRestart.fire();
    }

    public fireKernelPostExecute(cell: NotebookCell): void {
        const text = cell.document.getText();
        if (text.length > 0) {
            this.kernelExecute.fire(cell);
        }
    }

    public fireOpenWebview(languages: string[]): void {
        this.openWebview.fire(languages);
    }
}
