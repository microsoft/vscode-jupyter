// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { injectable, inject, named } from 'inversify';
import { Memento } from 'vscode';
import { IPythonExtensionChecker } from '../platform/api/types';
import { GLOBAL_MEMENTO, IMemento } from '../platform/common/types';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { IJupyterServerUriStorage } from './jupyter/types';
import { BaseKernelFinder } from './kernelFinder.base';
import { PreferredRemoteKernelIdProvider } from './raw/finder/preferredRemoteKernelIdProvider';
import { IRemoteKernelFinder } from './raw/types';
import { INotebookProvider, KernelConnectionMetadata } from './types';

@injectable()
export class KernelFinder extends BaseKernelFinder {
    constructor(
        @inject(IRemoteKernelFinder) remoteKernelFinder: IRemoteKernelFinder,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) interpreterService: IInterpreterService,
        @inject(PreferredRemoteKernelIdProvider) preferredRemoteFinder: PreferredRemoteKernelIdProvider,
        @inject(INotebookProvider) notebookProvider: INotebookProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalState: Memento,
        @inject(IJupyterServerUriStorage) serverUriStorage: IJupyterServerUriStorage
    ) {
        super(
            extensionChecker,
            interpreterService,
            preferredRemoteFinder,
            notebookProvider,
            undefined, // Local not supported in web
            remoteKernelFinder,
            globalState,
            serverUriStorage
        );
    }
    protected async isValidCachedKernel(kernel: KernelConnectionMetadata): Promise<boolean> {
        switch (kernel.kind) {
            case 'startUsingRemoteKernelSpec':
            case 'connectToLiveRemoteKernel':
                // If this is a a remote kernel, it's valid if the URI is still active
                const uri = await this.serverUriStorage.getRemoteUri();
                return uri && uri.includes(kernel.baseUrl) ? true : false;

            case 'startUsingPythonInterpreter':
            case 'startUsingLocalKernelSpec':
                return false;
        }

        return true;
    }
}
