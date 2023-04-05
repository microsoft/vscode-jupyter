// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable, NotebookController, NotebookDocument } from 'vscode';
import { IKernel } from '../../kernels/types';
import { Disposables } from '../../platform/common/utils';
import { IVSCodeNotebook } from '../../platform/common/application/types';

export class RemoteKernelReconnectBusyIndicator extends Disposables {
    constructor(
        kernel: IKernel,
        controller: NotebookController,
        notebook: NotebookDocument,
        vscNotebook: IVSCodeNotebook
    ) {
        super();

        if (kernel.status !== 'busy' && kernel.status !== 'unknown') {
            return;
        }
        vscNotebook.onDidCloseNotebookDocument(
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
        const execution = controller.createNotebookExecution(notebook);
        execution.start();
        this.disposables.push(new Disposable(() => execution.end()));
    }
}
