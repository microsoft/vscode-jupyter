// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento, QuickPickItem } from 'vscode';
import { JVSC_EXTENSION_ID, Telemetry } from '../../../platform/common/constants';
import { IDisposableRegistry, IExtensions } from '../../../platform/common/types';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import { noop } from '../../../platform/common/utils/misc';
import { IInternalJupyterUriProvider, IJupyterServerProviderRegistry, JupyterServerProviderHandle } from '../types';
import { sendTelemetryEvent } from '../../../telemetry';
import { traceError } from '../../../platform/logging';
import { IJupyterServerUri, IJupyterUriProvider, JupyterServerCommand } from '../../../api';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { generateIdFromRemoteProvider } from '../jupyterUtils';
import { stripCodicons } from '../../../platform/common/helpers';
import { DisposableBase } from '../../../platform/common/utils/lifecycle';

export const REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY = 'REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY';
function getProviderId(extensionId: string, id: string) {
    return `${extensionId}-${id}`;
}
/**
 * Handles registration of 3rd party URI providers.
 */
export class JupyterUriProviderRegistration extends DisposableBase implements IExtensionSyncActivationService {
    private readonly _onProvidersChanged = this._register(new EventEmitter<void>());
    private loadedOtherExtensionsPromise: Promise<void> | undefined;
    private _providers = new Map<string, JupyterUriProviderWrapper>();
    private extensionIdsThatHaveProviders = new Set<string>();
    private readonly cachedDisplayNames = new Map<string, string>();
    public readonly onDidChangeProviders = this._onProvidersChanged.event;
    public get providers() {
        this.loadOtherExtensions().catch(noop);
        return Array.from(this._providers.values());
    }
    constructor(
        private readonly extensions: IExtensions,
        disposables: IDisposableRegistry,
        private readonly globalMemento: Memento
    ) {
        super();
        disposables.push(this);
    }

    public activate(): void {
        //
    }
    public async getProvider(extensionId: string, id: string): Promise<IInternalJupyterUriProvider | undefined> {
        this.loadOtherExtensions().catch(noop);
        const provider = this._providers.get(getProviderId(extensionId, id));
        if (provider) {
            return provider;
        }
        try {
            await this.loadExtension(extensionId, id);
        } catch (ex) {
            traceError(`Failed to load the extension ${extensionId}`, ex);
            return;
        }
        return this._providers.get(getProviderId(extensionId, id));
    }

    public registerProvider(provider: IJupyterUriProvider, extensionId: string) {
        const id = getProviderId(extensionId, provider.id);
        if (!this._providers.has(id)) {
            this.trackExtensionWithProvider(extensionId).catch(noop);
            this._providers.set(
                id,
                // eslint-disable-next-line @typescript-eslint/no-use-before-define, @typescript-eslint/no-use-before-define
                new JupyterUriProviderWrapper(provider, extensionId)
            );
        } else {
            throw new Error(`IJupyterUriProvider already exists with id ${id}`);
        }
        this._onProvidersChanged.fire();

        const disposable = {
            dispose: () => {
                this._providers.delete(id);
                this._onProvidersChanged.fire();
            }
        };
        this._register(disposable);
        return disposable;
    }
    public async getJupyterServerUri(
        providerHandle: JupyterServerProviderHandle,
        doNotPromptForAuthInfo?: boolean
    ): Promise<IJupyterServerUri> {
        const id = getProviderId(providerHandle.extensionId, providerHandle.id);
        if (!this._providers.get(id)) {
            await this.loadExtension(providerHandle.extensionId, providerHandle.id);
        }
        const provider = this._providers.get(id);
        if (!provider) {
            throw new Error(
                `Provider Id=${id} and handle=${providerHandle.handle} not registered. Did you uninstall the extension ${providerHandle.extensionId}?`
            );
        }
        const server = await provider.getServerUri(providerHandle.handle, doNotPromptForAuthInfo);
        this.cachedDisplayNames.set(generateIdFromRemoteProvider(providerHandle), server.displayName);
        return server;
    }
    private async loadExtension(extensionId: string, providerId: string) {
        if (extensionId === JVSC_EXTENSION_ID) {
            return;
        }
        this.loadOtherExtensions().catch(noop);
        const ext = this.extensions.getExtension(extensionId);
        if (!ext) {
            throw new Error(`Extension '${extensionId}' that provides Jupyter Server '${providerId}' not found`);
        }
        if (!ext.isActive) {
            await ext.activate().then(noop, noop);
        }
    }
    private loadOtherExtensions(): Promise<void> {
        if (!this.loadedOtherExtensionsPromise) {
            this.loadedOtherExtensionsPromise = this.loadOtherExtensionsImpl();
        }
        return this.loadedOtherExtensionsPromise;
    }

    private async loadOtherExtensionsImpl(): Promise<void> {
        this.loadListOfExtensionsWithProviders();
        const extensionIds = new Set<string>();
        this.globalMemento
            .get<{ extensionId: string }[]>(REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY, [])
            .forEach((item) => extensionIds.add(item.extensionId));

        const extensions = this.extensions.all
            .filter((e) => e.packageJSON?.contributes?.pythonRemoteServerProvider || extensionIds.has(e.id))
            .filter((e) => e.id !== JVSC_EXTENSION_ID);
        await Promise.all(extensions.map((e) => (e.isActive ? Promise.resolve() : e.activate().then(noop, noop))));
    }

    @swallowExceptions()
    private async trackExtensionWithProvider(extensionId: string): Promise<void> {
        this.loadListOfExtensionsWithProviders();
        this.extensionIdsThatHaveProviders.add(extensionId);

        const items = Array.from(this.extensionIdsThatHaveProviders.values()).map((extensionId) => ({
            extensionId
        }));
        await this.globalMemento.update(REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY, items);
    }
    private loadListOfExtensionsWithProviders() {
        const registeredList = this.globalMemento.get<{ extensionId: string }[]>(
            REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY,
            []
        );
        registeredList.forEach((item) => this.extensionIdsThatHaveProviders.add(item.extensionId));
    }
}

const handlesForWhichWeHaveSentTelemetry = new Set<string>();
/**
 * This class wraps an IJupyterUriProvider provided by another extension. It allows us to show
 * extra data on the other extension's UI.
 */
class JupyterUriProviderWrapper implements IInternalJupyterUriProvider {
    public readonly id: string;
    public get displayName() {
        return stripCodicons(this.provider.displayName);
    }
    public get detail() {
        return stripCodicons(this.provider.detail);
    }
    public get documentation() {
        return this.provider.documentation;
    }
    public get servers() {
        return this.provider.servers;
    }

    public get onDidChangeHandles() {
        return this.provider.onDidChangeHandles;
    }
    public readonly getHandles?: () => Promise<string[]>;

    constructor(
        private readonly provider: IJupyterUriProvider,
        public extensionId: string
    ) {
        this.id = this.provider.id;

        if (provider.getHandles) {
            this.getHandles = async () => provider.getHandles!();
        }
    }
    public async getQuickPickEntryItems(value?: string): Promise<QuickPickItem[]> {
        if (!this.provider.getQuickPickEntryItems) {
            return [];
        }
        return (await this.provider.getQuickPickEntryItems(value)).map((q) => {
            q.label = stripCodicons(q.label);
            q.description = stripCodicons(q.description || q.detail); // We only support description, not detail.
            return {
                ...q,
                detail: undefined,
                original: q
            };
        });
    }
    public async handleQuickPick(
        item: QuickPickItem & { original: QuickPickItem & { command?: JupyterServerCommand } },
        back: boolean
    ): Promise<string | 'back' | undefined> {
        if (!this.provider.handleQuickPick) {
            return;
        }
        if ('original' in item && item.original) {
            return this.provider.handleQuickPick(item.original, back);
        }
        return this.provider.handleQuickPick(item, back);
    }

    public async getServerUri(handle: string, doNotPromptForAuthInfo?: boolean): Promise<IJupyterServerUri> {
        const provider = this.provider as IInternalJupyterUriProvider;
        if (doNotPromptForAuthInfo && this.id.startsWith('_builtin') && provider.getServerUriWithoutAuthInfo) {
            return provider.getServerUriWithoutAuthInfo(handle);
        }
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

export async function getJupyterDisplayName(
    serverHandle: JupyterServerProviderHandle,
    jupyterUriProviderRegistration: IJupyterServerProviderRegistry,
    defaultValue?: string
) {
    const collection = jupyterUriProviderRegistration.jupyterCollections.find(
        (c) => c.extensionId === serverHandle.extensionId && c.id === serverHandle.id
    );
    return collection?.label || defaultValue || `${serverHandle.id}:${serverHandle.handle}`;
}
