// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';

import { GLOBAL_MEMENTO, IExtensions, IMemento } from '../../platform/common/types';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import * as localize from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { InvalidRemoteJupyterServerUriHandleError } from '../../platform/errors/invalidRemoteJupyterServerUriHandleError';
import { JupyterUriProviderWrapper } from './jupyterUriProviderWrapper';
import {
    IJupyterServerUri,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    JupyterServerUriHandle
} from './types';

const REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY = 'REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY';
@injectable()
export class JupyterUriProviderRegistration implements IJupyterUriProviderRegistration {
    private loadedOtherExtensionsPromise: Promise<void> | undefined;
    private providers = new Map<string, Promise<IJupyterUriProvider>>();
    private providerExtensionMapping = new Map<string, string>();

    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento
    ) {}

    public async getProviders(): Promise<ReadonlyArray<IJupyterUriProvider>> {
        await this.checkOtherExtensions();

        // Other extensions should have registered in their activate callback
        return Promise.all([...this.providers.values()]);
    }

    public async registerProvider(provider: IJupyterUriProvider) {
        if (!this.providers.has(provider.id)) {
            this.providers.set(provider.id, this.createProvider(provider));
        } else {
            throw new Error(`IJupyterUriProvider already exists with id ${provider.id}`);
        }
    }

    public async getJupyterServerUri(id: string, handle: JupyterServerUriHandle): Promise<IJupyterServerUri> {
        await this.checkOtherExtensions();

        const providerPromise = this.providers.get(id);
        if (providerPromise) {
            const provider = await providerPromise;
            if (provider.getHandles) {
                const handles = await provider.getHandles();
                if (!handles.includes(handle)) {
                    const extensionId = this.providerExtensionMapping.get(id)!;
                    throw new InvalidRemoteJupyterServerUriHandleError(id, handle, extensionId);
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

    private async createProvider(provider: IJupyterUriProvider): Promise<IJupyterUriProvider> {
        const info = await this.extensions.determineExtensionFromCallStack();
        this.updateRegistrationInfo(provider.id, info.extensionId).catch(noop);
        return new JupyterUriProviderWrapper(provider, info.extensionId);
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
