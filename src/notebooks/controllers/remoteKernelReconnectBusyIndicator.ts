// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable, NotebookController, NotebookDocument, workspace } from 'vscode';
import { IKernel } from '../../kernels/types';
import { DisposableBase } from '../../platform/common/utils/lifecycle';

export class RemoteKernelReconnectBusyIndicator extends DisposableBase {
    constructor(
        private readonly kernel: IKernel,
        private readonly controller: NotebookController,
        private readonly notebook: NotebookDocument
    ) {
        super();
    }
    public initialize() {
        const kernel = this.kernel;
        const controller = this.controller;
        const notebook = this.notebook;
        if (kernel.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel') {
            return;
        }
        if (kernel.status !== 'busy' && kernel.status !== 'unknown') {
            return;
        }
        if (!controller.createNotebookExecution) {
            // Older version of VS Code will not have this API, e.g. older insiders.
            return;
        }
        this._register(
            workspace.onDidCloseNotebookDocument((e) => {
                if (e === notebook) {
                    this.dispose();
                }
            }, this)
        );
        this._register(
            controller.onDidChangeSelectedNotebooks((e) => {
                if (e.notebook === notebook && e.selected === false) {
                    this.dispose();
                }
            }, this)
        );
        this._register(
            kernel.onStatusChanged((status) => {
                if (status !== 'busy' && status !== 'unknown') {
                    this.dispose();
                }
            }, this)
        );
        const execution = controller.createNotebookExecution(notebook);
        execution.start();
        this._register(new Disposable(() => execution.end()));
    }
}
