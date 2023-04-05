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
        if (!controller.createNotebookExecution) {
            // Older version of VS Code will not have this API, e.g. older insiders.
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
        const sessionKernel = kernel.session?.kernel;
        if (sessionKernel) {
            const statusChanged = () => {
                if (sessionKernel.status !== 'busy' && sessionKernel.status !== 'unknown') {
                    this.dispose();
                }
            };
            sessionKernel.connectionStatusChanged.connect(statusChanged);
            this.disposables.push(
                new Disposable(() => sessionKernel.connectionStatusChanged.disconnect(statusChanged))
            );
        }
        kernel.onStatusChanged(
            () => {
                if (kernel.status !== 'busy' && kernel.status !== 'unknown') {
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
