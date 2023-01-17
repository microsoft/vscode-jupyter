// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import * as vscode from 'vscode';
import { IDisposable } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';

const enum MessageType {
    ExtensionInit = 1,
    LoadLoc = 2
}

export const IExtensionSideRenderer = Symbol('IExtensionSideRenderer');
export interface IExtensionSideRenderer {}

/**
 * Responsible for sending loc data to renderers
 */
@injectable()
export class ExtensionSideRenderer implements IDisposable {
    private disposables: IDisposable[];
    private errorRendererMessage: vscode.NotebookRendererMessaging;
    constructor() {
        this.disposables = [];
        this.errorRendererMessage = vscode.notebooks.createRendererMessaging('jupyter-error-renderer');

        // broadcast extension init message
        this.errorRendererMessage
            .postMessage({
                type: MessageType.ExtensionInit
            })
            .then(noop, noop);
    }
    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}
