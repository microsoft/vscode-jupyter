// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject, named } from 'inversify';
import { Disposable, Memento } from 'vscode';
import { IKernelFinder, IKernelProvider } from '../../types';
import { GLOBAL_MEMENTO, IDisposableRegistry, IExtensions, IMemento } from '../../../platform/common/types';
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
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { RemoteKernelFinder } from './remoteKernelFinder';
import { ContributedKernelFinderKind } from '../../internalTypes';
import * as localize from '../../../platform/common/utils/localize';
import { RemoteKernelSpecsCacheKey } from '../../common/commonFinder';
import { Settings } from '../../../platform/common/constants';
import { JupyterConnection } from '../connection/jupyterConnection';

/** Strategy design */
interface IRemoteKernelFinderRegistrationStrategy {
    activate(): Promise<void>;
    dispose(): void;
}

class MultiServerStrategy implements IRemoteKernelFinderRegistrationStrategy {
    private serverFinderMapping: Map<string, RemoteKernelFinder> = new Map<string, RemoteKernelFinder>();

    constructor(
        private jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        private extensionChecker: IPythonExtensionChecker,
        private readonly serverUriStorage: IJupyterServerUriStorage,
        private readonly globalState: Memento,
        private readonly env: IApplicationEnvironment,
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        private readonly kernelFinder: KernelFinder,
        private readonly disposables: IDisposableRegistry,
        private readonly kernelProvider: IKernelProvider,
        private readonly extensions: IExtensions,
        private readonly jupyterConnection: JupyterConnection
    ) {}

    async activate(): Promise<void> {
        // Add in the URIs that we already know about
        const currentServers = await this.serverUriStorage.getSavedUriList();
        currentServers.forEach(this.createRemoteKernelFinder.bind(this));

        // Check for when more URIs are added
        this.serverUriStorage.onDidAddUri(this.createRemoteKernelFinder, this, this.disposables);

        // Also check for when a URI is removed
        this.serverUriStorage.onDidRemoveUris(this.urisRemoved, this, this.disposables);
    }

    createRemoteKernelFinder(serverUri: IJupyterServerUriEntry) {
        if (!serverUri.isValidated) {
            // when server uri is validated, an `onDidAddUri` event will be fired.
            return;
        }

        if (serverUri.uri === Settings.JupyterServerLocalLaunch) {
            // 'local' uri is not a remote server.
            return;
        }

        if (!this.serverFinderMapping.has(serverUri.serverId)) {
            const finder = new RemoteKernelFinder(
                `${ContributedKernelFinderKind.Remote}-${serverUri.serverId}`,
                localize.DataScience.universalRemoteKernelFinderDisplayName(serverUri.displayName || serverUri.uri),
                `${RemoteKernelSpecsCacheKey}-${serverUri.serverId}`,
                this.jupyterSessionManagerFactory,
                this.extensionChecker,
                this.globalState,
                this.env,
                this.cachedRemoteKernelValidator,
                this.kernelFinder,
                this.kernelProvider,
                this.extensions,
                serverUri,
                this.jupyterConnection
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

// This class creates RemoteKernelFinders for all registered Jupyter Server URIs
@injectable()
export class RemoteKernelFinderController implements IExtensionSyncActivationService {
    private _strategy: IRemoteKernelFinderRegistrationStrategy;
    private _localDisposables: Disposable[] = [];

    constructor(
        @inject(IJupyterSessionManagerFactory)
        private readonly jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(IJupyterRemoteCachedKernelValidator)
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        @inject(IKernelFinder) private readonly kernelFinder: KernelFinder,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(JupyterConnection) jupyterConnection: JupyterConnection
    ) {
        this._strategy = new MultiServerStrategy(
            this.jupyterSessionManagerFactory,
            this.extensionChecker,
            this.serverUriStorage,
            this.globalState,
            this.env,
            this.cachedRemoteKernelValidator,
            this.kernelFinder,
            this._localDisposables,
            this.kernelProvider,
            this.extensions,
            jupyterConnection
        );
    }

    dispose() {
        this._strategy?.dispose();
        this._localDisposables.forEach((d) => d.dispose());
    }

    activate() {
        this._strategy.activate().then(noop, noop);
    }
}
