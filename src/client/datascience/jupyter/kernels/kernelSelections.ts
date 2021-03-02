// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { IPathUtils, Resource } from '../../../common/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../../kernel-launcher/types';
import { INotebookProviderConnection } from '../../types';
import {
    getDescriptionOfKernelConnection,
    getDetailOfKernelConnection,
    getDisplayNameOrNameOfKernelConnection
} from './helpers';
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
    constructor(
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IRemoteKernelFinder) private readonly remoteKernelFinder: IRemoteKernelFinder,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils
    ) {}

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

        // Convert to a quick pick list.
        return kernels.map(this.mapKernelToSelection.bind(this));
    }

    private mapKernelToSelection(kernel: KernelConnectionMetadata): IKernelSpecQuickPickItem<KernelConnectionMetadata> {
        return {
            label: getDisplayNameOrNameOfKernelConnection(kernel),
            detail: getDetailOfKernelConnection(kernel, this.pathUtils),
            description: getDescriptionOfKernelConnection(kernel),
            selection: kernel
        };
    }
}
