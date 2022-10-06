// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable, inject, named } from 'inversify';
import { Memento } from 'vscode';
import { IKernelFinder, IKernelProvider, INotebookProvider } from '../../types';
import {
    GLOBAL_MEMENTO,
    IDisposableRegistry,
    IExtensions,
    IMemento,
    IsWebExtension
} from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import {
    IJupyterSessionManagerFactory,
    IJupyterServerUriStorage,
    IJupyterRemoteCachedKernelValidator,
    IJupyterServerUriEntry
} from '../types';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { noop } from '../../../platform/common/utils/misc';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { KernelFinder } from '../../kernelFinder';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { UniversalRemoteKernelFinder } from './universalRemoteKernelFinder';

// This class creates RemoteKernelFinders for all registered Jupyter Server URIs
@injectable()
export class UniversalRemoteKernelFinderController implements IExtensionSingleActivationService {
    private serverFinderMapping: Map<string, UniversalRemoteKernelFinder> = new Map<
        string,
        UniversalRemoteKernelFinder
    >();

    constructor(
        @inject(IJupyterSessionManagerFactory) private jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(IJupyterRemoteCachedKernelValidator)
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        @inject(IKernelFinder) private readonly kernelFinder: KernelFinder,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IsWebExtension) private isWebExtension: boolean
    ) {}

    async activate(): Promise<void> {
        // Add in the URIs that we already know about
        const currentServers = await this.serverUriStorage.getSavedUriList();
        currentServers.forEach(this.createRemoteKernelFinder.bind(this));

        // Check for when more URIs are added
        this.serverUriStorage.onDidAddUri(this.createRemoteKernelFinder.bind(this));

        // Also check for when a URI is removed
    }

    createRemoteKernelFinder(serverUri: IJupyterServerUriEntry) {
        if (!this.serverFinderMapping.has(serverUri.serverId)) {
            const finder = new UniversalRemoteKernelFinder(
                this.jupyterSessionManagerFactory,
                this.interpreterService,
                this.extensionChecker,
                this.notebookProvider,
                this.globalState,
                this.env,
                this.cachedRemoteKernelValidator,
                this.kernelFinder,
                this.disposables,
                this.kernelProvider,
                this.extensions,
                this.isWebExtension,
                serverUri
            );

            this.serverFinderMapping.set(serverUri.serverId, finder);

            finder.activate().then(noop, noop);
        }
    }
}
