// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { EventEmitter, Memento } from 'vscode';

import { GLOBAL_MEMENTO, IDisposable, IDisposableRegistry, IExtensions, IMemento } from '../../platform/common/types';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import * as localize from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { InvalidRemoteJupyterServerUriHandleError } from '../errors/invalidRemoteJupyterServerUriHandleError';
import { JupyterUriProviderWrapper } from './jupyterUriProviderWrapper';
import { computeServerId, generateUriFromRemoteProvider } from './jupyterUtils';
import {
    IJupyterServerUri,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    JupyterServerUriHandle
} from './types';

const REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY = 'REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY';

/**
 * Handles registration of 3rd party URI providers.
 */
@injectable()
export class JupyterUriProviderRegistration implements IJupyterUriProviderRegistration {
    private readonly _onProvidersChanged = new EventEmitter<void>();
    private loadedOtherExtensionsPromise: Promise<void> | undefined;
    private providers = new Map<string, [Promise<JupyterUriProviderWrapper>, IDisposable[]]>();
    private providerExtensionMapping = new Map<string, string>();
    public readonly onDidChangeProviders = this._onProvidersChanged.event;

    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento
    ) {
        disposables.push(this._onProvidersChanged);
    }

    public async getProviders(): Promise<ReadonlyArray<IJupyterUriProvider>> {
        await this.checkOtherExtensions();

        // Other extensions should have registered in their activate callback
        return Promise.all([...this.providers.values()].map((p) => p[0]));
    }

    public async getProvider(id: string): Promise<IJupyterUriProvider | undefined> {
        await this.checkOtherExtensions();

        return this.providers.get(id)?.[0];
    }

    public registerProvider(provider: IJupyterUriProvider) {
        if (!this.providers.has(provider.id)) {
            const localDisposables: IDisposable[] = [];
            this.providers.set(provider.id, [this.createProvider(provider, localDisposables), localDisposables]);
        } else {
            throw new Error(`IJupyterUriProvider already exists with id ${provider.id}`);
        }
        this._onProvidersChanged.fire();

        return {
            dispose: () => {
                this.providers.get(provider.id)?.[1].forEach((d) => d.dispose());
                this.providers.delete(provider.id);
                this._onProvidersChanged.fire();
            }
        };
    }
    public async getJupyterServerUri(id: string, handle: JupyterServerUriHandle): Promise<IJupyterServerUri> {
        await this.checkOtherExtensions();

        const providerPromise = this.providers.get(id)?.[0];
        if (providerPromise) {
            const provider = await providerPromise;
            if (provider.getHandles) {
                const handles = await provider.getHandles();
                if (!handles.includes(handle)) {
                    const extensionId = this.providerExtensionMapping.get(id)!;
                    const serverId = await computeServerId(generateUriFromRemoteProvider(id, handle));
                    throw new InvalidRemoteJupyterServerUriHandleError(id, handle, extensionId, serverId);
                }
            }
            return provider.getServerUri(handle);
        }
        throw new Error(localize.DataScience.unknownServerUri());
    }

    private checkOtherExtensions(): Promise<void> {
        if (!this.loadedOtherExtensionsPromise) {
            this.loadedOtherExtensionsPromise = this.loadOtherExtensions();
        }
        return this.loadedOtherExtensionsPromise;
    }

    private async loadOtherExtensions(): Promise<void> {
        this.loadExistingProviderExtensionMapping();
        const extensionIds = new Set<string>();
        this.globalMemento
            .get<{ extensionId: string; providerId: string }[]>(REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY, [])
            .forEach((item) => extensionIds.add(item.extensionId));

        const list = this.extensions.all
            .filter((e) => e.packageJSON?.contributes?.pythonRemoteServerProvider || extensionIds.has(e.id))
            .map((e) => (e.isActive ? Promise.resolve() : e.activate().then(noop, noop)));
        await Promise.all(list);
    }

    private async createProvider(
        provider: IJupyterUriProvider,
        localDisposables: IDisposable[]
    ): Promise<JupyterUriProviderWrapper> {
        const info = await this.extensions.determineExtensionFromCallStack();
        this.updateRegistrationInfo(provider.id, info.extensionId).catch(noop);
        return new JupyterUriProviderWrapper(provider, info.extensionId, localDisposables);
    }
    @swallowExceptions()
    private async updateRegistrationInfo(providerId: string, extensionId: string): Promise<void> {
        this.loadExistingProviderExtensionMapping();
        this.providerExtensionMapping.set(providerId, extensionId);

        const newList: { extensionId: string; providerId: string }[] = [];
        this.providerExtensionMapping.forEach((providerId, extensionId) => {
            newList.push({ extensionId, providerId });
        });
        await this.globalMemento.update(REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY, newList);
    }
    private loadExistingProviderExtensionMapping() {
        const registeredList = this.globalMemento.get<{ extensionId: string; providerId: string }[]>(
            REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY,
            []
        );
        registeredList.forEach((item) => this.providerExtensionMapping.set(item.providerId, item.extensionId));
    }
}
