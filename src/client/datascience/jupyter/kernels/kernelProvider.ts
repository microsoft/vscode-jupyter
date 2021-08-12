// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { IApplicationShell } from '../../../common/application/types';
import { traceInfo, traceWarning } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import {
    IAsyncDisposable,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IExtensionContext
} from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { InteractiveWindowView } from '../../notebook/constants';
import {
    IDataScienceErrorHandler,
    IJupyterServerUriStorage,
    INotebookEditorProvider,
    INotebookProvider
} from '../../types';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { Kernel } from './kernel';
import { IKernel, IKernelProvider, KernelOptions } from './types';

@injectable()
export class KernelProvider implements IKernelProvider {
    private readonly kernelsByNotebook = new WeakMap<NotebookDocument, { options: KernelOptions; kernel: IKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    constructor(
        @inject(IAsyncDisposableRegistry) private asyncDisposables: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IDataScienceErrorHandler) private readonly errorHandler: IDataScienceErrorHandler,
        @inject(INotebookEditorProvider) private readonly editorProvider: INotebookEditorProvider,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IJupyterServerUriStorage) private readonly serverStorage: IJupyterServerUriStorage,
        @inject(CellOutputDisplayIdTracker) private readonly outputTracker: CellOutputDisplayIdTracker
    ) {
        this.asyncDisposables.push(this);
    }

    public get(notebook: NotebookDocument): IKernel | undefined {
        return this.kernelsByNotebook.get(notebook)?.kernel;
    }
    public async dispose() {
        const items = Array.from(this.pendingDisposables.values());
        this.pendingDisposables.clear();
        await Promise.all(items);
    }
    public getOrCreate(notebook: NotebookDocument, options: KernelOptions): IKernel | undefined {
        const existingKernelInfo = this.kernelsByNotebook.get(notebook);
        if (existingKernelInfo && existingKernelInfo.options.metadata.id === options.metadata.id) {
            return existingKernelInfo.kernel;
        }
        const resourceUri = notebook.notebookType === InteractiveWindowView ? options.resourceUri : notebook.uri;
        this.disposeOldKernel(notebook);

        const waitForIdleTimeout = this.configService.getSettings(resourceUri).jupyterLaunchTimeout;
        const interruptTimeout = this.configService.getSettings(resourceUri).jupyterInterruptTimeout;
        const kernel = new Kernel(
            notebook.uri,
            resourceUri,
            options.metadata,
            this.notebookProvider,
            this.disposables,
            waitForIdleTimeout,
            interruptTimeout,
            this.errorHandler,
            this.editorProvider,
            this,
            this.appShell,
            this.fs,
            this.context,
            this.serverStorage,
            options.controller,
            this.configService,
            this.outputTracker
        );
        this.asyncDisposables.push(kernel);
        this.kernelsByNotebook.set(notebook, { options, kernel });
        this.deleteMappingIfKernelIsDisposed(notebook, kernel);
        return kernel;
    }
    /**
     * If a kernel has been disposed, then remove the mapping of Uri + Kernel.
     */
    private deleteMappingIfKernelIsDisposed(notebook: NotebookDocument, kernel: IKernel) {
        kernel.onDisposed(
            () => {
                // If the same kernel is associated with this document & it was disposed, then delete it.
                if (this.kernelsByNotebook.get(notebook)?.kernel === kernel) {
                    this.kernelsByNotebook.delete(notebook);
                    traceInfo(
                        `Kernel got disposed, hence there is no longer a kernel associated with ${notebook.uri.toString()}`,
                        kernel.notebookUri.toString()
                    );
                }
            },
            this,
            this.disposables
        );
    }
    private disposeOldKernel(notebook: NotebookDocument) {
        const kernelToDispose = this.kernelsByNotebook.get(notebook);
        if (kernelToDispose) {
            this.pendingDisposables.add(kernelToDispose.kernel);
            kernelToDispose.kernel
                .dispose()
                .catch((ex) => traceWarning('Failed to dispose old kernel', ex))
                .finally(() => this.pendingDisposables.delete(kernelToDispose.kernel))
                .catch(noop);
        }
        this.kernelsByNotebook.delete(notebook);
    }
}

// export class KernelProvider {
