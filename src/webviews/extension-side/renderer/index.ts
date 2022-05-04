import { injectable } from 'inversify';
import * as vscode from 'vscode';
import { isTestExecution } from '../../../platform/common/constants';
import { IDisposable } from '../../../platform/common/types';
import { getCollectionJSON } from '../../../platform/common/utils/localize';

const enum MessageType {
    LoadLoc = 1
}

interface IRequestMessage {
    type: MessageType;
    data: any;
}

export const IExtensionSideRenderer = Symbol('IExtensionSideRenderer');
export interface IExtensionSideRenderer {
}

@injectable()
export class ExtensionSideRenderer implements IDisposable {
    private disposables: IDisposable[];
    private errorRendererMessage: vscode.NotebookRendererMessaging;
    constructor() {
        console.log('error side renderer: constructor');
        this.disposables = [];
        this.errorRendererMessage = vscode.notebooks.createRendererMessaging('jupyter-error-renderer');
        this.disposables.push(this.errorRendererMessage.onDidReceiveMessage((e: { editor: any, message: IRequestMessage }) => {
            console.log('error side renderer receive message: ', e);
            switch (e.message.type) {
                case MessageType.LoadLoc:
                    this.loadLoc(e.editor);
                    break;
            }
        }));
    }

    loadLoc(editor: any) {
        const locStrings = isTestExecution() ? '{}' : getCollectionJSON();

        this.errorRendererMessage.postMessage({
            type: MessageType.LoadLoc,
            data: locStrings
        }, editor);
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}