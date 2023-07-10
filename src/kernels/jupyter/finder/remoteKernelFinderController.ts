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
        // Add in the URIs that we already know about
        this.serverUriStorage
            .getAll()
            .then((currentServers) => {
                currentServers.forEach(this.createRemoteKernelFinder.bind(this));

                // Check for when more URIs are added
                this.serverUriStorage.onDidAdd(this.createRemoteKernelFinder, this, this.disposables);

                // Also check for when a URI is removed
                this.serverUriStorage.onDidRemove(this.urisRemoved, this, this.disposables);
            })
            .catch(noop);
    }

    createRemoteKernelFinder(serverUri: IJupyterServerUriEntry) {
        if (!serverUri.isValidated) {
            // when server uri is validated, an `onDidAddUri` event will be fired.
            return;
        }

        if (!this.serverFinderMapping.has(serverUri.serverId)) {
            const finder = new RemoteKernelFinder(
                `${ContributedKernelFinderKind.Remote}-${serverUri.serverId}`,
                serverUri.displayName || serverUri.uri,
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

            this.serverFinderMapping.set(serverUri.serverId, finder);

            finder.activate().then(noop, noop);
        }
    }

    // When a URI is removed, dispose the kernel finder for it
    urisRemoved(uris: IJupyterServerUriEntry[]) {
        uris.forEach((uri) => {
            const serverFinder = this.serverFinderMapping.get(uri.serverId);
            serverFinder && serverFinder.dispose();
            this.serverFinderMapping.delete(uri.serverId);
        });
    }

    dispose() {
        this.serverFinderMapping.forEach((finder) => finder.dispose());
    }
}
