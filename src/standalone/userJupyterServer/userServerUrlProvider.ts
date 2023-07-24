// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { inject, injectable, named, optional } from 'inversify';
import uuid from 'uuid/v4';
import {
    CancellationError,
    Disposable,
    Event,
    EventEmitter,
    Memento,
    QuickInputButtons,
    QuickPickItem,
    Uri
} from 'vscode';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import {
    IJupyterServerUriStorage,
    IInternalJupyterUriProvider,
    IJupyterUriProviderRegistration,
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator
} from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import {
    IApplicationShell,
    IClipboard,
    ICommandManager,
    IEncryptedStorage
} from '../../platform/common/application/types';
import {
    Identifiers,
    JVSC_EXTENSION_ID,
    Settings,
    UserJupyterServerPickerProviderId
} from '../../platform/common/constants';
import {
    GLOBAL_MEMENTO,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    IExtensionContext,
    IMemento,
    IsWebExtension
} from '../../platform/common/types';
import { Common, DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { traceError, traceWarning } from '../../platform/logging';
import { JupyterPasswordConnect } from './jupyterPasswordConnect';
import { IJupyterServerUri } from '../../api.unstable';
import { IMultiStepInputFactory, InputFlowAction } from '../../platform/common/utils/multiStepInput';
import { JupyterSelfCertsError } from '../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../platform/errors/jupyterSelfCertsExpiredError';
import { Deferred, createDeferred } from '../../platform/common/utils/async';
import { IFileSystem } from '../../platform/common/platform/types';
import { RemoteKernelSpecCacheFileName } from '../../kernels/jupyter/constants';
import { disposeAllDisposables } from '../../platform/common/helpers';

export const UserJupyterServerUriListKey = 'user-jupyter-server-uri-list';
export const UserJupyterServerUriListKeyV2 = 'user-jupyter-server-uri-list-version2';
export const UserJupyterServerUriListMementoKey = '_builtin.jupyterServerUrlProvider.uriList';
const GlobalStateUserAllowsInsecureConnections = 'DataScienceAllowInsecureConnections';

@injectable()
export class UserJupyterServerUrlProvider
    implements IExtensionSyncActivationService, IDisposable, IInternalJupyterUriProvider
{
    readonly id: string = UserJupyterServerPickerProviderId;
    public readonly extensionId: string = JVSC_EXTENSION_ID;
    readonly displayName: string = DataScience.UserJupyterServerUrlProviderDisplayName;
    readonly detail: string = DataScience.UserJupyterServerUrlProviderDetail;
    private _onDidChangeHandles = new EventEmitter<void>();
    onDidChangeHandles: Event<void> = this._onDidChangeHandles.event;
    private _onDidChangeQuickPickEntryItems = new EventEmitter<void>();
    onDidChangeQuickPickEntryItems = this._onDidChangeQuickPickEntryItems.event;
    private _cachedServerInfoInitialized: Promise<void> | undefined;
    private _localDisposables: Disposable[] = [];
    private readonly passwordConnect: JupyterPasswordConnect;
    public readonly oldStorage: OldStorage;
    public readonly newStorage: NewStorage;
    private migratedOldServers?: Promise<unknown>;
    private displayNamesOfHandles = new Map<string, string>();
    constructor(
        @inject(IClipboard) private readonly clipboard: IClipboard,
        @inject(IJupyterUriProviderRegistration)
        private readonly uriProviderRegistration: IJupyterUriProviderRegistration,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IsWebExtension) private readonly isWebExtension: boolean,
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IMultiStepInputFactory) multiStepFactory: IMultiStepInputFactory,
        @inject(IAsyncDisposableRegistry) asyncDisposableRegistry: IAsyncDisposableRegistry,
        @inject(ICommandManager) private readonly commands: ICommandManager,
        @inject(IJupyterRequestAgentCreator)
        @optional()
        agentCreator: IJupyterRequestAgentCreator | undefined,
        @inject(IJupyterRequestCreator) requestCreator: IJupyterRequestCreator,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {
        this.disposables.push(this);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.oldStorage = new OldStorage(encryptedStorage, globalMemento);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.newStorage = new NewStorage(encryptedStorage);
        this.passwordConnect = new JupyterPasswordConnect(
            applicationShell,
            multiStepFactory,
            asyncDisposableRegistry,
            configService,
            agentCreator,
            requestCreator,
            serverUriStorage,
            disposables
        );
    }

    activate() {
        this._localDisposables.push(this.uriProviderRegistration.registerProvider(this, JVSC_EXTENSION_ID));

        this._localDisposables.push(
            this.commands.registerCommand('dataScience.ClearUserProviderJupyterServerCache', async () => {
                await Promise.all([
                    this.oldStorage.clear().catch(noop),
                    this.newStorage.clear().catch(noop),
                    this.fs
                        .delete(Uri.joinPath(this.context.globalStorageUri, RemoteKernelSpecCacheFileName))
                        .catch(noop)
                ]);
                this._onDidChangeHandles.fire();
            })
        );
        this.migrateOldServers().catch(noop);
    }
    private migrateOldServers() {
        if (!this.migratedOldServers) {
            this.migratedOldServers = this.oldStorage
                .getServers()
                .then(async (servers) => {
                    await this.newStorage.migrate(servers);
                    // List is in the global memento, URIs are in encrypted storage
                    const indexes = this.globalMemento.get<{ index: number; time: number }[]>(
                        Settings.JupyterServerUriList
                    );
                    if (!Array.isArray(indexes) || indexes.length === 0) {
                        return;
                    }

                    // Pull out the \r separated URI list (\r is an invalid URI character)
                    const blob = await this.encryptedStorage.retrieve(
                        Settings.JupyterServerRemoteLaunchService,
                        Settings.JupyterServerRemoteLaunchUriListKey
                    );
                    if (!blob) {
                        return;
                    }
                    // Make sure same length
                    const migratedServers: {
                        time: number;
                        handle: string;
                        uri: string;
                        serverInfo: IJupyterServerUri;
                    }[] = [];

                    const split = blob.split(Settings.JupyterServerRemoteLaunchUriSeparator);
                    split.slice(0, Math.min(split.length, indexes.length)).forEach((item, index) => {
                        try {
                            const uriAndDisplayName = item.split(Settings.JupyterServerRemoteLaunchNameSeparator);
                            const uri = uriAndDisplayName[0];
                            // Old code (we may have stored a bogus url in the past).
                            if (uri === Settings.JupyterServerLocalLaunch) {
                                return;
                            }
                            if (uri.startsWith(Identifiers.REMOTE_URI)) {
                                return;
                            }
                            const serverInfo = parseUri(uri, uriAndDisplayName[1] || uri);
                            if (serverInfo && servers.every((s) => s.uri !== uri)) {
                                // We have a saved Url.
                                const handle = uuid();
                                migratedServers.push({
                                    time: indexes[index].time,
                                    handle,
                                    uri,
                                    serverInfo
                                });
                            }
                        } catch {
                            // Ignore errors.
                        }
                    });

                    if (migratedServers.length > 0) {
                        // Ensure we update the storage with the new items and new format.
                        await Promise.all(
                            migratedServers.map(async (server) => {
                                try {
                                    await this.addNewServer(server);
                                    await this.serverUriStorage.add(
                                        { id: this.id, handle: server.handle, extensionId: JVSC_EXTENSION_ID },
                                        { time: server.time, displayName: server.serverInfo.displayName }
                                    );
                                } catch {
                                    //
                                }
                            })
                        );
                    }
                })
                .catch(noop);
        }
        return this.migratedOldServers;
    }
    private async initializeServers(): Promise<void> {
        if (this._cachedServerInfoInitialized) {
            return this._cachedServerInfoInitialized;
        }

        this._cachedServerInfoInitialized = new Promise<void>(async (resolve) => {
            await Promise.all([this.migrateOldServers().catch(noop), this.newStorage.migrationDone]);
            resolve();
        });

        return this._cachedServerInfoInitialized;
    }

    getQuickPickEntryItems(): (QuickPickItem & { default?: boolean })[] {
        return (this.quickPickItem ? [this.quickPickItem] : []).concat([
            {
                default: true,
                label: DataScience.jupyterSelectURIPrompt,
                detail: DataScience.jupyterSelectURINewDetail
            }
        ]);
    }
    private quickPickItem?: QuickPickItem & { default?: boolean; url?: string };
    onBeforeQuickPickOpen(): void {
        this.quickPickItem = undefined;
    }
    onDidChangeValue(value: string): void {
        if (!value.length) {
            this.quickPickItem = undefined;
            this._onDidChangeQuickPickEntryItems.fire();
            return;
        }
        try {
            const uri = new URL(value);
            if (!['http:', 'https:'].includes(uri.protocol.toLowerCase())) {
                return;
            }
            if (!uri.port && !uri.pathname) {
                return;
            }
            this.quickPickItem = { label: `Connect to Jupyter Server on ${value}`, url: value.trim() };
            this._onDidChangeQuickPickEntryItems.fire();
            return;
        } catch {
            if (this.quickPickItem) {
                this.quickPickItem = undefined;
                this._onDidChangeQuickPickEntryItems.fire();
            }
        }
    }
    async handleQuickPick(item: QuickPickItem, _backEnabled: boolean): Promise<string | undefined> {
        await this.initializeServers();
        type Steps =
            | 'Get Url'
            | 'Check Passwords'
            | 'Check Insecure Connections'
            | 'Verify Connection'
            | 'Get Display Name';

        const disposables: Disposable[] = [];
        let jupyterServerUri: IJupyterServerUri = { baseUrl: '', displayName: '', token: '' };
        let validationErrorMessage = '';
        let requiresPassword = false;
        let isInsecureConnection = false;
        let handle: string;
        let url = item === this.quickPickItem ? this.quickPickItem.url || '' : '';
        let nextStep: Steps = 'Get Url';
        let previousStep: Steps | undefined = 'Get Url';
        if (url) {
            const initialVerification = this.parseUserUriAndGetValidationError(url);
            if (typeof initialVerification.validationError === 'string') {
                validationErrorMessage = initialVerification.validationError;
                nextStep = 'Get Url';
            } else {
                jupyterServerUri = initialVerification.jupyterServerUri;
                nextStep = 'Check Passwords';
            }
        }
        try {
            while (true) {
                try {
                    handle = uuid();
                    if (nextStep === 'Get Url') {
                        nextStep = 'Check Passwords';
                        previousStep = undefined;
                        const errorMessage = validationErrorMessage;
                        validationErrorMessage = '';
                        const result = await this.getUrl(url, errorMessage, disposables);
                        jupyterServerUri = result.jupyterServerUri;
                        url = result.url;
                    }

                    if (nextStep === 'Check Passwords') {
                        nextStep = 'Check Insecure Connections';
                        previousStep = 'Get Url';

                        try {
                            const errorMessage = validationErrorMessage;
                            validationErrorMessage = '';
                            const result = await this.passwordConnect.getPasswordConnectionInfo({
                                url: jupyterServerUri.baseUrl,
                                isTokenEmpty: jupyterServerUri.token.length === 0,
                                handle,
                                displayName: jupyterServerUri.displayName,
                                validationErrorMessage: errorMessage,
                                disposables
                            });
                            requiresPassword = result.requiresPassword;
                            jupyterServerUri.authorizationHeader = result.requestHeaders;
                        } catch (err) {
                            if (
                                err instanceof CancellationError ||
                                err == InputFlowAction.back ||
                                err == InputFlowAction.cancel
                            ) {
                                throw err;
                            } else if (JupyterSelfCertsError.isSelfCertsError(err)) {
                                // We can skip this for now, as this will get verified again
                                // First we need to check with user whether to allow insecure connections and untrusted certs.
                            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                                // We can skip this for now, as this will get verified again
                                // First we need to check with user whether to allow insecure connections and untrusted certs.
                            } else {
                                // Return the general connection error to show in the validation box
                                // Replace any Urls in the error message with markdown link.
                                const urlRegex = /(https?:\/\/[^\s]+)/g;
                                const errorMessage = (err.message || err.toString()).replace(
                                    urlRegex,
                                    (url: string) => `[${url}](${url})`
                                );
                                validationErrorMessage = (
                                    this.isWebExtension
                                        ? DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb
                                        : DataScience.remoteJupyterConnectionFailedWithoutServerWithError
                                )(errorMessage);
                                nextStep = 'Get Url';
                                continue;
                            }
                        }
                    }

                    if (nextStep === 'Check Insecure Connections') {
                        // If we do not have any auth header information & there is no token & no password,
                        // & this is HTTP then this is an insecure server
                        // & we need to ask the user for consent to use this insecure server.
                        nextStep = 'Verify Connection';
                        previousStep =
                            requiresPassword && jupyterServerUri.token.length === 0 ? 'Check Passwords' : 'Get Url';
                        if (
                            !requiresPassword &&
                            jupyterServerUri.token.length === 0 &&
                            new URL(jupyterServerUri.baseUrl).protocol.toLowerCase() === 'http:'
                        ) {
                            isInsecureConnection = true;
                            const proceed = await this.secureConnectionCheck(disposables);
                            if (!proceed) {
                                return;
                            }
                        }
                    }

                    if (nextStep === 'Verify Connection') {
                        try {
                            nextStep = 'Get Display Name';
                            await this.jupyterConnection.validateRemoteUri(
                                { id: this.id, handle, extensionId: JVSC_EXTENSION_ID },
                                jupyterServerUri,
                                true
                            );
                        } catch (err) {
                            traceWarning('Uri verification error', err);
                            if (JupyterSelfCertsError.isSelfCertsError(err)) {
                                validationErrorMessage = DataScience.jupyterSelfCertFailErrorMessageOnly;
                                nextStep = 'Get Url';
                                continue;
                            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                                validationErrorMessage = DataScience.jupyterSelfCertExpiredErrorMessageOnly;
                                nextStep = 'Get Url';
                                continue;
                            } else if (requiresPassword && jupyterServerUri.token.length === 0) {
                                validationErrorMessage = DataScience.passwordFailure;
                                nextStep = 'Check Passwords';
                                continue;
                            } else {
                                // Return the general connection error to show in the validation box
                                // Replace any Urls in the error message with markdown link.
                                const urlRegex = /(https?:\/\/[^\s]+)/g;
                                const errorMessage = (err.message || err.toString()).replace(
                                    urlRegex,
                                    (url: string) => `[${url}](${url})`
                                );
                                validationErrorMessage = (
                                    this.isWebExtension || true
                                        ? DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb
                                        : DataScience.remoteJupyterConnectionFailedWithoutServerWithError
                                )(errorMessage);
                                nextStep = 'Get Url';
                                continue;
                            }
                        }
                    }

                    if (nextStep === 'Get Display Name') {
                        previousStep = isInsecureConnection
                            ? 'Check Insecure Connections'
                            : requiresPassword && jupyterServerUri.token.length === 0
                            ? 'Check Passwords'
                            : 'Get Url';
                        jupyterServerUri.displayName = await this.getDisplayName(
                            handle,
                            jupyterServerUri.displayName || new URL(jupyterServerUri.baseUrl).hostname,
                            disposables
                        );
                        break;
                    }
                } catch (ex) {
                    if (ex instanceof CancellationError || ex === InputFlowAction.cancel) {
                        // This means exit all of this, & do not event go back
                        return;
                    }
                    if (ex === InputFlowAction.back) {
                        if (!previousStep) {
                            // Go back to the beginning of this workflow, ie. back to calling code.
                            return;
                        }
                        nextStep = previousStep;
                        continue;
                    }

                    throw ex;
                }
            }

            await this.addNewServer({
                handle,
                uri: url,
                serverInfo: jupyterServerUri
            });
            return handle;
        } finally {
            disposeAllDisposables(disposables);
        }
    }
    private async getDisplayName(handle: string, defaultValue: string, disposables: IDisposable[]): Promise<string> {
        const input = this.applicationShell.createInputBox();
        disposables.push(input);
        input.ignoreFocusOut = true;
        input.title = DataScience.jupyterRenameServer;
        input.value = defaultValue;
        input.buttons = [QuickInputButtons.Back];
        input.show();
        const deferred = createDeferred<string>();
        disposables.push(input.onDidHide(() => deferred.reject(InputFlowAction.cancel)));
        input.onDidTriggerButton(
            (e) => {
                if (e === QuickInputButtons.Back) {
                    deferred.reject(InputFlowAction.back);
                }
            },
            this,
            disposables
        );
        input.onDidAccept(
            () => {
                const displayName = input.value.trim() || defaultValue;
                this.displayNamesOfHandles.set(handle, displayName);
                deferred.resolve(displayName);
            },
            this,
            disposables
        );
        return deferred.promise;
    }
    async getUrl(
        initialValue: string,
        initialErrorMessage: string = '',
        disposables: Disposable[]
    ): Promise<{ url: string; jupyterServerUri: IJupyterServerUri }> {
        if (!initialValue) {
            try {
                const text = await this.clipboard.readText().catch(() => '');
                const parsedUri = Uri.parse(text.trim(), true);
                // Only display http/https uris.
                initialValue = text && parsedUri && parsedUri.scheme.toLowerCase().startsWith('http') ? text : '';
            } catch {
                // We can ignore errors.
            }
        }

        // Ask the user to enter a URI to connect to.
        const input = this.applicationShell.createInputBox();
        disposables.push(input);
        input.title = DataScience.jupyterSelectURIPrompt;
        input.value = initialValue;
        input.validationMessage = initialErrorMessage;
        input.buttons = [QuickInputButtons.Back];
        input.ignoreFocusOut = true;
        input.show();

        const deferred = createDeferred<{ url: string; jupyterServerUri: IJupyterServerUri }>();
        input.onDidChangeValue(() => (input.validationMessage = ''), this, disposables);
        input.onDidHide(() => deferred.reject(InputFlowAction.cancel), this, disposables);
        input.onDidTriggerButton(
            (item) => {
                if (item === QuickInputButtons.Back) {
                    deferred.reject(InputFlowAction.back);
                }
            },
            this,
            disposables
        );

        input.onDidAccept(
            async () => {
                const result = this.parseUserUriAndGetValidationError(input.value);
                if (typeof result.validationError === 'string') {
                    input.validationMessage = result.validationError;
                    return;
                }

                deferred.resolve(result);
            },
            this,
            disposables
        );
        return deferred.promise;
    }

    private parseUserUriAndGetValidationError(
        value: string
    ): { validationError: string } | { jupyterServerUri: IJupyterServerUri; url: string; validationError: undefined } {
        // If it ends with /lab? or /lab or /tree? or /tree, then remove that part.
        const uri = value.trim().replace(/\/(lab|tree)(\??)$/, '');
        const jupyterServerUri = parseUri(uri, '');
        if (!jupyterServerUri) {
            return { validationError: DataScience.jupyterSelectURIInvalidURI };
        }
        if (!uri.toLowerCase().startsWith('http:') && !uri.toLowerCase().startsWith('https:')) {
            return { validationError: DataScience.jupyterSelectURIMustBeHttpOrHttps };
        }
        return { jupyterServerUri, url: uri, validationError: undefined };
    }

    /**
     * Check if our server connection is considered secure. If it is not, ask the user if they want to connect
     */
    private async secureConnectionCheck(disposables: IDisposable[]): Promise<boolean> {
        if (this.globalMemento.get(GlobalStateUserAllowsInsecureConnections, false)) {
            return true;
        }

        const input = this.applicationShell.createQuickPick();
        disposables.push(input);
        input.canSelectMany = false;
        input.ignoreFocusOut = true;
        input.title = DataScience.insecureSessionMessage;
        input.buttons = [QuickInputButtons.Back];
        input.items = [{ label: Common.bannerLabelYes }, { label: Common.bannerLabelNo }];
        input.show();
        const deferred = createDeferred<boolean>();
        disposables.push(input.onDidHide(() => deferred.reject(InputFlowAction.cancel)));
        input.onDidTriggerButton(
            (e) => {
                if (e === QuickInputButtons.Back) {
                    deferred.reject(InputFlowAction.back);
                }
            },
            this,
            disposables
        );
        input.onDidAccept(
            () => deferred.resolve(input.selectedItems.some((e) => e.label === Common.bannerLabelYes)),
            this,
            disposables
        );
        return deferred.promise;
    }
    private async addNewServer(server: { handle: string; uri: string; serverInfo: IJupyterServerUri }) {
        await this.newStorage.add(server);
        this._onDidChangeHandles.fire();
    }
    async getServerUriWithoutAuthInfo(handle: string): Promise<IJupyterServerUri> {
        await this.initializeServers();
        const servers = await this.newStorage.getServers();
        const server = servers.find((s) => s.handle === handle);
        if (!server) {
            throw new Error('Server not found');
        }

        // Hacky due to the way display names are stored in uri storage.
        // Should be cleaned up later.
        const displayName = this.displayNamesOfHandles.get(handle);
        if (displayName) {
            server.serverInfo.displayName = displayName;
        }
        return server.serverInfo;
    }
    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        await this.initializeServers();
        const servers = await this.newStorage.getServers();
        const server = servers.find((s) => s.handle === handle);
        if (!server) {
            throw new Error('Server not found');
        }

        // Hacky due to the way display names are stored in uri storage.
        // Should be cleaned up later.
        const displayName = this.displayNamesOfHandles.get(handle);
        if (displayName) {
            server.serverInfo.displayName = displayName;
        }

        const passwordResult = await this.passwordConnect.getPasswordConnectionInfo({
            url: server.serverInfo.baseUrl,
            isTokenEmpty: server.serverInfo.token.length === 0,
            displayName: server.serverInfo.displayName,
            handle
        });
        return Object.assign({}, server.serverInfo, {
            authorizationHeader: passwordResult.requestHeaders || server.serverInfo.authorizationHeader
        });
    }
    async getHandles(): Promise<string[]> {
        await this.initializeServers();
        const servers = await this.newStorage.getServers();
        return servers.map((s) => s.handle);
    }

    async removeHandle(handle: string): Promise<void> {
        await this.initializeServers();
        await this.newStorage.remove(handle);
        this._onDidChangeHandles.fire();
    }
    dispose(): void {
        this._localDisposables.forEach((d) => d.dispose());
    }
}

function parseUri(uri: string, displayName?: string): IJupyterServerUri | undefined {
    // This is a url that we crafted. It's not a valid Jupyter Server Url.
    if (uri.startsWith(Identifiers.REMOTE_URI)) {
        return;
    }
    try {
        const url = new URL(uri);

        // Special case for URI's ending with 'lab'. Remove this from the URI. This is not
        // the location for connecting to jupyterlab
        const baseUrl = `${url.protocol}//${url.host}${url.pathname === '/lab' ? '' : url.pathname}`;

        return {
            baseUrl: baseUrl,
            token: url.searchParams.get('token') || '',
            displayName: displayName || url.hostname
        };
    } catch (err) {
        traceError(`Failed to parse URI ${uri}`, err);
        // This should already have been parsed when set, so just throw if it's not right here
        return undefined;
    }
}

export class OldStorage {
    constructor(
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento
    ) {}

    public async getServers(): Promise<{ handle: string; uri: string; serverInfo: IJupyterServerUri }[]> {
        const serverList = this.globalMemento.get<{ index: number; handle: string }[]>(
            UserJupyterServerUriListMementoKey
        );

        const cache = await this.encryptedStorage.retrieve(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKey
        );

        if (!cache || !serverList || serverList.length === 0) {
            return [];
        }

        const encryptedList = cache.split(Settings.JupyterServerRemoteLaunchUriSeparator);
        if (encryptedList.length === 0 || encryptedList.length !== serverList.length) {
            traceError('Invalid server list, unable to retrieve server info');
            return [];
        }

        const servers: { handle: string; uri: string; serverInfo: IJupyterServerUri }[] = [];

        for (let i = 0; i < encryptedList.length; i += 1) {
            if (encryptedList[i].startsWith(Identifiers.REMOTE_URI)) {
                continue;
            }
            const serverInfo = parseUri(encryptedList[i]);
            if (!serverInfo) {
                traceError('Unable to parse server info', encryptedList[i]);
            } else {
                servers.push({
                    handle: serverList[i].handle,
                    uri: encryptedList[i],
                    serverInfo
                });
            }
        }
        return servers;
    }
    public async clear() {
        await this.encryptedStorage
            .store(Settings.JupyterServerRemoteLaunchService, UserJupyterServerUriListKey, '')
            .catch(noop);
        await this.globalMemento.update(UserJupyterServerUriListMementoKey, []).then(noop, noop);
    }
}

type StorageItem = {
    handle: string;
    uri: string;
};
function serverToStorageFormat(
    servers: {
        handle: string;
        uri: string;
        serverInfo: IJupyterServerUri;
    }[]
): StorageItem[] {
    return servers.map((s) => ({ handle: s.handle, uri: s.uri }));
}
function storageFormatToServers(items: StorageItem[]) {
    const servers: {
        handle: string;
        uri: string;
        serverInfo: IJupyterServerUri;
    }[] = [];
    items.forEach((s) => {
        const server = parseUri(s.uri);
        if (!server) {
            return;
        }
        servers.push({
            handle: s.handle,
            uri: s.uri,
            serverInfo: server
        });
    });
    return servers;
}

export class NewStorage {
    private readonly _migrationDone: Deferred<void>;
    private updatePromise = Promise.resolve();
    public get migrationDone(): Promise<void> {
        return this._migrationDone.promise;
    }
    constructor(@inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage) {
        this._migrationDone = createDeferred<void>();
    }

    public async migrate(
        servers: {
            handle: string;
            uri: string;
            serverInfo: IJupyterServerUri;
        }[]
    ) {
        const data = await this.encryptedStorage.retrieve(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2
        );
        if (typeof data === 'string') {
            // Already migrated once before.
            return this._migrationDone.resolve();
        }
        this.encryptedStorage
            .store(
                Settings.JupyterServerRemoteLaunchService,
                'user-jupyter-server-uri-list-v2', // Removed as this storage data is not in the best format.
                undefined
            )
            .catch(noop);
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2,
            JSON.stringify(servers)
        );
        this._migrationDone.resolve();
    }
    public async getServers(): Promise<{ handle: string; uri: string; serverInfo: IJupyterServerUri }[]> {
        const data = await this.encryptedStorage.retrieve(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2
        );
        if (!data || data === '[]') {
            return [];
        }
        try {
            return storageFormatToServers(JSON.parse(data));
        } catch {
            return [];
        }
    }

    public async add(server: { handle: string; uri: string; serverInfo: IJupyterServerUri }) {
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                const servers = (await this.getServers()).concat(server);
                await this.encryptedStorage.store(
                    Settings.JupyterServerRemoteLaunchService,
                    UserJupyterServerUriListKeyV2,
                    JSON.stringify(serverToStorageFormat(servers))
                );
            })
            .catch(noop));
    }
    public async remove(handle: string) {
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                const servers = (await this.getServers()).filter((s) => s.handle !== handle);
                return this.encryptedStorage.store(
                    Settings.JupyterServerRemoteLaunchService,
                    UserJupyterServerUriListKeyV2,
                    JSON.stringify(serverToStorageFormat(servers))
                );
            })
            .catch(noop));
    }
    public async clear() {
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                await this.encryptedStorage.store(
                    Settings.JupyterServerRemoteLaunchService,
                    UserJupyterServerUriListKeyV2,
                    undefined
                );
            })
            .catch(noop));
    }
}
