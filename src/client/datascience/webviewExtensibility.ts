import { inject, injectable } from 'inversify';
import { NotebookCellRunState } from 'vscode';
import { CellState, IInteractiveWindowProvider, INotebookEditorProvider, IWebviewExtensibility } from './types';

@injectable()
export class WebviewExtensibility implements IWebviewExtensibility {
    constructor(
        @inject(INotebookEditorProvider) private readonly webviewNotebookProvider: INotebookEditorProvider,
        @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider
    ) {}

    public registerCellCommand(
        command: string,
        buttonHtml: string,
        statusToEnable: NotebookCellRunState[],
        interactive: boolean
    ): void {
        if (interactive) {
            this.interactiveWindowProvider.windows.forEach((window) => {
                window.createWebviewCellButton(
                    command,
                    buttonHtml,
                    statusToEnable.map((s) => this.translateCellState(s))
                );
            });
        } else {
            this.webviewNotebookProvider.editors.forEach((editor) => {
                editor.createWebviewCellButton(
                    command,
                    buttonHtml,
                    statusToEnable.map((s) => this.translateCellState(s))
                );
            });
        }
    }

    public removeCellCommand(command: string, interactive: boolean): void {
        if (interactive) {
            this.interactiveWindowProvider.windows.forEach((window) => {
                window.removeWebviewCellButton(command);
            });
        } else {
            this.webviewNotebookProvider.editors.forEach((editor) => {
                editor.removeWebviewCellButton(command);
            });
        }
    }

    private translateCellState(state: NotebookCellRunState): CellState {
        switch (state) {
            case NotebookCellRunState.Error:
                return CellState.error;
            case NotebookCellRunState.Idle:
                return CellState.init;
            case NotebookCellRunState.Running:
                return CellState.executing;
            case NotebookCellRunState.Success:
                return CellState.finished;
            default:
                return CellState.init;
        }
    }
}
