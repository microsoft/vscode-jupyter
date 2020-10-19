import { inject, injectable } from 'inversify';
import { NotebookCellRunState } from 'vscode';
import { IInteractiveWindowProvider, INotebookEditorProvider, IWebviewExtensibility } from './types';
import { translateCellStateFromNative } from './utils';

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
        tooltip: string
    ): void {
        this.interactiveWindowProvider.windows.forEach((window) => {
            window.createWebviewCellButton(
                command,
                buttonHtml,
                statusToEnable.map(translateCellStateFromNative),
                tooltip
            );
        });
        this.webviewNotebookProvider.editors.forEach((editor) => {
            editor.createWebviewCellButton(
                command,
                buttonHtml,
                statusToEnable.map(translateCellStateFromNative),
                tooltip
            );
        });
    }

    public removeCellCommand(command: string): void {
        this.interactiveWindowProvider.windows.forEach((window) => {
            window.removeWebviewCellButton(command);
        });
        this.webviewNotebookProvider.editors.forEach((editor) => {
            editor.removeWebviewCellButton(command);
        });
    }
}
