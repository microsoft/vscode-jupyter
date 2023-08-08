// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Disposable, EventEmitter, Memento, QuickPickItem } from 'vscode';
import { JVSC_EXTENSION_ID, Telemetry } from '../../../platform/common/constants';
import { GLOBAL_MEMENTO, IDisposableRegistry, IExtensions, IMemento } from '../../../platform/common/types';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import * as localize from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { InvalidRemoteJupyterServerUriHandleError } from '../../errors/invalidRemoteJupyterServerUriHandleError';
import {
    IInternalJupyterUriProvider,
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';
import { sendTelemetryEvent } from '../../../telemetry';
import { traceError } from '../../../platform/logging';
import { IJupyterServerUri, IJupyterUriProvider } from '../../../api.unstable';
import { Disposables } from '../../../platform/common/utils';
import { IServiceContainer } from '../../../platform/ioc/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';

export const REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY = 'REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY';
function getProviderId(extensionId: string, id: string) {
    return `${extensionId}-${id}`;
}
/**
 * Handles registration of 3rd party URI providers.
 */
@injectable()
export class JupyterUriProviderRegistration
    extends Disposables
    implements IJupyterUriProviderRegistration, IExtensionSyncActivationService
{
    private readonly _onProvidersChanged = new EventEmitter<void>();
    private loadedOtherExtensionsPromise: Promise<void> | undefined;
    private _providers = new Map<string, JupyterUriProviderWrapper>();
    private extensionIdsThatHaveProviders = new Set<string>();
    public readonly onDidChangeProviders = this._onProvidersChanged.event;
    public get providers() {
        this.loadOtherExtensions().catch(noop);
        return Array.from(this._providers.values());
    }
    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer
    ) {
        super();
        disposables.push(this);
        this.disposables.push(this._onProvidersChanged);
        this.disposables.push(new Disposable(() => this._providers.forEach((p) => p.dispose())));
    }

    public activate(): void {
        const serverStorage = this.serviceContainer.get<IJupyterServerUriStorage>(IJupyterServerUriStorage);
        this.disposables.push(serverStorage.onDidRemove(this.onDidRemoveServer, this));
    }
    public async getProvider(extensionId: string, id: string): Promise<IInternalJupyterUriProvider | undefined> {
        this.loadOtherExtensions().catch(noop);
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
                this._providers.get(id)?.dispose();
                this._providers.delete(id);
                this._onProvidersChanged.fire();
            }
        };
        this.disposables.push(disposable);
        return disposable;
    }
    public async getJupyterServerUri(
        providerHandle: JupyterServerProviderHandle,
        doNotPromptForAuthInfo?: boolean
    ): Promise<IJupyterServerUri> {
        await this.loadExtension(providerHandle.extensionId, providerHandle.id);
        const id = getProviderId(providerHandle.extensionId, providerHandle.id);
        const provider = this._providers.get(id);
        if (!provider) {
            throw new Error(
                `${localize.DataScience.unknownServerUri}. Provider Id=${id} and handle=${providerHandle.handle}`
            );
        }
        if (provider.getHandles) {
            const handles = await provider.getHandles();
            if (!handles.includes(providerHandle.handle)) {
                throw new InvalidRemoteJupyterServerUriHandleError(providerHandle);
            }
        }
        return provider.getServerUri(providerHandle.handle, doNotPromptForAuthInfo);
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
    private onDidRemoveServer(e: IJupyterServerUriEntry[]) {
        Promise.all(
            e.map(async (s) => {
                const provider = await this.getProvider(s.provider.extensionId, s.provider.id).catch(noop);
                if (!provider || !provider.removeHandle) {
                    return;
                }
                await provider.removeHandle(s.provider.handle).catch(noop);
            })
        ).catch(noop);
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
class JupyterUriProviderWrapper extends Disposables implements IInternalJupyterUriProvider {
    public readonly id: string;
    public get displayName() {
        return this.provider.displayName;
    }
    public get detail() {
        return this.provider.detail;
    }

    public get onDidChangeHandles() {
        return this.provider.onDidChangeHandles;
    }
    public readonly getHandles?: () => Promise<string[]>;
    public readonly removeHandle?: (handle: string) => Promise<void>;

    constructor(
        private readonly provider: IJupyterUriProvider,
        public extensionId: string
    ) {
        super();
        this.id = this.provider.id;

        if (provider.getHandles) {
            this.getHandles = async () => provider.getHandles!();
        }

        if (provider.removeHandle) {
            this.removeHandle = (handle: string) => provider.removeHandle!(handle);
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
    public async handleQuickPick(item: QuickPickItem, back: boolean): Promise<string | 'back' | undefined> {
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
    jupyterUriProviderRegistration: IJupyterUriProviderRegistration,
    defaultValue?: string
) {
    let displayName: string | undefined = '';
    const provider = await jupyterUriProviderRegistration
        .getProvider(serverHandle.extensionId, serverHandle.id)
        .catch(noop);
    if (provider) {
        const server = provider.getServerUriWithoutAuthInfo
            ? await provider.getServerUriWithoutAuthInfo(serverHandle.handle)
            : await provider.getServerUri(serverHandle.handle);
        displayName = server.displayName;
    }
    defaultValue = defaultValue || `${serverHandle.id}:${serverHandle.handle}`;
    return displayName || defaultValue;
}
