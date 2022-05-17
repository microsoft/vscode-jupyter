import { injectable } from 'inversify';
import * as vscode from 'vscode';
import { isTestExecution } from '../../../platform/common/constants';
import { IDisposable } from '../../../platform/common/types';
import { getCollectionJSON } from '../../../platform/common/utils/localize';

const enum MessageType {
    ExtensionInit = 1,
    LoadLoc = 2
}

interface IRequestMessage {
    type: MessageType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
}

export const IExtensionSideRenderer = Symbol('IExtensionSideRenderer');
export interface IExtensionSideRenderer {}

@injectable()
export class ExtensionSideRenderer implements IDisposable {
    private disposables: IDisposable[];
    private errorRendererMessage: vscode.NotebookRendererMessaging;
    private dataWranglerHtmlRendererMessage: vscode.NotebookRendererMessaging;
    constructor() {
        this.disposables = [];
        this.errorRendererMessage = vscode.notebooks.createRendererMessaging('jupyter-error-renderer');
        this.dataWranglerHtmlRendererMessage = vscode.notebooks.createRendererMessaging(
            'jupyter-data-wrangler-html-renderer'
        );
        this.disposables.push(
            this.errorRendererMessage.onDidReceiveMessage(
                (e: { editor: vscode.NotebookEditor; message: IRequestMessage }) => {
                    switch (e.message.type) {
                        case MessageType.LoadLoc:
                            this.loadLoc(e.editor, this.errorRendererMessage);
                            break;
                    }
                }
            ),
            this.dataWranglerHtmlRendererMessage.onDidReceiveMessage(
                (e: { editor: vscode.NotebookEditor; message: IRequestMessage }) => {
                    switch (e.message.type) {
                        case MessageType.LoadLoc:
                            this.loadLoc(e.editor, this.dataWranglerHtmlRendererMessage);
                            break;
                    }
                }
            )
        );

        // broadcast extension init message
        void this.errorRendererMessage.postMessage({
            type: MessageType.ExtensionInit
        });
        void this.dataWranglerHtmlRendererMessage.postMessage({
            type: MessageType.ExtensionInit
        });
    }

    loadLoc(editor: vscode.NotebookEditor, messaging: vscode.NotebookRendererMessaging) {
        const locStrings = isTestExecution() ? '{}' : getCollectionJSON();

        void messaging.postMessage(
            {
                type: MessageType.LoadLoc,
                data: locStrings
            },
            editor
        );
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}
