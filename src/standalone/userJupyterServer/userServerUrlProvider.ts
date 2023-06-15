// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    Uri,
    window
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
import { Identifiers, JVSC_EXTENSION_ID, Settings } from '../../platform/common/constants';
import {
    Experiments,
    GLOBAL_MEMENTO,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    IExperimentService,
    IMemento,
    IsWebExtension
} from '../../platform/common/types';
import { Common, DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { traceError, traceWarning } from '../../platform/logging';
import { IJupyterPasswordConnectInfo, JupyterPasswordConnect } from './jupyterPasswordConnect';
import { extractJupyterServerHandleAndId } from '../../kernels/jupyter/jupyterUtils';
import { IJupyterServerUri } from '../../api';
import { IMultiStepInputFactory } from '../../platform/common/utils/multiStepInput';
import { JupyterSelfCertsError } from '../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../platform/errors/jupyterSelfCertsExpiredError';
import { validateSelectJupyterURI } from '../../kernels/jupyter/connection/serverSelector';

export const UserJupyterServerUriListKey = 'user-jupyter-server-uri-list';
const UserJupyterServerUriListMementoKey = '_builtin.jupyterServerUrlProvider.uriList';
const GlobalStateUserAllowsInsecureConnections = 'DataScienceAllowInsecureConnections';

@injectable()
export class UserJupyterServerUrlProvider
    implements IExtensionSyncActivationService, IDisposable, IInternalJupyterUriProvider
{
    readonly id: string = '_builtin.jupyterServerUrlProvider';
    public readonly extensionId: string = JVSC_EXTENSION_ID;
    readonly displayName: string = DataScience.UserJupyterServerUrlProviderDisplayName;
    readonly detail: string = DataScience.UserJupyterServerUrlProviderDetail;
    private _onDidChangeHandles = new EventEmitter<void>();
    onDidChangeHandles: Event<void> = this._onDidChangeHandles.event;
    private _servers: { handle: string; uri: string; serverInfo: IJupyterServerUri }[] = [];
    private _cachedServerInfoInitialized: Promise<void> | undefined;
    private _localDisposables: Disposable[] = [];
    private readonly passwordConnect: JupyterPasswordConnect;
    constructor(
        @inject(IClipboard) private readonly clipboard: IClipboard,
        @inject(IJupyterUriProviderRegistration)
        private readonly uriProviderRegistration: IJupyterUriProviderRegistration,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
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
        @inject(IExperimentService) private readonly experiments: IExperimentService
    ) {
        this.disposables.push(this);
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
        this._servers = [];

        this._localDisposables.push(
            this.commands.registerCommand('dataScience.ClearUserProviderJupyterServerCache', async () => {
                await this.encryptedStorage.store(
                    Settings.JupyterServerRemoteLaunchService,
                    UserJupyterServerUriListKey,
                    ''
                );
                await this.globalMemento.update(UserJupyterServerUriListMementoKey, []);
                this._servers = [];
                this._onDidChangeHandles.fire();
            })
        );

        this.migrateOldUserEnteredUrlsToProviderUri()
            .then(async () => {
                // once cache is initialized, check if we should do migration
                const existingServers = await this.serverUriStorage.getAll();
                const migratedServers = [];
                for (const server of existingServers) {
                    if (this._servers.find((s) => s.uri === server.uri)) {
                        // already exist
                        continue;
                    }
                    if (server.provider.id !== this.id) {
                        continue;
                    }

                    const serverInfo = this.parseUri(server.uri);
                    if (serverInfo) {
                        migratedServers.push({
                            handle: uuid(),
                            uri: server.uri,
                            serverInfo: serverInfo
                        });
                    }
                }

                if (migratedServers.length > 0) {
                    this._servers.push(...migratedServers);
                    this._onDidChangeHandles.fire();
                }
            })
            .catch(noop);
    }

    private async migrateOldUserEnteredUrlsToProviderUri(): Promise<void> {
        if (this._cachedServerInfoInitialized) {
            return this._cachedServerInfoInitialized;
        }

        this._cachedServerInfoInitialized = new Promise<void>(async (resolve) => {
            const serverList = this.globalMemento.get<{ index: number; handle: string }[]>(
                UserJupyterServerUriListMementoKey
            );

            const cache = await this.encryptedStorage.retrieve(
                Settings.JupyterServerRemoteLaunchService,
                UserJupyterServerUriListKey
            );

            if (!cache || !serverList || serverList.length === 0) {
                return resolve();
            }

            const encryptedList = cache.split(Settings.JupyterServerRemoteLaunchUriSeparator);
            if (encryptedList.length === 0 || encryptedList.length !== serverList.length) {
                traceError('Invalid server list, unable to retrieve server info');
                return resolve();
            }

            const servers = [];

            for (let i = 0; i < encryptedList.length; i += 1) {
                if (encryptedList[i].startsWith(Identifiers.REMOTE_URI)) {
                    continue;
                }
                const serverInfo = this.parseUri(encryptedList[i]);
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

            this._servers = servers;

            resolve();
        });

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
        if (this.experiments.inExperiment(Experiments.PasswordManager)) {
            return this.handleQuickPickNew(item, backEnabled);
        } else {
            return this.handleQuickPickOld(item, backEnabled);
        }
    }
    async handleQuickPickOld(item: QuickPickItem, backEnabled: boolean): Promise<string | undefined> {
        await this.migrateOldUserEnteredUrlsToProviderUri();
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
        const input = window.createInputBox();
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

            let inputWasHidden = false;
            let promptingForServerName = false;
            disposables.push(
                input.onDidAccept(async () => {
                    // If it ends with /lab? or /lab or /tree? or /tree, then remove that part.
                    const uri = input.value.trim().replace(/\/(lab|tree)(\??)$/, '');
                    try {
                        new URL(uri);
                    } catch (err) {
                        if (inputWasHidden) {
                            input.show();
                        }
                        input.validationMessage = DataScience.jupyterSelectURIInvalidURI;
                        return;
                    }
                    const jupyterServerUri = this.parseUri(uri, '');
                    if (!jupyterServerUri) {
                        if (inputWasHidden) {
                            input.show();
                        }
                        input.validationMessage = DataScience.jupyterSelectURIInvalidURI;
                        return;
                    }
                    const handle = uuid();
                    const message = await validateSelectJupyterURI(
                        this.jupyterConnection,
                        this.applicationShell,
                        this.configService,
                        this.isWebExtension,
                        { id: this.id, handle },
                        jupyterServerUri
                    );

                    if (message) {
                        if (inputWasHidden) {
                            input.show();
                        }
                        input.validationMessage = message;
                    } else {
                        promptingForServerName = true;
                        // Offer the user a chance to pick a display name for the server
                        // Leaving it blank will use the URI as the display name
                        jupyterServerUri.displayName =
                            (await this.applicationShell.showInputBox({
                                title: DataScience.jupyterRenameServer
                            })) || jupyterServerUri.displayName;

                        this._servers.push({
                            handle: handle,
                            uri: uri,
                            serverInfo: jupyterServerUri
                        });
                        await this.updateMemento();
                        resolve(handle);
                    }
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
    async handleQuickPickNew(item: QuickPickItem, backEnabled: boolean): Promise<string | undefined> {
        await this.migrateOldUserEnteredUrlsToProviderUri();
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
        const input = window.createInputBox();
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

            let inputWasHidden = false;
            let promptingForServerName = false;
            disposables.push(
                input.onDidAccept(async () => {
                    // If it ends with /lab? or /lab or /tree? or /tree, then remove that part.
                    const uri = input.value.trim().replace(/\/(lab|tree)(\??)$/, '');
                    const jupyterServerUri = this.parseUri(uri, '');
                    if (!jupyterServerUri) {
                        if (inputWasHidden) {
                            input.show();
                        }
                        input.validationMessage = DataScience.jupyterSelectURIInvalidURI;
                        return;
                    }

                    let passwordResult: IJupyterPasswordConnectInfo;

                    try {
                        passwordResult = await this.passwordConnect.getPasswordConnectionInfo({
                            url: jupyterServerUri.baseUrl,
                            isTokenEmpty: jupyterServerUri.token.length === 0
                        });
                    } catch (err) {
                        if (!(err && err instanceof CancellationError)) {
                            traceError(`Failed to get the password for ${jupyterServerUri.baseUrl}`, err);
                        }
                        input.hide();
                        resolve(undefined);
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
                        new URL(jupyterServerUri.baseUrl).protocol.toLowerCase() === 'http'
                    ) {
                        const proceed = await this.secureConnectionCheck();
                        if (!proceed) {
                            resolve(undefined);
                            input.hide();
                            return;
                        }
                    }

                    const handle = uuid();
                    let message = '';
                    try {
                        await this.jupyterConnection.validateRemoteUri({ id: this.id, handle }, jupyterServerUri, true);
                    } catch (err) {
                        traceWarning('Uri verification error', err);
                        if (JupyterSelfCertsError.isSelfCertsError(err)) {
                            message = DataScience.jupyterSelfCertFailErrorMessageOnly;
                        } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                            message = DataScience.jupyterSelfCertExpiredErrorMessageOnly;
                        } else if (passwordResult.requiresPassword && jupyterServerUri.token.length === 0) {
                            message = DataScience.passwordFailure;
                        } else {
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

                    this._servers.push({
                        handle: handle,
                        uri: uri,
                        serverInfo: jupyterServerUri
                    });
                    await this.updateMemento();
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

    private parseUri(uri: string, displayName?: string): IJupyterServerUri | undefined {
        // This is a url that we crafted. It's not a valid Jupyter Server Url.
        if (uri.startsWith(Identifiers.REMOTE_URI)) {
            return;
        }
        try {
            extractJupyterServerHandleAndId(uri);
            // This is a url that we crafted. It's not a valid Jupyter Server Url.
            return;
        } catch (ex) {
            // This is a valid Jupyter Server Url.
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

    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        const server = this._servers.find((s) => s.handle === handle);
        if (!server) {
            throw new Error('Server not found');
        }
        if (!this.experiments.inExperiment(Experiments.PasswordManager)) {
            return server.serverInfo;
        }

        const passwordResult = await this.passwordConnect.getPasswordConnectionInfo({
            url: server.serverInfo.baseUrl,
            isTokenEmpty: server.serverInfo.token.length === 0,
            displayName: server.serverInfo.displayName
        });
        return Object.assign({}, server.serverInfo, {
            authorizationHeader: passwordResult.requestHeaders || server.serverInfo.authorizationHeader
        });
    }
    async getHandles(): Promise<string[]> {
        await this.migrateOldUserEnteredUrlsToProviderUri();
        return this._servers.map((s) => s.handle);
    }

    async removeHandle(handle: string): Promise<void> {
        this._servers = this._servers.filter((s) => s.handle !== handle);
        await this.updateMemento();
        this._onDidChangeHandles.fire();
    }

    private async updateMemento() {
        const blob = this._servers.map((e) => `${e.uri}`).join(Settings.JupyterServerRemoteLaunchUriSeparator);
        const mementoList = this._servers.map((v, i) => ({ index: i, handle: v.handle }));
        await this.globalMemento.update(UserJupyterServerUriListMementoKey, mementoList);
        return this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKey,
            blob
        );
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
