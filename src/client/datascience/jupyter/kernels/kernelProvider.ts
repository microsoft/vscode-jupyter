// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter, Uri } from 'vscode';
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
import {
    IDataScienceErrorHandler,
    IJupyterServerUriStorage,
    INotebookEditorProvider,
    INotebookProvider
} from '../../types';
import { Kernel } from './kernel';
import { IKernel, IKernelProvider, KernelOptions } from './types';

@injectable()
export class KernelProvider implements IKernelProvider {
    private readonly kernelsByUri = new Map<string, { options: KernelOptions; kernel: IKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    private readonly kernelChangedEmitter = new EventEmitter<void>();
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
        @inject(IJupyterServerUriStorage) private readonly serverStorage: IJupyterServerUriStorage
    ) {
        this.asyncDisposables.push(this);
    }

    public get onKernelChanged(): Event<void> {
        return this.kernelChangedEmitter.event;
    }

    public get(uri: Uri): IKernel | undefined {
        return this.kernelsByUri.get(uri.toString())?.kernel;
    }
    public async dispose() {
        const items = Array.from(this.pendingDisposables.values());
        this.pendingDisposables.clear();
        await Promise.all(items);
    }
    public getOrCreate(uri: Uri, options: KernelOptions): IKernel | undefined {
        const existingKernelInfo = this.kernelsByUri.get(uri.toString());
        if (existingKernelInfo && existingKernelInfo.options.metadata.id === options.metadata.id) {
            return existingKernelInfo.kernel;
        }

        this.disposeOldKernel(uri);

        const waitForIdleTimeout = this.configService.getSettings(uri).jupyterLaunchTimeout;
        const interruptTimeout = this.configService.getSettings(uri).jupyterInterruptTimeout;
        const kernel = new Kernel(
            uri,
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
            this.serverStorage
        );
        this.asyncDisposables.push(kernel);
        this.kernelsByUri.set(uri.toString(), { options, kernel });
        this.deleteMappingIfKernelIsDisposed(uri, kernel);
        this.kernelChangedEmitter.fire();
        return kernel;
    }
    /**
     * If a kernel has been disposed, then remove the mapping of Uri + Kernel.
     */
    private deleteMappingIfKernelIsDisposed(uri: Uri, kernel: IKernel) {
        kernel.onDisposed(
            () => {
                // If the same kernel is associated with this document & it was disposed, then delete it.
                if (this.kernelsByUri.get(uri.toString())?.kernel === kernel) {
                    this.kernelsByUri.delete(uri.toString());
                    traceInfo(
                        `Kernel got disposed, hence there is no longer a kernel associated with ${uri.toString()}`,
                        kernel.uri.toString()
                    );
                }
            },
            this,
            this.disposables
        );
    }
    private disposeOldKernel(uri: Uri) {
        const kernelToDispose = this.kernelsByUri.get(uri.toString());
        if (kernelToDispose) {
            this.pendingDisposables.add(kernelToDispose.kernel);
            kernelToDispose.kernel
                .dispose()
                .catch((ex) => traceWarning('Failed to dispose old kernel', ex))
                .finally(() => this.pendingDisposables.delete(kernelToDispose.kernel))
                .catch(noop);
        }
        this.kernelsByUri.delete(uri.toString());
    }
}

// export class KernelProvider {
