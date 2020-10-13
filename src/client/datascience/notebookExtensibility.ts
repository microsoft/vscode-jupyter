import { injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import type { NotebookCell } from 'vscode-proposed';
import { INotebookExtensibility, IWebviewOpenedMessage } from './types';

@injectable()
export class NotebookExtensibility implements INotebookExtensibility {
    private kernelExecute = new EventEmitter<NotebookCell>();

    private kernelRestart = new EventEmitter<void>();

    private openWebview = new EventEmitter<IWebviewOpenedMessage>();

    public get onKernelPostExecute(): Event<NotebookCell> {
        return this.kernelExecute.event;
    }

    public get onKernelRestart(): Event<void> {
        return this.kernelRestart.event;
    }

    public get onOpenWebview(): Event<IWebviewOpenedMessage> {
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

    public fireOpenWebview(msg: IWebviewOpenedMessage): void {
        this.openWebview.fire(msg);
    }
}
