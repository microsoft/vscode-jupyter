// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { injectable, inject, named } from 'inversify';
import { Memento } from 'vscode';
import { IFileSystem } from '../platform/common/platform/types.node';
import { GLOBAL_MEMENTO, IMemento } from '../platform/common/types';
import { ServerConnectionType } from './jupyter/launcher/serverConnectionType';
import { IJupyterServerUriStorage } from './jupyter/types';
import { BaseKernelFinder } from './kernelFinder.base';
import { PreferredRemoteKernelIdProvider } from './jupyter/preferredRemoteKernelIdProvider';
import { LiveRemoteKernelConnectionUsageTracker } from './raw/finder/liveRemoteKernelConnectionTracker';
import { ILocalKernelFinder, IRemoteKernelFinder } from './raw/types';
import { INotebookProvider, KernelConnectionMetadata } from './types';

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
        @inject(ServerConnectionType) serverConnectionType: ServerConnectionType,
        @inject(LiveRemoteKernelConnectionUsageTracker)
        private readonly liveKernelConnectionTracker: LiveRemoteKernelConnectionUsageTracker
    ) {
        super(
            preferredRemoteFinder,
            notebookProvider,
            localKernelFinder,
            remoteKernelFinder,
            globalState,
            serverUriStorage,
            serverConnectionType
        );
    }

    protected async isValidCachedKernel(kernel: KernelConnectionMetadata): Promise<boolean> {
        switch (kernel.kind) {
            case 'startUsingPythonInterpreter':
                // Interpreters have to still exist
                return this.fs.localFileExists(kernel.interpreter.uri.fsPath);

            case 'startUsingLocalKernelSpec':
                // Spec files have to still exist and interpreters have to exist
                const promiseSpec = kernel.kernelSpec.specFile
                    ? this.fs.localFileExists(kernel.kernelSpec.specFile)
                    : Promise.resolve(true);
                return promiseSpec.then((r) => {
                    return r && kernel.interpreter
                        ? this.fs.localFileExists(kernel.interpreter.uri.fsPath)
                        : Promise.resolve(true);
                });
            case 'startUsingRemoteKernelSpec':
                // Always fetch the latest kernels from remotes, no need to display cached remote kernels.
                return false;
            case 'connectToLiveRemoteKernel':
                // Only list live kernels that was used by the user,
                // Even if such a kernel no longer exists on the sever.
                // This way things don't just disappear from the list &
                // user will get notified when they attempt to re-use this kernel.
                return this.liveKernelConnectionTracker.wasKernelUsed(kernel);
        }

        return true;
    }
}
