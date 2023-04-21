// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookController, NotebookDocument, workspace } from 'vscode';
import { IKernel } from '../../kernels/types';
import { Disposables } from '../../platform/common/utils';

export class RemoteKernelReconnectBusyIndicator extends Disposables {
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
        workspace.onDidCloseNotebookDocument(
            (e) => {
                if (e === notebook) {
                    this.dispose();
                }
            },
            this,
            this.disposables
        );
        controller.onDidChangeSelectedNotebooks(
            (e) => {
                if (e.notebook === notebook && e.selected === false) {
                    this.dispose();
                }
            },
            this,
            this.disposables
        );
        kernel.onStatusChanged(
            (status) => {
                if (status !== 'busy' && status !== 'unknown') {
                    this.dispose();
                }
            },
            this,
            this.disposables
        );
    }
}
