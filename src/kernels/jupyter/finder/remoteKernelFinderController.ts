// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable, inject, named } from 'inversify';
import { Disposable, Memento } from 'vscode';
import { IKernelFinder, IKernelProvider, INotebookProvider } from '../../types';
import {
    GLOBAL_MEMENTO,
    IDisposableRegistry,
    IExtensions,
    IFeaturesManager,
    IMemento
} from '../../../platform/common/types';
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
import { RemoteKernelFinder } from './remoteKernelFinder';
import { ContributedKernelFinderKind } from '../../internalTypes';
import * as localize from '../../../platform/common/utils/localize';
import { RemoteKernelSpecsCacheKey } from '../../common/commonFinder';

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
        private readonly notebookProvider: INotebookProvider,
        private readonly serverUriStorage: IJupyterServerUriStorage,
        private readonly globalState: Memento,
        private readonly env: IApplicationEnvironment,
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        private readonly kernelFinder: KernelFinder,
        private readonly disposables: IDisposableRegistry,
        private readonly kernelProvider: IKernelProvider,
        private readonly extensions: IExtensions
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

        if (!this.serverFinderMapping.has(serverUri.serverId)) {
            const finder = new RemoteKernelFinder(
                `${ContributedKernelFinderKind.Remote}-${serverUri.serverId}`,
                localize.DataScience.universalRemoteKernelFinderDisplayName().format(
                    serverUri.displayName || serverUri.uri
                ),
                `${RemoteKernelSpecsCacheKey}-${serverUri.serverId}`,
                this.jupyterSessionManagerFactory,
                this.extensionChecker,
                this.notebookProvider,
                this.globalState,
                this.env,
                this.cachedRemoteKernelValidator,
                this.kernelFinder,
                this.kernelProvider,
                this.extensions,
                serverUri
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

class SingleServerStrategy implements IRemoteKernelFinderRegistrationStrategy {
    private _activeServerFinder: { entry: IJupyterServerUriEntry; finder: RemoteKernelFinder } | undefined;
    constructor(
        private jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        private extensionChecker: IPythonExtensionChecker,
        private readonly notebookProvider: INotebookProvider,
        private readonly serverUriStorage: IJupyterServerUriStorage,
        private readonly globalState: Memento,
        private readonly env: IApplicationEnvironment,
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        private readonly kernelFinder: KernelFinder,
        private readonly disposables: IDisposableRegistry,
        private readonly kernelProvider: IKernelProvider,
        private readonly extensions: IExtensions
    ) {}

    async activate(): Promise<void> {
        this.disposables.push(
            this.serverUriStorage.onDidChangeUri(() => {
                this.updateRemoteKernelFinder().then(noop, noop);
            })
        );

        this.updateRemoteKernelFinder().then(noop, noop);
    }

    async updateRemoteKernelFinder() {
        if (this.serverUriStorage.isLocalLaunch) {
            // no remote kernel finder needed
            this._activeServerFinder?.finder.dispose();
            this._activeServerFinder = undefined;
            return;
        }

        const uri = await this.serverUriStorage.getRemoteUri();
        // uri should not be local

        if (!uri || !uri.isValidated) {
            this._activeServerFinder?.finder.dispose();
            this._activeServerFinder = undefined;
            return;
        }

        if (this._activeServerFinder?.entry.serverId === uri.serverId) {
            // no op
            return;
        }

        this._activeServerFinder?.finder.dispose();
        const finder = new RemoteKernelFinder(
            'currentremote',
            localize.DataScience.remoteKernelFinderDisplayName(),
            RemoteKernelSpecsCacheKey,
            this.jupyterSessionManagerFactory,
            this.extensionChecker,
            this.notebookProvider,
            this.globalState,
            this.env,
            this.cachedRemoteKernelValidator,
            this.kernelFinder,
            this.kernelProvider,
            this.extensions,
            uri
        );

        this._activeServerFinder = {
            entry: uri,
            finder
        };

        finder.activate().then(noop, noop);
    }

    dispose() {
        this._activeServerFinder?.finder.dispose();
    }
}

// This class creates RemoteKernelFinders for all registered Jupyter Server URIs
@injectable()
export class RemoteKernelFinderController implements IExtensionSingleActivationService {
    private _strategy: IRemoteKernelFinderRegistrationStrategy;
    private _localDisposables: Disposable[] = [];

    constructor(
        @inject(IJupyterSessionManagerFactory)
        private readonly jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
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
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager
    ) {
        this._strategy = this.getStrategy();
        this.disposables.push(this);

        const updatePerFeature = (skipActivation: boolean) => {
            this._strategy?.dispose();
            this._localDisposables.forEach((d) => d.dispose());
            this._localDisposables = [];

            this._strategy = this.getStrategy();

            if (!skipActivation) {
                this._strategy.activate().then(noop, noop);
            }
        };

        this.disposables.push(this.featuresManager.onDidChangeFeatures(() => updatePerFeature(false)));

        updatePerFeature(true);
    }

    dispose() {
        this._strategy?.dispose();
        this._localDisposables.forEach((d) => d.dispose());
    }

    private getStrategy(): IRemoteKernelFinderRegistrationStrategy {
        if (this.featuresManager.features.kernelPickerType === 'Insiders') {
            return new MultiServerStrategy(
                this.jupyterSessionManagerFactory,
                this.extensionChecker,
                this.notebookProvider,
                this.serverUriStorage,
                this.globalState,
                this.env,
                this.cachedRemoteKernelValidator,
                this.kernelFinder,
                this._localDisposables,
                this.kernelProvider,
                this.extensions
            );
        } else {
            return new SingleServerStrategy(
                this.jupyterSessionManagerFactory,
                this.extensionChecker,
                this.notebookProvider,
                this.serverUriStorage,
                this.globalState,
                this.env,
                this.cachedRemoteKernelValidator,
                this.kernelFinder,
                this._localDisposables,
                this.kernelProvider,
                this.extensions
            );
        }
    }

    async activate(): Promise<void> {
        this._strategy.activate().then(noop, noop);
    }
}
