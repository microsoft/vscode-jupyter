import { inject, injectable } from 'inversify';
import { NotebookCellRunState } from 'vscode';
import { CellState, IInteractiveWindow, INotebookEditor, IWebviewExtensibility } from './types';

@injectable()
export class WebviewExtensibility implements IWebviewExtensibility {
    constructor(
        @inject(INotebookEditor) private readonly webviewNotebook: INotebookEditor,
        @inject(IInteractiveWindow) private readonly interactiveWindow: IInteractiveWindow
    ) {}

    public registerCellCommand(
        command: string,
        buttonHtml: string,
        statusToEnable: NotebookCellRunState[],
        interactive: boolean
    ): void {
        if (interactive) {
            this.interactiveWindow.createWebviewCellButton(
                command,
                buttonHtml,
                statusToEnable.map((s) => this.translateCellState(s))
            );
        } else {
            this.webviewNotebook.createWebviewCellButton(
                command,
                buttonHtml,
                statusToEnable.map((s) => this.translateCellState(s))
            );
        }
    }

    public removeCellCommand(command: string, interactive: boolean): void {
        if (interactive) {
            this.interactiveWindow.removeWebviewCellButton(command);
        } else {
            this.webviewNotebook.removeWebviewCellButton(command);
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
