// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument, NotebookCell } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import '../../common/extensions';
import { IConfigurationService, IDisposableRegistry, Resource } from '../../common/types';
import { swallowExceptions } from '../../common/utils/decorators';
import { isUntitledFile } from '../../common/utils/misc';
import { isPythonKernelConnection } from '../jupyter/kernels/helpers';
import { getNotebookMetadata, isJupyterKernel, isJupyterNotebook, isPythonNotebook } from '../notebook/helpers/helpers';
import {
    IInteractiveWindowProvider,
    INotebookCreationTracker,
    INotebookEditor,
    INotebookEditorProvider,
    IRawNotebookSupportedService
} from '../types';
import { KernelDaemonPool } from './kernelDaemonPool';

@injectable()
export class KernelDaemonPreWarmer {
    constructor(
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(IInteractiveWindowProvider) private interactiveProvider: IInteractiveWindowProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookCreationTracker)
        private readonly usageTracker: INotebookCreationTracker,
        @inject(KernelDaemonPool) private readonly kernelDaemonPool: KernelDaemonPool,
        @inject(IRawNotebookSupportedService) private readonly rawNotebookSupported: IRawNotebookSupportedService,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IVSCodeNotebook) private readonly vscodeNotebook: IVSCodeNotebook,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
    ) {}
    public async activate(_resource: Resource): Promise<void> {
        // Check to see if raw notebooks are supported
        // If not, don't bother with prewarming
        // Also respect the disable autostart setting to not do any prewarming for the user
        if (
            !this.rawNotebookSupported.supported() ||
            this.configService.getSettings().disableJupyterAutoStart ||
            !this.extensionChecker.isPythonExtensionInstalled
        ) {
            return;
        }

        this.disposables.push(this.notebookEditorProvider.onDidOpenNotebookEditor(this.openNotebookEditor, this));
        this.disposables.push(
            this.interactiveProvider.onDidChangeActiveInteractiveWindow(this.preWarmKernelDaemonPool, this)
        );

        this.disposables.push(this.vscodeNotebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this));

        if (
            this.extensionChecker.isPythonExtensionActive &&
            (this.notebookEditorProvider.editors.length > 0 || this.interactiveProvider.windows.length > 0)
        ) {
            await this.preWarmKernelDaemonPool();
        }
        await this.preWarmDaemonPoolIfNecessary();
    }
    private async preWarmDaemonPoolIfNecessary() {
        // This is only for python, so prewarm just if we've seen python recently in this workspace
        if (
            this.shouldPreWarmDaemonPool(this.usageTracker.lastPythonNotebookCreated) &&
            this.extensionChecker.isPythonExtensionActive
        ) {
            await this.preWarmKernelDaemonPool();
        }
    }
    @swallowExceptions('PreWarmKernelDaemon')
    private async preWarmKernelDaemonPool() {
        await this.kernelDaemonPool.preWarmKernelDaemons();
    }

    // Only handle non-native editors via this code path
    private async openNotebookEditor(editor: INotebookEditor) {
        if (editor.type !== 'native') {
            await this.preWarmKernelDaemonPool();
        }
    }

    // Handle opening of native documents
    private async onDidOpenNotebookDocument(doc: NotebookDocument): Promise<void> {
        // It could be anything, lets not make any assumptions.
        if (isUntitledFile(doc.uri) || !isJupyterNotebook(doc)) {
            return;
        }
        const kernel = this.vscodeNotebook.notebookEditors.find((item) => item.document === doc)?.kernel;
        const isPythonKernel = isJupyterKernel(kernel) ? isPythonKernelConnection(kernel.selection) : false;
        const notebookMetadata = isPythonNotebook(getNotebookMetadata(doc));
        if (
            isPythonKernel ||
            notebookMetadata ||
            doc.getCells().some((cell: NotebookCell) => {
                return cell.document.languageId === PYTHON_LANGUAGE;
            })
        ) {
            await this.preWarmKernelDaemonPool();
        }
    }

    private shouldPreWarmDaemonPool(lastTime?: Date) {
        if (!lastTime) {
            return false;
        }
        const currentTime = new Date();
        const diff = currentTime.getTime() - lastTime.getTime();
        const diffInDays = Math.floor(diff / (24 * 3600 * 1000));
        return diffInDays <= 7;
    }
}
