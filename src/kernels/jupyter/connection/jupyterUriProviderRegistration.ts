// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Event, EventEmitter, Memento, QuickPickItem } from 'vscode';
import { JVSC_EXTENSION_ID, Telemetry } from '../../../platform/common/constants';

import {
    GLOBAL_MEMENTO,
    IDisposable,
    IDisposableRegistry,
    IExtensions,
    IMemento
} from '../../../platform/common/types';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import * as localize from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { InvalidRemoteJupyterServerUriHandleError } from '../../errors/invalidRemoteJupyterServerUriHandleError';
import { computeServerId, generateUriFromRemoteProvider } from '../jupyterUtils';
import {
    IJupyterServerUri,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    JupyterServerUriHandle
} from '../types';
import { sendTelemetryEvent } from '../../../telemetry';
import { traceError } from '../../../platform/logging';

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
        await this.loadOtherExtensions();

        // Other extensions should have registered in their activate callback
        return Promise.all([...this.providers.values()].map((p) => p[0]));
    }

    public async getProvider(id: string): Promise<IJupyterUriProvider | undefined> {
        await this.loadOtherExtensions();
        const value = this.providers.get(id);
        return value ? value[0] : undefined;
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
        await this.loadOtherExtensions();

        const providerPromise = this.providers.get(id)?.[0];
        if (!providerPromise) {
            traceError(`${localize.DataScience.unknownServerUri}. Provider Id=${id} and handle=${handle}`);
            throw new Error(localize.DataScience.unknownServerUri);
        }
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

    private loadOtherExtensions(): Promise<void> {
        if (!this.loadedOtherExtensionsPromise) {
            this.loadedOtherExtensionsPromise = this.loadOtherExtensionsImpl();
        }
        return this.loadedOtherExtensionsPromise;
    }

    private async loadOtherExtensionsImpl(): Promise<void> {
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
        const extensionId = provider.id.startsWith('_builtin')
            ? JVSC_EXTENSION_ID
            : (await this.extensions.determineExtensionFromCallStack()).extensionId;
        this.updateRegistrationInfo(provider.id, extensionId).catch(noop);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return new JupyterUriProviderWrapper(provider, extensionId, localDisposables);
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

const handlesForWhichWeHaveSentTelemetry = new Set<string>();
/**
 * This class wraps an IJupyterUriProvider provided by another extension. It allows us to show
 * extra data on the other extension's UI.
 */
class JupyterUriProviderWrapper implements IJupyterUriProvider {
    public readonly id: string;
    public readonly displayName: string | undefined;
    public readonly detail: string | undefined;

    public readonly onDidChangeHandles?: Event<void>;
    public readonly getHandles?: () => Promise<JupyterServerUriHandle[]>;
    public readonly removeHandle?: (handle: JupyterServerUriHandle) => Promise<void>;

    constructor(
        private readonly provider: IJupyterUriProvider,
        private extensionId: string,
        disposables: IDisposableRegistry
    ) {
        this.id = this.provider.id;
        this.displayName = this.provider.displayName;
        this.detail = this.provider.detail;

        if (provider.onDidChangeHandles) {
            const _onDidChangeHandles = new EventEmitter<void>();
            this.onDidChangeHandles = _onDidChangeHandles.event.bind(this);

            disposables.push(_onDidChangeHandles);
            disposables.push(provider.onDidChangeHandles(() => _onDidChangeHandles.fire()));
        }

        if (provider.getHandles) {
            this.getHandles = async () => provider.getHandles!();
        }

        if (provider.removeHandle) {
            this.removeHandle = (handle: JupyterServerUriHandle) => provider.removeHandle!(handle);
        }
    }
    public async getQuickPickEntryItems(): Promise<QuickPickItem[]> {
        if (!this.provider.getQuickPickEntryItems) {
            return [];
        }
        return (await this.provider.getQuickPickEntryItems()).map((q) => {
            return {
                ...q,
                // Add the package name onto the description
                description: localize.DataScience.uriProviderDescriptionFormat(q.description || '', this.extensionId),
                original: q
            };
        });
    }
    public async handleQuickPick(
        item: QuickPickItem,
        back: boolean
    ): Promise<JupyterServerUriHandle | 'back' | undefined> {
        if (!this.provider.handleQuickPick) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((item as any).original) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return this.provider.handleQuickPick((item as any).original, back);
        }
        return this.provider.handleQuickPick(item, back);
    }

    public async getServerUri(handle: JupyterServerUriHandle): Promise<IJupyterServerUri> {
        const server = await this.provider.getServerUri(handle);
        if (!this.id.startsWith('_builtin') && !handlesForWhichWeHaveSentTelemetry.has(handle)) {
            handlesForWhichWeHaveSentTelemetry.add(handle);
            // Need this info to try and remove some of the properties from the API.
            // Before we do that we need to determine what extensions are using which properties.
            const pemUsed: (keyof IJupyterServerUri)[] = [];
            Object.keys(server).forEach((k) => {
                const value = server[k as keyof IJupyterServerUri];
                if (!value) {
                    return;
                }
                if (typeof value === 'object' && Object.keys(value).length === 0 && !(value instanceof Date)) {
                    return;
                }
                pemUsed.push(k as keyof IJupyterServerUri);
            });
            sendTelemetryEvent(Telemetry.JupyterServerProviderResponseApi, undefined, {
                providerId: this.id,
                extensionId: this.extensionId,
                pemUsed
            });
        }
        return server;
    }
}
