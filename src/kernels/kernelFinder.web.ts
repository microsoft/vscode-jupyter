// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { injectable, inject, named } from 'inversify';
import { Memento } from 'vscode';
import { GLOBAL_MEMENTO, IMemento } from '../platform/common/types';
import { IJupyterRemoteCachedKernelValidator, IJupyterServerUriStorage, IServerConnectionType } from './jupyter/types';
import { BaseKernelFinder } from './kernelFinder.base';
import { PreferredRemoteKernelIdProvider } from './jupyter/preferredRemoteKernelIdProvider';
import { IRemoteKernelFinder } from './raw/types';
import { INotebookProvider, KernelConnectionMetadata } from './types';
import { IApplicationEnvironment } from '../platform/common/application/types';

/**
 * Web version of a KernelFinder. Web has different ways to validate than node.
 */
@injectable()
export class KernelFinder extends BaseKernelFinder {
    constructor(
        @inject(IRemoteKernelFinder) remoteKernelFinder: IRemoteKernelFinder,
        @inject(PreferredRemoteKernelIdProvider) preferredRemoteFinder: PreferredRemoteKernelIdProvider,
        @inject(INotebookProvider) notebookProvider: INotebookProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalState: Memento,
        @inject(IJupyterServerUriStorage) serverUriStorage: IJupyterServerUriStorage,
        @inject(IServerConnectionType) serverConnectionType: IServerConnectionType,
        @inject(IJupyterRemoteCachedKernelValidator)
        protected readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        @inject(IApplicationEnvironment) env: IApplicationEnvironment
    ) {
        super(
            preferredRemoteFinder,
            notebookProvider,
            undefined, // Local not supported in web
            remoteKernelFinder,
            globalState,
            serverUriStorage,
            serverConnectionType,
            env
        );
    }
    protected async isValidCachedKernel(kernel: KernelConnectionMetadata): Promise<boolean> {
        switch (kernel.kind) {
            case 'startUsingPythonInterpreter':
            case 'startUsingLocalKernelSpec':
                return false;
            case 'startUsingRemoteKernelSpec':
                // Always fetch the latest kernels from remotes, no need to display cached remote kernels.
                return false;
            case 'connectToLiveRemoteKernel':
                return this.cachedRemoteKernelValidator.isValid(kernel);
        }

        return true;
    }
}
