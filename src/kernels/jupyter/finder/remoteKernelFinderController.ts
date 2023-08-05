// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { IKernelFinder, IKernelProvider } from '../../types';
import { IDisposableRegistry, IExtensionContext, IExtensions } from '../../../platform/common/types';
import {
    IOldJupyterSessionManagerFactory,
    IJupyterServerUriStorage,
    IJupyterRemoteCachedKernelValidator,
    IJupyterServerUriEntry
} from '../types';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { noop } from '../../../platform/common/utils/misc';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { KernelFinder } from '../../kernelFinder';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { RemoteKernelFinder } from './remoteKernelFinder';
import { JupyterConnection } from '../connection/jupyterConnection';
import { IFileSystem } from '../../../platform/common/platform/types';
import { ContributedKernelFinderKind } from '../../internalTypes';
import { generateIdFromRemoteProvider } from '../jupyterUtils';

@injectable()
export class RemoteKernelFinderController implements IExtensionSyncActivationService {
    private serverFinderMapping: Map<string, RemoteKernelFinder> = new Map<string, RemoteKernelFinder>();

    constructor(
        @inject(IOldJupyterSessionManagerFactory)
        private readonly jupyterSessionManagerFactory: IOldJupyterSessionManagerFactory,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(IJupyterRemoteCachedKernelValidator)
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        @inject(IKernelFinder) private readonly kernelFinder: KernelFinder,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}

    activate() {
        // Check for when more URIs are added
        this.serverUriStorage.onDidAdd(this.createRemoteKernelFinder, this, this.disposables);
        // Also check for when a URI is removed
        this.serverUriStorage.onDidRemove(this.urisRemoved, this, this.disposables);
        this.serverUriStorage.onDidChange(
            () => this.serverUriStorage.all.forEach(this.createRemoteKernelFinder.bind(this)),
            this,
            this.disposables
        );
        this.serverUriStorage.all.forEach(this.createRemoteKernelFinder.bind(this));
        // // Load the list of User Provided Jupyter Servers earlier
        // // Debt, needs more work to make this faster and simpler
        // this.serverUriStorage
        //     .getServers(JVSC_EXTENSION_ID, UserJupyterServerPickerProviderId)
        //     .then((currentServers) => currentServers.forEach(this.createRemoteKernelFinder.bind(this)))
        //     .catch(noop);

        // Add in the URIs that we already know about
        this.serverUriStorage
            .getAll(false)
            .then((currentServers) => currentServers.forEach(this.createRemoteKernelFinder.bind(this)))
            .catch(noop);
    }

    createRemoteKernelFinder(serverUri: IJupyterServerUriEntry) {
        const serverId = generateIdFromRemoteProvider(serverUri.provider);
        if (!this.serverFinderMapping.has(serverId)) {
            const finder = new RemoteKernelFinder(
                `${ContributedKernelFinderKind.Remote}-${serverId}`,
                serverUri.displayName || generateIdFromRemoteProvider(serverUri.provider),
                this.jupyterSessionManagerFactory,
                this.extensionChecker,
                this.env,
                this.cachedRemoteKernelValidator,
                this.kernelFinder,
                this.kernelProvider,
                this.extensions,
                serverUri,
                this.jupyterConnection,
                this.fs,
                this.context
            );
            this.disposables.push(finder);

            this.serverFinderMapping.set(serverId, finder);

            finder.activate().then(noop, noop);
        }
    }

    // When a URI is removed, dispose the kernel finder for it
    urisRemoved(uris: IJupyterServerUriEntry[]) {
        uris.forEach((uri) => {
            const serverId = generateIdFromRemoteProvider(uri.provider);
            const serverFinder = this.serverFinderMapping.get(serverId);
            serverFinder && serverFinder.dispose();
            this.serverFinderMapping.delete(serverId);
        });
    }

    dispose() {
        this.serverFinderMapping.forEach((finder) => finder.dispose());
    }
}
