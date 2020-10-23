import { inject, injectable } from 'inversify';
import { IDisposable } from 'monaco-editor';
import { Disposable, NotebookCellRunState } from 'vscode';
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
    ): Disposable {
        const disposables: IDisposable[] = [];
        const windows = new Set();

        this.interactiveWindowProvider.onDidChangeActiveInteractiveWindow((window) => {
            if (window && !windows.has(window)) {
                disposables.push(
                    window.createWebviewCellButton(
                        command,
                        buttonHtml,
                        statusToEnable.map(translateCellStateFromNative),
                        tooltip
                    )
                );
            }
        });

        this.interactiveWindowProvider.windows.forEach((window) => {
            windows.add(window);
            disposables.push(
                window.createWebviewCellButton(
                    command,
                    buttonHtml,
                    statusToEnable.map(translateCellStateFromNative),
                    tooltip
                )
            );
        });

        this.webviewNotebookProvider.onDidOpenNotebookEditor((editor) => {
            disposables.push(
                editor.createWebviewCellButton(
                    command,
                    buttonHtml,
                    statusToEnable.map(translateCellStateFromNative),
                    tooltip
                )
            );
        });

        this.webviewNotebookProvider.editors.forEach((editor) => {
            disposables.push(
                editor.createWebviewCellButton(
                    command,
                    buttonHtml,
                    statusToEnable.map(translateCellStateFromNative),
                    tooltip
                )
            );
        });

        return {
            dispose: () => {
                disposables.forEach((d) => d.dispose());
            }
        };
    }
}
