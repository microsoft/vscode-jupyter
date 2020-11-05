// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import * as uuid from 'uuid/v4';
import { CancellationToken, Uri } from 'vscode';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../common/application/types';
import { traceError, traceWarning } from '../../../common/logger';
import { IDisposableRegistry } from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { CodeSnippets } from '../../constants';
import { getDefaultNotebookContent, updateNotebookMetadata } from '../../notebookStorage/baseModel';
import {
    IDataScienceErrorHandler,
    INotebook,
    INotebookEditorProvider,
    INotebookProvider,
    InterruptResult,
    IRawNotebookSupportedService
} from '../../types';
import { BaseKernel } from './baseKernel';
import { isPythonKernelConnection } from './helpers';
import type { IKernel, IKernelProvider, IKernelSelectionUsage, KernelConnectionMetadata } from './types';

export class Kernel extends BaseKernel {
    private notebook?: INotebook;
    private _disposed?: boolean;
    private _notebookPromise?: Promise<INotebook | undefined>;
    private readonly hookedNotebookForEvents = new WeakSet<INotebook>();
    private readonly kernelValidated = new Map<string, { kernel: IKernel; promise: Promise<void> }>();
    constructor(
        uri: Uri,
        metadata: Readonly<KernelConnectionMetadata>,
        private readonly notebookProvider: INotebookProvider,
        disposables: IDisposableRegistry,
        launchTimeout: number,
        commandManager: ICommandManager,
        errorHandler: IDataScienceErrorHandler,
        editorProvider: INotebookEditorProvider,
        kernelProvider: IKernelProvider,
        kernelSelectionUsage: IKernelSelectionUsage,
        appShell: IApplicationShell,
        vscNotebook: IVSCodeNotebook,
        rawNotebookSupported: IRawNotebookSupportedService
    ) {
        super(
            uri,
            metadata,
            disposables,
            launchTimeout,
            commandManager,
            errorHandler,
            editorProvider,
            kernelProvider,
            kernelSelectionUsage,
            appShell,
            vscNotebook,
            rawNotebookSupported
        );
    }
    public async dispose(): Promise<void> {
        this._notebookPromise = undefined;
        if (this.notebook) {
            await this.notebook.dispose();
            this._disposed = true;
            this.notebook = undefined;
        }
        await super.dispose();
    }
    protected async onRestart(): Promise<void> {
        if (this.notebook) {
            await this.notebook.restartKernel(this.launchTimeout);
            await this.initializeAfterStart();
        }
    }
    protected async onStart(options?: { disableUI?: boolean; token?: CancellationToken }): Promise<void> {
        if (this._notebookPromise) {
            await this._notebookPromise;
            return;
        } else {
            await this.validate(this.uri);
            const metadata = ((getDefaultNotebookContent().metadata || {}) as unknown) as nbformat.INotebookMetadata;
            // Create a dummy notebook metadata & update the metadata before starting the notebook (required to ensure we fetch & start the right kernel).
            // Lower layers of code below getOrCreateNotebook searches for kernels again using the metadata.
            updateNotebookMetadata(metadata, this.metadata);
            this._notebookPromise = this.notebookProvider.getOrCreateNotebook({
                identity: this.uri,
                resource: this.uri,
                disableUI: options?.disableUI,
                getOnly: false,
                metadata,
                token: options?.token
            });

            this._notebookPromise
                .then((nb) => {
                    this.notebook = nb;
                    this.jupyterSession = nb?.session;
                    if (nb) {
                        this.kernelExecution.session = nb.session;
                        this.kernelExecution.loggers = nb.getLoggers();
                    }
                })
                .catch((ex) => {
                    traceError('failed to create INotebook in kernel', ex);
                    this._notebookPromise = undefined;
                    this.startCancellation.cancel();
                    this.errorHandler.handleError(ex).ignoreErrors(); // Just a notification, so don't await this
                });
            await this._notebookPromise;
            await this.initializeAfterStart();
        }
    }
    protected async onInterrupt(): Promise<InterruptResult> {
        if (!this.notebook) {
            throw new Error('No notebook to interrupt');
        }
        return this.notebook.interruptKernel(this.launchTimeout);
    }
    protected isDisposed(): boolean {
        return this._disposed === true || this.notebook?.disposed === true;
    }
    private async validate(uri: Uri): Promise<void> {
        const kernel = this.kernelProvider.get(uri);
        if (!kernel) {
            return;
        }
        const key = uri.toString();
        if (!this.kernelValidated.get(key)) {
            const promise = new Promise<void>((resolve) =>
                this.kernelSelectionUsage
                    .useSelectedKernel(kernel?.metadata, uri, 'raw')
                    .finally(() => {
                        // If still using the same promise, then remove the exception information.
                        // Basically if there's an exception, then we cannot use the kernel and a message would have been displayed.
                        // We don't want to cache such a promise, as its possible the user later installs the dependencies.
                        if (this.kernelValidated.get(key)?.kernel === kernel) {
                            this.kernelValidated.delete(key);
                        }
                    })
                    .finally(resolve)
                    .catch(noop)
            );

            this.kernelValidated.set(key, { kernel, promise });
        }
        await this.kernelValidated.get(key)!.promise;
    }
    private async initializeAfterStart() {
        if (!this.notebook) {
            return;
        }
        this.disableJedi();
        if (!this.hookedNotebookForEvents.has(this.notebook)) {
            this.hookedNotebookForEvents.add(this.notebook);
            this.notebook.kernelSocket.subscribe(this._kernelSocket);
            this.notebook.onDisposed(() => {
                this._notebookPromise = undefined;
                this._onDisposed.fire();
            });
            this.notebook.onKernelRestarted(() => {
                this._onRestarted.fire();
            });
        }
        if (isPythonKernelConnection(this.metadata)) {
            await this.notebook.setLaunchingFile(this.uri.fsPath);
        }
        await this.notebook
            .requestKernelInfo()
            .then((item) => (this._info = item.content))
            .catch(traceWarning.bind('Failed to request KernelInfo'));
        await this.notebook.waitForIdle(this.launchTimeout);
    }

    private disableJedi() {
        if (isPythonKernelConnection(this.metadata) && this.notebook) {
            this.notebook.executeObservable(CodeSnippets.disableJedi, this.uri.fsPath, 0, uuid(), true);
        }
    }
}
