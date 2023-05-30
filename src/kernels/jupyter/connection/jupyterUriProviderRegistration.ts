// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Event, EventEmitter, Memento, QuickPickItem, Uri } from 'vscode';
import { JVSC_EXTENSION_ID, Telemetry } from '../../../platform/common/constants';

import {
    GLOBAL_MEMENTO,
    IDisposable,
    IDisposableRegistry,
    IExtensionContext,
    IExtensions,
    IMemento
} from '../../../platform/common/types';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import * as localize from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { InvalidRemoteJupyterServerUriHandleError } from '../../errors/invalidRemoteJupyterServerUriHandleError';
import {
    IJupyterServerUri,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';
import { sendTelemetryEvent } from '../../../telemetry';
import { traceError } from '../../../platform/logging';
import { isBuiltInJupyterServerProvider } from '../helpers';
import { IFileSystem } from '../../../platform/common/platform/types';
import { jupyterServerHandleToString } from '../jupyterUtils';

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
    private readonly displayNameCache: DisplayNameCache;
    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IExtensionContext) context: IExtensionContext,
        @inject(IFileSystem) fs: IFileSystem
    ) {
        disposables.push(this._onProvidersChanged);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.displayNameCache = new DisplayNameCache(context, fs);
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
    public async getDisplayName(serverHandle: JupyterServerProviderHandle): Promise<string> {
        const cached = await this.displayNameCache.get(serverHandle);
        if (cached) {
            return cached;
        }
        const info = await this.getJupyterServerUri(serverHandle);
        this.displayNameCache.add(serverHandle, info.displayName).catch(noop);
        return info.displayName;
    }
    public async getJupyterServerUri(serverHandle: JupyterServerProviderHandle): Promise<IJupyterServerUri> {
        await this.loadOtherExtensions();

        const providerPromise = this.providers.get(serverHandle.id)?.[0];
        if (!providerPromise) {
            traceError(
                `${localize.DataScience.unknownServerUri}. Provider Id=${serverHandle.id} and handle=${serverHandle.handle}`
            );
            throw new Error(localize.DataScience.unknownServerUri);
        }
        const provider = await providerPromise;
        if (provider.getHandles) {
            const handles = await provider.getHandles();
            if (!handles.includes(serverHandle.handle)) {
                const extensionId = this.providerExtensionMapping.get(serverHandle.id)!;
                throw new InvalidRemoteJupyterServerUriHandleError(serverHandle, extensionId);
            }
        }
        return provider.getServerUri(serverHandle.handle);
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
        const extensionId = isBuiltInJupyterServerProvider(provider.id)
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
    public readonly getHandles?: () => Promise<string[]>;
    public readonly removeHandle?: (handle: string) => Promise<void>;

    constructor(
        private readonly provider: IJupyterUriProvider,
        public readonly extensionId: string,
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

    public async getServerUri(handle: string): Promise<IJupyterServerUri> {
        const server = await this.provider.getServerUri(handle);
        if (!isBuiltInJupyterServerProvider(this.id) && !handlesForWhichWeHaveSentTelemetry.has(handle)) {
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

// 500 is pretty small, but lets create a small file, users can never have more than 500 servers.
// Thats ridiculous, they'd only be using a few at most..
const MAX_NUMBER__OF_DISPLAY_NAMES_TO_CACHE = 100;

class DisplayNameCache {
    private displayNames: Record<string, string> = {};
    private previousPromise = Promise.resolve();
    private initialized: boolean;
    private readonly storageFile: Uri;
    constructor(
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {
        this.storageFile = Uri.joinPath(this.context.globalStorageUri, 'remoteServerDisplayNames.json');
    }

    public async get(handle: JupyterServerProviderHandle): Promise<string | undefined> {
        await this.initialize();
        return this.displayNames[jupyterServerHandleToString(handle)];
    }
    public async add(handle: JupyterServerProviderHandle, displayName: string): Promise<void> {
        const id = jupyterServerHandleToString(handle);
        if (this.displayNames[id] === displayName) {
            return;
        }
        await this.initialize();
        this.displayNames[id] = displayName;
        this.previousPromise = this.previousPromise.finally(async () => {
            if (!(await this.fs.exists(this.context.globalStorageUri))) {
                await this.fs.createDirectory(this.context.globalStorageUri);
            }
            const currentContents: Record<string, string> = {};
            if (await this.fs.exists(this.storageFile)) {
                const contents = await this.fs.readFile(this.storageFile);
                Object.assign(currentContents, JSON.parse(contents));
            }
            currentContents[id] = displayName;
            await this.fs.writeFile(this.storageFile, JSON.stringify(currentContents));
        });
        await this.previousPromise;
    }
    private async initialize() {
        if (this.initialized) {
            return;
        }
        if (await this.fs.exists(this.storageFile)) {
            const contents = await this.fs.readFile(this.storageFile);
            Object.assign(this.displayNames, JSON.parse(contents));
            if (Object.keys(this.displayNames).length > MAX_NUMBER__OF_DISPLAY_NAMES_TO_CACHE) {
                // Too many entries, clear them all.
                this.displayNames = {};
                await this.clear();
            }
        }
        this.initialized = true;
    }

    private async clear(): Promise<void> {
        this.displayNames = {};
        this.previousPromise = this.previousPromise.finally(async () => {
            if (!(await this.fs.exists(this.context.globalStorageUri))) {
                return;
            }
            await this.fs.delete(this.storageFile);
        });
        await this.previousPromise;
    }
}
