// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookEditor } from 'vscode';
import { InteractiveWindow } from './interactiveWindow';

export class NotebookInteractiveWindow extends InteractiveWindow {
    private editor: NotebookEditor | undefined;

    public override async getAppendIndex() {
        if (!this.editor?.replOptions) {
            this.editor = await this.showInteractiveEditor();
        }
        if (!this.editor?.replOptions) {
            throw new Error('Interactive editor not found');
        }
        return this.editor.replOptions.appendIndex;
    }
}
