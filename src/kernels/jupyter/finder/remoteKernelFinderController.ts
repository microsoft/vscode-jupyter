// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { IKernelFinder, IKernelProvider } from '../../types';
import { IDisposableRegistry, IExtensionContext } from '../../../platform/common/types';
import {
    IOldJupyterSessionManagerFactory,
    IJupyterServerUriStorage,
    IJupyterRemoteCachedKernelValidator,
    IJupyterServerUriEntry,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';
import { noop } from '../../../platform/common/utils/misc';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { KernelFinder } from '../../kernelFinder';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { RemoteKernelFinder } from './remoteKernelFinder';
import { JupyterConnection } from '../connection/jupyterConnection';
import { IFileSystem } from '../../../platform/common/platform/types';
import { ContributedKernelFinderKind } from '../../internalTypes';
import { generateIdFromRemoteProvider } from '../jupyterUtils';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import { IJupyterUriProvider } from '../../../api';

@injectable()
export class RemoteKernelFinderController implements IExtensionSyncActivationService {
    private serverFinderMapping: Map<string, RemoteKernelFinder> = new Map<string, RemoteKernelFinder>();

    constructor(
        @inject(IOldJupyterSessionManagerFactory)
        private readonly jupyterSessionManagerFactory: IOldJupyterSessionManagerFactory,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(IJupyterRemoteCachedKernelValidator)
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        @inject(IKernelFinder) private readonly kernelFinder: KernelFinder,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration
    ) {}
    private readonly handledProviders = new WeakSet<IJupyterUriProvider>();
    activate() {
        this.serverUriStorage.onDidAdd((server) => this.validateAndCreateFinder(server), this, this.disposables);
        this.serverUriStorage.onDidChange(this.buildListOfFinders, this, this.disposables);
        // Possible some extensions register their providers later.
        // And also possible they load their old server later, hence we need to go through the
        // MRU list again and try to build the finders, as the servers might now exist.
        this.jupyterPickerRegistration.onDidChangeProviders(this.handleProviderHandleChanges, this, this.disposables);

        // Also check for when a URI is removed
        this.serverUriStorage.onDidRemove(this.urisRemoved, this, this.disposables);

        // Add in the URIs that we already know about
        this.buildListOfFinders();
    }
    private buildListOfFinders() {
        // Add in the URIs that we already know about
        this.serverUriStorage
            .getAll()
            .then((currentServers) => currentServers.map((server) => this.validateAndCreateFinder(server).catch(noop)))
            .catch(noop);
    }
    private handleProviderHandleChanges() {
        this.jupyterPickerRegistration.providers.forEach((provider) => {
            if (!this.handledProviders.has(provider)) {
                this.handledProviders.add(provider);
                if (provider.onDidChangeHandles) {
                    provider.onDidChangeHandles(this.buildListOfFinders, this, this.disposables);
                }
            }
        });
        this.buildListOfFinders();
    }
    @swallowExceptions('Failed to create a Remote Kernel Finder')
    private async validateAndCreateFinder(serverUri: IJupyterServerUriEntry) {
        const serverId = generateIdFromRemoteProvider(serverUri.provider);
        if (!this.serverFinderMapping.has(serverId)) {
            const info = await this.jupyterPickerRegistration.getJupyterServerUri(serverUri.provider, true);
            this.createRemoteKernelFinder(serverUri.provider, info.displayName);
        }
    }

    createRemoteKernelFinder(serverProviderHandle: JupyterServerProviderHandle, displayName: string) {
        const serverId = generateIdFromRemoteProvider(serverProviderHandle);
        if (!this.serverFinderMapping.has(serverId)) {
            const finder = new RemoteKernelFinder(
                `${ContributedKernelFinderKind.Remote}-${serverId}`,
                displayName,
                this.jupyterSessionManagerFactory,
                this.env,
                this.cachedRemoteKernelValidator,
                this.kernelFinder,
                this.kernelProvider,
                serverProviderHandle,
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
