// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named, optional } from 'inversify';
import uuid from 'uuid/v4';
import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    Command,
    Disposable,
    Event,
    EventEmitter,
    Memento,
    QuickInputButtons,
    QuickPickItem,
    Uri,
    env
} from 'vscode';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import {
    IJupyterServerUriStorage,
    IInternalJupyterUriProvider,
    IJupyterUriProviderRegistration,
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
    IJupyterServerProviderRegistry
} from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import {
    IApplicationEnvironment,
    IApplicationShell,
    IClipboard,
    ICommandManager,
    IEncryptedStorage
} from '../../platform/common/application/types';
import {
    Identifiers,
    JVSC_EXTENSION_ID,
    Settings,
    Telemetry,
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
import { IJupyterPasswordConnectInfo, JupyterPasswordConnect } from './jupyterPasswordConnect';
import { IJupyterServerUri, JupyterServer, JupyterServerCommandProvider, JupyterServerProvider } from '../../api';
import { IMultiStepInputFactory } from '../../platform/common/utils/multiStepInput';
import { JupyterSelfCertsError } from '../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../platform/errors/jupyterSelfCertsExpiredError';
import { Deferred, createDeferred } from '../../platform/common/utils/async';
import { IFileSystem } from '../../platform/common/platform/types';
import { RemoteKernelSpecCacheFileName } from '../../kernels/jupyter/constants';
import { sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';

export const UserJupyterServerUriListKey = 'user-jupyter-server-uri-list';
export const UserJupyterServerUriListKeyV2 = 'user-jupyter-server-uri-list-version2';
export const UserJupyterServerUriListMementoKey = '_builtin.jupyterServerUrlProvider.uriList';
const GlobalStateUserAllowsInsecureConnections = 'DataScienceAllowInsecureConnections';

@injectable()
export class UserJupyterServerUrlProvider
    implements
        IExtensionSyncActivationService,
        IDisposable,
        IInternalJupyterUriProvider,
        JupyterServerProvider,
        JupyterServerCommandProvider
{
    readonly id: string = UserJupyterServerPickerProviderId;
    public readonly extensionId: string = JVSC_EXTENSION_ID;
    readonly documentation = Uri.parse('https://aka.ms/vscodeJuptyerExtKernelPickerExistingServer');
    readonly displayName: string = DataScience.UserJupyterServerUrlProviderDisplayName;
    readonly detail: string = DataScience.UserJupyterServerUrlProviderDetail;
    private _onDidChangeHandles = new EventEmitter<void>();
    onDidChangeHandles: Event<void> = this._onDidChangeHandles.event;
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
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IJupyterServerProviderRegistry)
        private readonly jupyterServerProviderRegistry: IJupyterServerProviderRegistry,
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment
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
    selected: Command = {
        title: DataScience.jupyterSelectURIPrompt,
        tooltip: DataScience.jupyterSelectURINewDetail,
        command: 'jupyter.selectLocalJupyterServer'
    };
    async getCommands(_token: CancellationToken): Promise<Command[]> {
        return [
            {
                title: DataScience.jupyterSelectURIPrompt,
                tooltip: DataScience.jupyterSelectURINewDetail,
                command: 'jupyter.selectLocalJupyterServer'
            }
        ];
    }
    private _onDidChangeServers = new EventEmitter<void>();
    onDidChangeServers = this._onDidChangeServers.event;
    async getJupyterServers(_token: CancellationToken): Promise<JupyterServer[]> {
        await this.initializeServers();
        const servers = await this.newStorage.getServers(false);
        return servers.map((s) => {
            return {
                id: s.handle,
                label: s.serverInfo.displayName,
                resolveConnectionInformation: async (_token: CancellationToken) => {
                    const serverInfo = await this.getServerUri(s.handle);
                    return {
                        baseUrl: Uri.parse(serverInfo.baseUrl),
                        token: serverInfo.token,
                        authorizationHeader: serverInfo.authorizationHeader,
                        mappedRemoteNotebookDir: serverInfo.mappedRemoteNotebookDir
                            ? Uri.file(serverInfo.mappedRemoteNotebookDir)
                            : undefined,
                        webSocketProtocols: serverInfo.webSocketProtocols
                    };
                },
                remove: () => this.removeHandle(s.handle)
            };
        });
    }
    activate() {
        if (this.appEnv.channel === 'insiders') {
            const collection = this.jupyterServerProviderRegistry.createJupyterServerCollection(
                JVSC_EXTENSION_ID,
                this.id,
                this.displayName
            );
            this.disposables.push(collection);
            collection.commandProvider = this;
            collection.serverProvider = this;
            collection.documentation = this.documentation;
            this.onDidChangeHandles(() => this._onDidChangeServers.fire(), this, this.disposables);
            this.commands.registerCommand('jupyter.selectLocalJupyterServer', async () => {
                const token = new CancellationTokenSource();
                try {
                    const handleOrBack = await this.handleQuickPick(
                        { label: DataScience.jupyterSelectURIPrompt },
                        true
                    );
                    if (!handleOrBack) {
                        return;
                    }
                    if (handleOrBack === 'back') {
                        return 'back';
                    }
                    const servers = await this.getJupyterServers(token.token);
                    const server = servers.find((s) => s.id === handleOrBack);
                    if (!server) {
                        throw new Error(`Server ${handleOrBack} not found`);
                    }
                    return server;
                } catch (ex) {
                    traceError(`Failed to select a Jupyter Server`, ex);
                    return;
                }
            });
        } else {
            this._localDisposables.push(this.uriProviderRegistration.registerProvider(this, JVSC_EXTENSION_ID));
        }
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
        this.initializeServers().catch(noop);
    }
    private migrateOldServers() {
        if (!this.migratedOldServers) {
            this.migratedOldServers = this.oldStorage
                .getServers()
                .then(async (servers) => {
                    await this.newStorage.migrate(servers, this.serverUriStorage);
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
                                        { time: server.time }
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
    private initializeServers(): Promise<void> {
        if (this._cachedServerInfoInitialized) {
            return this._cachedServerInfoInitialized;
        }
        const deferred = createDeferred<void>();
        this._cachedServerInfoInitialized = deferred.promise;

        (async () => {
            const NEW_STORAGE_MIGRATION_DONE_KEY = 'NewUserUriMigrationCompleted';
            if (this.globalMemento.get<string>(NEW_STORAGE_MIGRATION_DONE_KEY) !== env.machineId) {
                await Promise.all([this.migrateOldServers().catch(noop), this.newStorage.migrationDone]);
                await this.globalMemento.update(NEW_STORAGE_MIGRATION_DONE_KEY, env.machineId);
            }
            this.getHandles().catch(noop);
            deferred.resolve();
        })()
            .then(
                () => deferred.resolve(),
                (ex) => deferred.reject(ex)
            )
            .catch(noop);
        return this._cachedServerInfoInitialized;
    }

    getQuickPickEntryItems(): (QuickPickItem & { default?: boolean })[] {
        return [
            {
                default: true,
                label: DataScience.jupyterSelectURIPrompt,
                detail: DataScience.jupyterSelectURINewDetail
            }
        ];
    }

    async handleQuickPick(item: QuickPickItem, backEnabled: boolean): Promise<string | undefined> {
        await this.initializeServers();
        if (item.label !== DataScience.jupyterSelectURIPrompt) {
            return undefined;
        }

        let initialValue = '';
        try {
            const text = await this.clipboard.readText().catch(() => '');
            const parsedUri = Uri.parse(text.trim(), true);
            // Only display http/https uris.
            initialValue = text && parsedUri && parsedUri.scheme.toLowerCase().startsWith('http') ? text : '';
        } catch {
            // We can ignore errors.
        }

        const disposables: Disposable[] = [];

        // Ask the user to enter a URI to connect to.
        const input = this.applicationShell.createInputBox();
        input.title = DataScience.jupyterSelectURIPrompt;
        input.value = initialValue;
        input.ignoreFocusOut = true;

        return new Promise<string | undefined>((resolve) => {
            if (backEnabled) {
                input.buttons = [QuickInputButtons.Back];
                disposables.push(
                    input.onDidTriggerButton((item) => {
                        if (item === QuickInputButtons.Back) {
                            resolve('back');
                        } else {
                            resolve(undefined);
                        }
                    })
                );
            }

            async function sendTelemetryEventForRemoteUrl(
                uri: string,
                failureReason?:
                    | 'InvalidUrl'
                    | 'NonHttpUrl'
                    | 'ConnectionFailure'
                    | 'InsecureHTTP'
                    | 'SelfCert'
                    | 'ExpiredCert'
                    | 'AuthFailure'
            ) {
                try {
                    const url = new URL(uri);
                    const isLocalHost =
                        url.hostname.toLowerCase() === 'localhost' || url.host.toLowerCase() === '127.0.0.1';
                    const baseUrlHash = await getTelemetrySafeHashedString(url.origin.toLowerCase());
                    sendTelemetryEvent(Telemetry.EnterRemoteJupyterUrl, undefined, {
                        failed: !!failureReason,
                        baseUrlHash,
                        isLocalHost,
                        reason: failureReason
                    });
                } catch (ex) {
                    traceWarning(`Failed to generate a hash of the Url`, ex);
                }
            }
            let inputWasHidden = false;
            let promptingForServerName = false;
            disposables.push(
                input.onDidAccept(async () => {
                    // If it ends with /lab? or /lab or /tree? or /tree, then remove that part.
                    const uri = input.value.trim().replace(/\/(lab|tree)(\??)$/, '');
                    const jupyterServerUri = parseUri(uri, '');
                    if (!jupyterServerUri) {
                        if (inputWasHidden) {
                            input.show();
                        }
                        input.validationMessage = DataScience.jupyterSelectURIInvalidURI;
                        sendTelemetryEventForRemoteUrl(uri, 'InvalidUrl').catch(noop);
                        return;
                    }
                    if (!uri.toLowerCase().startsWith('http:') && !uri.toLowerCase().startsWith('https:')) {
                        if (inputWasHidden) {
                            input.show();
                        }
                        input.validationMessage = DataScience.jupyterSelectURIMustBeHttpOrHttps;
                        sendTelemetryEventForRemoteUrl(uri, 'NonHttpUrl').catch(noop);
                        return;
                    }

                    let passwordResult: IJupyterPasswordConnectInfo;
                    const handle = uuid();

                    try {
                        passwordResult = await this.passwordConnect.getPasswordConnectionInfo({
                            url: jupyterServerUri.baseUrl,
                            isTokenEmpty: jupyterServerUri.token.length === 0,
                            handle
                        });
                    } catch (err) {
                        if (err && err instanceof CancellationError) {
                            input.hide();
                            resolve(undefined);
                        } else {
                            traceError(`Failed to get the password for ${jupyterServerUri.baseUrl}`, err);
                            if (inputWasHidden) {
                                input.show();
                            }
                            // Return the general connection error to show in the validation box
                            // Replace any Urls in the error message with markdown link.
                            const urlRegex = /(https?:\/\/[^\s]+)/g;
                            const errorMessage = (err.message || err.toString()).replace(
                                urlRegex,
                                (url: string) => `[${url}](${url})`
                            );
                            input.validationMessage = (
                                this.isWebExtension
                                    ? DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb
                                    : DataScience.remoteJupyterConnectionFailedWithoutServerWithError
                            )(errorMessage);
                        }
                        sendTelemetryEventForRemoteUrl(uri, 'ConnectionFailure').catch(noop);
                        return;
                    }
                    if (passwordResult.requestHeaders) {
                        jupyterServerUri.authorizationHeader = passwordResult?.requestHeaders;
                    }

                    // If we do not have any auth header information & there is no token & no password, & this is HTTP then this is an insecure server
                    // & we need to ask the user for consent to use this insecure server.
                    if (
                        !passwordResult.requiresPassword &&
                        jupyterServerUri.token.length === 0 &&
                        new URL(jupyterServerUri.baseUrl).protocol.toLowerCase() === 'http:'
                    ) {
                        const proceed = await this.secureConnectionCheck();
                        if (!proceed) {
                            resolve(undefined);
                            input.hide();
                            sendTelemetryEventForRemoteUrl(uri, 'InsecureHTTP').catch(noop);
                            return;
                        }
                    }

                    let message = '';
                    try {
                        await this.jupyterConnection.validateRemoteUri(
                            { id: this.id, handle, extensionId: JVSC_EXTENSION_ID },
                            jupyterServerUri,
                            true
                        );
                        sendTelemetryEventForRemoteUrl(uri).catch(noop);
                    } catch (err) {
                        traceWarning('Uri verification error', err);
                        if (JupyterSelfCertsError.isSelfCertsError(err)) {
                            sendTelemetryEventForRemoteUrl(uri, 'SelfCert').catch(noop);
                            message = DataScience.jupyterSelfCertFailErrorMessageOnly;
                        } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                            sendTelemetryEventForRemoteUrl(uri, 'ExpiredCert').catch(noop);
                            message = DataScience.jupyterSelfCertExpiredErrorMessageOnly;
                        } else if (passwordResult.requiresPassword && jupyterServerUri.token.length === 0) {
                            sendTelemetryEventForRemoteUrl(uri, 'AuthFailure').catch(noop);
                            message = DataScience.passwordFailure;
                        } else {
                            sendTelemetryEventForRemoteUrl(uri, 'ConnectionFailure').catch(noop);
                            // Return the general connection error to show in the validation box
                            // Replace any Urls in the error message with markdown link.
                            const urlRegex = /(https?:\/\/[^\s]+)/g;
                            const errorMessage = (err.message || err.toString()).replace(
                                urlRegex,
                                (url: string) => `[${url}](${url})`
                            );
                            message = (
                                this.isWebExtension || true
                                    ? DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb
                                    : DataScience.remoteJupyterConnectionFailedWithoutServerWithError
                            )(errorMessage);
                        }
                    }

                    if (message) {
                        if (inputWasHidden) {
                            input.show();
                        }
                        input.validationMessage = message;
                        return;
                    }

                    promptingForServerName = true;
                    // Offer the user a chance to pick a display name for the server
                    // Leaving it blank will use the URI as the display name
                    jupyterServerUri.displayName =
                        (await this.applicationShell.showInputBox({
                            title: DataScience.jupyterRenameServer
                        })) || new URL(jupyterServerUri.baseUrl).hostname;
                    this.displayNamesOfHandles.set(handle, jupyterServerUri.displayName);
                    await this.initializeServers();
                    await this.addNewServer({
                        handle: handle,
                        uri: uri,
                        serverInfo: jupyterServerUri
                    });
                    resolve(handle);
                }),
                input.onDidHide(() => {
                    inputWasHidden = true;
                    if (!JupyterPasswordConnect.prompt && !promptingForServerName) {
                        resolve(undefined);
                    }
                })
            );

            input.show();
        }).finally(() => {
            disposables.forEach((d) => d.dispose());
        });
    }

    private async addNewServer(server: { handle: string; uri: string; serverInfo: IJupyterServerUri }) {
        await this.newStorage.add(server);
        this._onDidChangeHandles.fire();
    }
    async getServerUriWithoutAuthInfo(handle: string): Promise<IJupyterServerUri> {
        await this.initializeServers();
        const servers = await this.newStorage.getServers(false);
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
        const servers = await this.newStorage.getServers(false);
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
        const servers = await this.newStorage.getServers(false);
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

    /**
     * Check if our server connection is considered secure. If it is not, ask the user if they want to connect
     */
    private async secureConnectionCheck(): Promise<boolean> {
        if (this.globalMemento.get(GlobalStateUserAllowsInsecureConnections, false)) {
            return true;
        }

        const insecureMessage = DataScience.insecureSessionMessage;
        const insecureLabels = [Common.bannerLabelYes, Common.bannerLabelNo];
        const response = await this.applicationShell.showWarningMessage(insecureMessage, ...insecureLabels);
        return response === Common.bannerLabelYes;
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
    displayName: string;
};
function serverToStorageFormat(
    servers: {
        handle: string;
        uri: string;
        serverInfo: IJupyterServerUri;
    }[]
): StorageItem[] {
    return servers.map((s) => ({ handle: s.handle, uri: s.uri, displayName: s.serverInfo.displayName }));
}
function storageFormatToServers(items: StorageItem[]) {
    const servers: {
        handle: string;
        uri: string;
        serverInfo: IJupyterServerUri;
    }[] = [];
    items.forEach((s) => {
        const server = parseUri(s.uri, s.displayName);
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
    private servers?: { handle: string; uri: string; serverInfo: IJupyterServerUri }[];
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
        }[],
        uriStorage: IJupyterServerUriStorage
    ) {
        const data = await this.encryptedStorage.retrieve(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2
        );

        if (typeof data === 'string') {
            // Already migrated once before, next migrate the display names
            let userServers: { handle: string; uri: string; serverInfo: IJupyterServerUri }[] = [];
            let displayNamesMigrated = false;
            try {
                const storageData: StorageItem[] = JSON.parse(data || '[]');
                displayNamesMigrated = storageData.some((s) => s.displayName);
                userServers = storageFormatToServers(storageData);
            } catch {
                return;
            }

            if (!displayNamesMigrated) {
                await this.migrateDisplayNames(userServers, uriStorage);
            }
            return this._migrationDone.resolve();
        }
        this.encryptedStorage
            .store(
                Settings.JupyterServerRemoteLaunchService,
                'user-jupyter-server-uri-list-v2', // Removed as this storage data is not in the best format.
                undefined
            )
            .catch(noop);
        await this.migrateDisplayNames(servers, uriStorage);
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2,
            JSON.stringify(servers)
        );
        this._migrationDone.resolve();
    }
    public async migrateDisplayNames(
        userServers: { handle: string; uri: string; serverInfo: IJupyterServerUri }[],
        uriStorage: IJupyterServerUriStorage
    ) {
        if (userServers.length === 0) {
            // No migration necessary
            return;
        }
        const allServers = await uriStorage.getAll().catch((ex) => {
            traceError('Failed to get all servers from storage', ex);
            return [];
        });
        const userServersFromUriStorage = new Map(
            allServers
                .filter(
                    (s) =>
                        s.provider.extensionId === JVSC_EXTENSION_ID &&
                        s.provider.id === UserJupyterServerPickerProviderId
                )
                .map((s) => [s.provider.handle, s.displayName])
        );
        // Get the display name from the UriStorage and save that in here.
        userServers.forEach((server) => {
            server.serverInfo.displayName = userServersFromUriStorage.get(server.handle) || server.uri;
        });
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2,
            JSON.stringify(serverToStorageFormat(userServers))
        );
    }
    public async getServers(
        ignoreCache: boolean
    ): Promise<{ handle: string; uri: string; serverInfo: IJupyterServerUri }[]> {
        if (this.servers && !ignoreCache) {
            return this.servers;
        }
        const data = await this.encryptedStorage.retrieve(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKeyV2
        );
        if (!data) {
            return [];
        }
        try {
            return (this.servers = storageFormatToServers(JSON.parse(data)));
        } catch {
            return [];
        }
    }

    public async add(server: { handle: string; uri: string; serverInfo: IJupyterServerUri }) {
        if (this.servers) {
            this.servers = this.servers.filter((s) => s.handle !== server.handle).concat(server);
        }
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                const servers = (await this.getServers(true)).concat(server);
                this.servers = servers;
                await this.encryptedStorage.store(
                    Settings.JupyterServerRemoteLaunchService,
                    UserJupyterServerUriListKeyV2,
                    JSON.stringify(serverToStorageFormat(servers))
                );
            })
            .catch(noop));
    }
    public async remove(handle: string) {
        if (this.servers) {
            this.servers = this.servers.filter((s) => s.handle !== handle);
        }
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                const servers = (await this.getServers(true)).filter((s) => s.handle !== handle);
                this.servers = servers;
                return this.encryptedStorage.store(
                    Settings.JupyterServerRemoteLaunchService,
                    UserJupyterServerUriListKeyV2,
                    JSON.stringify(serverToStorageFormat(servers))
                );
            })
            .catch(noop));
    }
    public async clear() {
        this.servers = [];
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                this.servers = [];
                await this.encryptedStorage.store(
                    Settings.JupyterServerRemoteLaunchService,
                    UserJupyterServerUriListKeyV2,
                    undefined
                );
            })
            .catch(noop));
    }
}
