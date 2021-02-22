// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Kernel } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { IDisposableRegistry, Resource } from '../../../common/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../../kernel-launcher/types';
import { IJupyterSessionManagerFactory, INotebookProviderConnection } from '../../types';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { IKernelSpecQuickPickItem, KernelConnectionMetadata } from './types';

/**
 * Provides a list of kernel specs for selection, for both local and remote sessions.
 *
 * @export
 * @class KernelSelectionProviderFactory
 */
@injectable()
export class KernelSelectionProvider {
    private suggestionsCache: IKernelSpecQuickPickItem<KernelConnectionMetadata>[] = [];
    /**
     * List of ids of kernels that should be hidden from the kernel picker.
     */
    private readonly kernelIdsToHide = new Set<string>();
    constructor(
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IRemoteKernelFinder) private readonly remoteKernelFinder: IRemoteKernelFinder,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IJupyterSessionManagerFactory) private jupyterSessionManagerFactory: IJupyterSessionManagerFactory
    ) {
        disposableRegistry.push(
            this.jupyterSessionManagerFactory.onRestartSessionCreated(this.addKernelToIgnoreList.bind(this))
        );
        disposableRegistry.push(
            this.jupyterSessionManagerFactory.onRestartSessionUsed(this.removeKernelFromIgnoreList.bind(this))
        );
    }

    /**
     * Ensure kernels such as those associated with the restart session are not displayed in the kernel picker.
     */
    public addKernelToIgnoreList(kernel: Kernel.IKernelConnection): void {
        this.kernelIdsToHide.add(kernel.id);
        this.kernelIdsToHide.add(kernel.clientId);
    }
    /**
     * Opposite of the add counterpart.
     */
    public removeKernelFromIgnoreList(kernel: Kernel.IKernelConnection): void {
        this.kernelIdsToHide.delete(kernel.id);
        this.kernelIdsToHide.delete(kernel.clientId);
    }

    /**
     * Gets a selection of kernel specs from a remote session.
     */
    public async getKernelSelections(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        cancelToken?: CancellationToken
    ): Promise<IKernelSpecQuickPickItem<KernelConnectionMetadata>[]> {
        const getSelections = this.getNonCachedSelections(resource, connInfo, cancelToken);

        const liveItems = getSelections.then((items) => (this.suggestionsCache = items));
        // If we have something in cache, return that, while fetching in the background.
        const cachedItems = this.suggestionsCache.length > 0 ? Promise.resolve(this.suggestionsCache) : liveItems;
        return Promise.race([cachedItems, liveItems]);
    }

    private async getNonCachedSelections(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        _cancelToken?: CancellationToken
    ): Promise<IKernelSpecQuickPickItem<KernelConnectionMetadata>[]> {
        // Use either the local or remote kernel finder
        const kernels =
            !connInfo || connInfo.localLaunch
                ? await this.localKernelFinder.listKernels(resource)
                : await this.remoteKernelFinder.listKernels(resource, connInfo);

        // Filter out excluded ids
        const filtered = kernels.filter(
            (k) => k.kind !== 'connectToLiveKernel' || !this.kernelIdsToHide.has(k.kernelModel.id || '')
        );

        // Convert to a quick pick list.
        return filtered.map(this.mapKernelToSelection);
    }

    private mapKernelToSelection(kernel: KernelConnectionMetadata): IKernelSpecQuickPickItem<KernelConnectionMetadata> {
        const displayName = getDisplayNameOrNameOfKernelConnection(kernel);
        return {
            label: displayName,
            ...kernel,
            // We don't want descriptions.
            description: '',
            selection: kernel
        };
    }
}
