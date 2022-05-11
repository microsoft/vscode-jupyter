// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { injectable, inject, named } from 'inversify';
import { Memento } from 'vscode';
import { GLOBAL_MEMENTO, IMemento } from '../platform/common/types';
import { ServerConnectionType } from './jupyter/launcher/serverConnectionType';
import { IJupyterServerUriStorage } from './jupyter/types';
import { BaseKernelFinder } from './kernelFinder.base';
import { PreferredRemoteKernelIdProvider } from './jupyter/preferredRemoteKernelIdProvider';
import { LiveRemoteKernelConnectionUsageTracker } from './raw/finder/liveRemoteKernelConnectionTracker';
import { IRemoteKernelFinder } from './raw/types';
import { INotebookProvider, KernelConnectionMetadata } from './types';

@injectable()
export class KernelFinder extends BaseKernelFinder {
    constructor(
        @inject(IRemoteKernelFinder) remoteKernelFinder: IRemoteKernelFinder,
        @inject(PreferredRemoteKernelIdProvider) preferredRemoteFinder: PreferredRemoteKernelIdProvider,
        @inject(INotebookProvider) notebookProvider: INotebookProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalState: Memento,
        @inject(IJupyterServerUriStorage) serverUriStorage: IJupyterServerUriStorage,
        @inject(ServerConnectionType) serverConnectionType: ServerConnectionType,
        @inject(LiveRemoteKernelConnectionUsageTracker)
        private readonly liveKernelConnectionTracker: LiveRemoteKernelConnectionUsageTracker
    ) {
        super(
            preferredRemoteFinder,
            notebookProvider,
            undefined, // Local not supported in web
            remoteKernelFinder,
            globalState,
            serverUriStorage,
            serverConnectionType
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
                // Only list live kernels that was used by the user,
                // Even if such a kernel no longer exists on the sever.
                // This way things don't just disappear from the list &
                // user will get notified when they attempt to re-use this kernel.
                return this.liveKernelConnectionTracker.wasKernelUsed(kernel);
        }

        return true;
    }
}
