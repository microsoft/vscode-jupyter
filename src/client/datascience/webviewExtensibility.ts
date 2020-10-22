import { inject, injectable } from 'inversify';
import { IDisposable } from 'monaco-editor';
import { NotebookCellRunState } from 'vscode';
import { IInteractiveWindowProvider, INotebookEditorProvider, IWebviewExtensibility } from './types';
import { translateCellStateFromNative } from './utils';

@injectable()
export class WebviewExtensibility implements IWebviewExtensibility {
    constructor(
        @inject(INotebookEditorProvider) private webviewNotebookProvider: INotebookEditorProvider,
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider
    ) {}

    public registerCellToolbarButton(
        command: string,
        buttonHtml: string,
        statusToEnable: NotebookCellRunState[],
        tooltip: string
    ): IDisposable {
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

        return {
            dispose: () => {
                this.interactiveWindowProvider.windows.forEach((window) => {
                    window.removeWebviewCellButton(command);
                });
                this.webviewNotebookProvider.editors.forEach((editor) => {
                    editor.removeWebviewCellButton(command);
                });
            }
        };
    }
}
