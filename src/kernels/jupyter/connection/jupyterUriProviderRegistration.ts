// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Disposable, Event, EventEmitter, Memento, QuickPickItem, Uri } from 'vscode';
import { JVSC_EXTENSION_ID, Telemetry } from '../../../platform/common/constants';
import {
    GLOBAL_MEMENTO,
    IDisposableRegistry,
    IExtensionContext,
    IExtensions,
    IMemento
} from '../../../platform/common/types';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import * as localize from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { InvalidRemoteJupyterServerUriHandleError } from '../../errors/invalidRemoteJupyterServerUriHandleError';
import { IInternalJupyterUriProvider, IJupyterUriProviderRegistration } from '../types';
import { Disposables } from '../../../platform/common/utils';
import { JupyterServerProviderHandle } from '../types';
import { sendTelemetryEvent } from '../../../telemetry';
import { traceError } from '../../../platform/logging';
import { isBuiltInJupyterServerProvider } from '../helpers';
import { IFileSystem } from '../../../platform/common/platform/types';
import { jupyterServerHandleToString } from '../jupyterUtils';
import { IJupyterServerUri, IJupyterUriProvider } from '../../../api';

const REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY = 'REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY';

/**
 * Handles registration of 3rd party URI providers.
 */
@injectable()
export class JupyterUriProviderRegistration implements IJupyterUriProviderRegistration {
    private readonly _onProvidersChanged = new EventEmitter<void>();
    private loadedOtherExtensionsPromise: Promise<void> | undefined;
    private _providers = new Map<string, JupyterUriProviderWrapper>();
    private providerExtensionMapping = new Map<string, string>();
    public readonly onDidChangeProviders = this._onProvidersChanged.event;
    public get providers() {
        this.loadOtherExtensions().catch(noop);
        return Array.from(this._providers.values());
    }
    private readonly displayNameCache: DisplayNameCache;
    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IExtensionContext) context: IExtensionContext,
        @inject(IFileSystem) fs: IFileSystem
    ) {
        disposables.push(this._onProvidersChanged);
        disposables.push(new Disposable(() => this._providers.forEach((p) => p.dispose())));
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.displayNameCache = new DisplayNameCache(context, fs);
    }

    public async getProviders(): Promise<ReadonlyArray<IInternalJupyterUriProvider>> {
        await this.loadOtherExtensions();

        // Other extensions should have registered in their activate callback
        return Array.from(this.providers.values());
    }

    public async getProvider(id: string): Promise<IInternalJupyterUriProvider | undefined> {
        await this.loadOtherExtensions();
        if (!this._providers.has(id)) {
            debugger;
        }
        return this._providers.get(id);
    }

    public registerProvider(provider: IJupyterUriProvider, extensionId: string) {
        if (!this._providers.has(provider.id)) {
            this.updateRegistrationInfo(provider.id, extensionId).catch(noop);
            this._providers.set(
                provider.id,
                // eslint-disable-next-line @typescript-eslint/no-use-before-define
                new JupyterUriProviderWrapper(provider, extensionId)
            );
        } else {
            throw new Error(`IJupyterUriProvider already exists with id ${provider.id}`);
        }
        this._onProvidersChanged.fire();

        return {
            dispose: () => {
                this._providers.get(provider.id)?.dispose();
                this._providers.delete(provider.id);
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

        const provider = this._providers.get(serverHandle.id);
        if (!provider) {
            traceError(
                `${localize.DataScience.unknownServerUri}. Provider Id=${serverHandle.id} and handle=${serverHandle.handle}`
            );
            throw new Error(localize.DataScience.unknownServerUri);
        }
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

        const extensions = this.extensions.all
            .filter((e) => e.packageJSON?.contributes?.pythonRemoteServerProvider || extensionIds.has(e.id))
            .filter((e) => e.id !== JVSC_EXTENSION_ID);
        await Promise.all(extensions.map((e) => (e.isActive ? Promise.resolve() : e.activate().then(noop, noop))));
    }

    // /**
    //  * Ideally we should activate just the extension that registered the provider.
    //  * Debt, we should fix this.
    //  */
    // private async loadProviderExtension(providerId: string): Promise<void> {
    //     this.loadOtherExtensions().catch(noop);
    //     this.loadExistingProviderExtensionMapping();
    //     const extensionId = this.providerExtensionMapping.get(providerId);
    //     if (!extensionId) {
    //         return;
    //     }

    //     const extension = this.extensions.getExtension(extensionId);
    //     if (extension) {
    //         if (!extension.isActive) {
    //             await extension.activate().then(noop, noop);
    //         }
    //     }
    // }

    @swallowExceptions()
    private async updateRegistrationInfo(providerId: string, extensionId: string): Promise<void> {
        this.loadExistingProviderExtensionMapping();
        this.providerExtensionMapping.set(providerId, extensionId);

        const newList: { extensionId: string; providerId: string }[] = [];
        this.providerExtensionMapping.forEach((extensionId, providerId) => {
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
class JupyterUriProviderWrapper extends Disposables implements IInternalJupyterUriProvider {
    public readonly id: string;
    public readonly displayName: string | undefined;
    public readonly detail: string | undefined;

    public readonly onDidChangeHandles?: Event<void>;
    public readonly getHandles?: () => Promise<string[]>;
    public readonly removeHandle?: (handle: string) => Promise<void>;

    constructor(private readonly provider: IJupyterUriProvider, public extensionId: string) {
        super();
        this.id = this.provider.id;
        this.displayName = this.provider.displayName;
        this.detail = this.provider.detail;

        if (provider.onDidChangeHandles) {
            const _onDidChangeHandles = new EventEmitter<void>();
            this.onDidChangeHandles = _onDidChangeHandles.event.bind(this);

            this.disposables.push(_onDidChangeHandles);
            this.disposables.push(provider.onDidChangeHandles(() => _onDidChangeHandles.fire()));
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
