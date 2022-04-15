// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { injectable, inject } from 'inversify';
import { CancellationToken } from 'vscode';
import { IPythonExtensionChecker } from '../platform/api/types';
import { IConfigurationService, Resource } from '../platform/common/types';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { BaseKernelFinder } from './kernelFinder.base';
import { PreferredRemoteKernelIdProvider } from './raw/finder/preferredRemoteKernelIdProvider';
import { ILocalKernelFinder, IRemoteKernelFinder } from './raw/types';
import { INotebookProvider, INotebookProviderConnection, KernelConnectionMetadata } from './types';

@injectable()
export class KernelFinder extends BaseKernelFinder {
    constructor(
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IRemoteKernelFinder) private readonly remoteKernelFinder: IRemoteKernelFinder,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) interpreterService: IInterpreterService,
        @inject(PreferredRemoteKernelIdProvider) preferredRemoteFinder: PreferredRemoteKernelIdProvider,
        @inject(INotebookProvider) notebookProvider: INotebookProvider,
        @inject(IConfigurationService) configurationService: IConfigurationService
    ) {
        super(extensionChecker, interpreterService, configurationService, preferredRemoteFinder, notebookProvider);
    }
    public async listKernelsImpl(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        cancelToken?: CancellationToken,
        useCache: 'ignoreCache' | 'useCache' = 'ignoreCache'
    ): Promise<KernelConnectionMetadata[]> {
        // Note, cached kernels are validated as being still appropriate in the localKernelFinder
        let [localKernels, remoteKernels] = await Promise.all([
            this.localKernelFinder
                .listKernels(resource, cancelToken, useCache)
                .then((l) => this.finishListingKernels(l, useCache, 'local')),
            this.remoteKernelFinder
                .listKernels(resource, connInfo, cancelToken, useCache)
                .then((l) => this.finishListingKernels(l, useCache, 'remote'))
        ]);

        // Combine the two results together
        return [...localKernels, ...remoteKernels];
    }
}
