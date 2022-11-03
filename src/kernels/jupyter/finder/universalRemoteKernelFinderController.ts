// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable, inject, named } from 'inversify';
import { Memento } from 'vscode';
import { IKernelFinder, IKernelProvider, INotebookProvider } from '../../types';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
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
import { ContributedKernelFinderKind } from '../../internalTypes';
import * as localize from '../../../platform/common/utils/localize';
import { RemoteKernelSpecsCacheKey } from '../../common/commonFinder';

/** Strategy design */
interface IRemoteKernelFinderRegistrationStrategy {
    activate(): Promise<void>;
}

class MultiServerStrategy implements IRemoteKernelFinderRegistrationStrategy {
    private serverFinderMapping: Map<string, UniversalRemoteKernelFinder> = new Map<
        string,
        UniversalRemoteKernelFinder
    >();

    constructor(
        private jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        private interpreterService: IInterpreterService,
        private extensionChecker: IPythonExtensionChecker,
        private readonly notebookProvider: INotebookProvider,
        private readonly serverUriStorage: IJupyterServerUriStorage,
        private readonly globalState: Memento,
        private readonly env: IApplicationEnvironment,
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        private readonly kernelFinder: KernelFinder,
        private readonly disposables: IDisposableRegistry,
        private readonly kernelProvider: IKernelProvider,
        private readonly extensions: IExtensions,
        private isWebExtension: boolean
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
            // TODO@rebornix, what if it's now validated?
            return;
        }

        if (!this.serverFinderMapping.has(serverUri.serverId)) {
            const finder = new UniversalRemoteKernelFinder(
                `${ContributedKernelFinderKind.Remote}-${serverUri.serverId}`,
                localize.DataScience.universalRemoteKernelFinderDisplayName().format(
                    serverUri.displayName || serverUri.uri
                ),
                `${RemoteKernelSpecsCacheKey}-${serverUri.serverId}`,
                this.jupyterSessionManagerFactory,
                this.interpreterService,
                this.extensionChecker,
                this.notebookProvider,
                this.globalState,
                this.env,
                this.cachedRemoteKernelValidator,
                this.kernelFinder,
                this.kernelProvider,
                this.extensions,
                this.isWebExtension,
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
}

class SingleServerStrategy implements IRemoteKernelFinderRegistrationStrategy {
    private _activeServerFinder: { entry: IJupyterServerUriEntry; finder: UniversalRemoteKernelFinder } | undefined;
    constructor(
        private jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        private interpreterService: IInterpreterService,
        private extensionChecker: IPythonExtensionChecker,
        private readonly notebookProvider: INotebookProvider,
        private readonly serverUriStorage: IJupyterServerUriStorage,
        private readonly globalState: Memento,
        private readonly env: IApplicationEnvironment,
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        private readonly kernelFinder: KernelFinder,
        private readonly disposables: IDisposableRegistry,
        private readonly kernelProvider: IKernelProvider,
        private readonly extensions: IExtensions,
        private isWebExtension: boolean
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
        const finder = new UniversalRemoteKernelFinder(
            'currentremote',
            localize.DataScience.remoteKernelFinderDisplayName(),
            RemoteKernelSpecsCacheKey,
            this.jupyterSessionManagerFactory,
            this.interpreterService,
            this.extensionChecker,
            this.notebookProvider,
            this.globalState,
            this.env,
            this.cachedRemoteKernelValidator,
            this.kernelFinder,
            this.kernelProvider,
            this.extensions,
            this.isWebExtension,
            uri
        );

        this._activeServerFinder = {
            entry: uri,
            finder
        };

        finder.activate().then(noop, noop);
    }
}

// This class creates RemoteKernelFinders for all registered Jupyter Server URIs
@injectable()
export class UniversalRemoteKernelFinderController implements IExtensionSingleActivationService {
    private _strategy: IRemoteKernelFinderRegistrationStrategy;

    constructor(
        @inject(IConfigurationService) readonly configurationService: IConfigurationService,
        @inject(IJupyterSessionManagerFactory) jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IInterpreterService) interpreterService: IInterpreterService,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(INotebookProvider) notebookProvider: INotebookProvider,
        @inject(IJupyterServerUriStorage) serverUriStorage: IJupyterServerUriStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalState: Memento,
        @inject(IApplicationEnvironment) env: IApplicationEnvironment,
        @inject(IJupyterRemoteCachedKernelValidator)
        cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        @inject(IKernelFinder) kernelFinder: KernelFinder,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IKernelProvider) kernelProvider: IKernelProvider,
        @inject(IExtensions) extensions: IExtensions,
        @inject(IsWebExtension) isWebExtension: boolean
    ) {
        if (this.configurationService.getSettings().kernelPickerType === 'Insiders') {
            this._strategy = new MultiServerStrategy(
                jupyterSessionManagerFactory,
                interpreterService,
                extensionChecker,
                notebookProvider,
                serverUriStorage,
                globalState,
                env,
                cachedRemoteKernelValidator,
                kernelFinder,
                disposables,
                kernelProvider,
                extensions,
                isWebExtension
            );
        } else {
            this._strategy = new SingleServerStrategy(
                jupyterSessionManagerFactory,
                interpreterService,
                extensionChecker,
                notebookProvider,
                serverUriStorage,
                globalState,
                env,
                cachedRemoteKernelValidator,
                kernelFinder,
                disposables,
                kernelProvider,
                extensions,
                isWebExtension
            );
        }
    }

    async activate(): Promise<void> {
        this._strategy.activate().then(noop, noop);
    }
}
