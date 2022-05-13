// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable, NotebookDocument } from 'vscode';
import { IVSCodeNotebookController } from '../../notebooks/controllers/types';
import { INotebookControllerManager } from '../../notebooks/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { traceInfo } from '../../platform/logging';
import { IKernel, IKernelProvider, isLocalConnection } from '../types';
import { PreferredRemoteKernelIdProvider } from './preferredRemoteKernelIdProvider';
import { ILiveRemoteKernelConnectionUsageTracker } from './types';

@injectable()
export class RemoteKernelConnectionHandler implements IExtensionSyncActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(INotebookControllerManager) private readonly controllers: INotebookControllerManager,
        @inject(ILiveRemoteKernelConnectionUsageTracker)
        private readonly liveKernelTracker: ILiveRemoteKernelConnectionUsageTracker,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider
    ) {}
    activate(): void {
        this.kernelProvider.onDidStartKernel(this.onDidStartKernel, this, this.disposables);
        this.controllers.onNotebookControllerSelectionChanged(
            this.onNotebookControllerSelectionChanged,
            this,
            this.disposables
        );
    }
    private onNotebookControllerSelectionChanged({
        selected,
        notebook,
        controller
    }: {
        selected: boolean;
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
    }) {
        if (controller.connection.kind === 'connectToLiveRemoteKernel' && controller.connection.kernelModel.id) {
            if (selected) {
                this.liveKernelTracker.trackKernelIdAsUsed(
                    notebook.uri,
                    controller.connection.serverId,
                    controller.connection.kernelModel.id
                );
            } else {
                this.liveKernelTracker.trackKernelIdAsNotUsed(
                    notebook.uri,
                    controller.connection.serverId,
                    controller.connection.kernelModel.id
                );
            }
        }
        if (isLocalConnection(controller.connection)) {
            this.preferredRemoteKernelIdProvider.clearPreferredRemoteKernelId(notebook.uri).catch(noop);
        }
    }
    private onDidStartKernel(kernel: IKernel) {
        if (kernel.creator !== 'jupyterExtension' || !kernel.resourceUri) {
            return;
        }
        const resource = kernel.resourceUri;
        if (kernel.kernelConnectionMetadata.kind === 'startUsingRemoteKernelSpec') {
            const serverId = kernel.kernelConnectionMetadata.serverId;
            const subscription = kernel.kernelSocket.subscribe((info) => {
                const kernelId = info?.options.id;
                if (!kernel.disposed && !kernel.disposing && kernelId) {
                    traceInfo(`Updating preferred kernel for remote notebook ${kernelId}`);
                    this.preferredRemoteKernelIdProvider.storePreferredRemoteKernelId(resource, kernelId).catch(noop);
                    this.liveKernelTracker.trackKernelIdAsUsed(resource, serverId, kernelId);
                }
            });
            this.disposables.push(new Disposable(() => subscription.unsubscribe()));
        }
    }
}
