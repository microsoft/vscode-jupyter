// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { injectable, inject, named } from 'inversify';
import { Memento } from 'vscode';
import { IPythonExtensionChecker } from '../platform/api/types';
import { GLOBAL_MEMENTO, IMemento } from '../platform/common/types';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { ServerConnectionType } from './jupyter/launcher/serverConnectionType';
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
        @inject(IJupyterServerUriStorage) serverUriStorage: IJupyterServerUriStorage,
        @inject(ServerConnectionType) serverConnectionType: ServerConnectionType
    ) {
        super(
            extensionChecker,
            interpreterService,
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
        }

        return true;
    }
}
