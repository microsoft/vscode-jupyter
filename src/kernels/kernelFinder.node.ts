// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { injectable, inject, named } from 'inversify';
import { Memento, Uri } from 'vscode';
import { GLOBAL_MEMENTO, IMemento } from '../platform/common/types';
import { IJupyterRemoteCachedKernelValidator, IJupyterServerUriStorage, IServerConnectionType } from './jupyter/types';
import { BaseKernelFinder } from './kernelFinder.base';
import { PreferredRemoteKernelIdProvider } from './jupyter/preferredRemoteKernelIdProvider';
import { ILocalKernelFinder, IRemoteKernelFinder } from './raw/types';
import { INotebookProvider, KernelConnectionMetadata } from './types';
import { IFileSystem } from '../platform/common/platform/types';
import { IApplicationEnvironment } from '../platform/common/application/types';

/**
 * Node version of a KernelFinder. Node has different ways to validate than web.
 */
@injectable()
export class KernelFinder extends BaseKernelFinder {
    constructor(
        @inject(ILocalKernelFinder) localKernelFinder: ILocalKernelFinder,
        @inject(IRemoteKernelFinder) remoteKernelFinder: IRemoteKernelFinder,
        @inject(PreferredRemoteKernelIdProvider) preferredRemoteFinder: PreferredRemoteKernelIdProvider,
        @inject(INotebookProvider) notebookProvider: INotebookProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalState: Memento,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IJupyterServerUriStorage) serverUriStorage: IJupyterServerUriStorage,
        @inject(IServerConnectionType) serverConnectionType: IServerConnectionType,
        @inject(IJupyterRemoteCachedKernelValidator)
        protected readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        @inject(IApplicationEnvironment) env: IApplicationEnvironment
    ) {
        super(
            preferredRemoteFinder,
            notebookProvider,
            localKernelFinder,
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
                // Interpreters have to still exist
                return this.fs.exists(kernel.interpreter.uri);

            case 'startUsingLocalKernelSpec':
                // Spec files have to still exist and interpreters have to exist
                const promiseSpec = kernel.kernelSpec.specFile
                    ? this.fs.exists(Uri.file(kernel.kernelSpec.specFile))
                    : Promise.resolve(true);
                return promiseSpec.then((r) => {
                    return r && kernel.interpreter ? this.fs.exists(kernel.interpreter.uri) : Promise.resolve(true);
                });
            case 'startUsingRemoteKernelSpec':
                // Always fetch the latest kernels from remotes, no need to display cached remote kernels.
                return false;
            case 'connectToLiveRemoteKernel':
                return this.cachedRemoteKernelValidator.isValid(kernel);
        }

        return true;
    }
}
