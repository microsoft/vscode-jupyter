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
    constructor() {
        this.disposables = [];
        this.errorRendererMessage = vscode.notebooks.createRendererMessaging('jupyter-error-renderer');
        this.disposables.push(
            this.errorRendererMessage.onDidReceiveMessage(
                (e: { editor: vscode.NotebookEditor; message: IRequestMessage }) => {
                    switch (e.message.type) {
                        case MessageType.LoadLoc:
                            this.loadLoc(e.editor);
                            break;
                    }
                }
            )
        );

        // broadcast extension init message
        void this.errorRendererMessage.postMessage({
            type: MessageType.ExtensionInit
        });
    }

    loadLoc(editor: vscode.NotebookEditor) {
        const locStrings = isTestExecution() ? '{}' : getCollectionJSON();

        void this.errorRendererMessage.postMessage(
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
