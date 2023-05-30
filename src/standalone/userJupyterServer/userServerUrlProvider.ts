// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import uuid from 'uuid/v4';
import {
    commands,
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
    IJupyterServerUri,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IApplicationShell, IClipboard, IEncryptedStorage } from '../../platform/common/application/types';
import { JVSC_EXTENSION_ID, Settings } from '../../platform/common/constants';
import {
    GLOBAL_MEMENTO,
    IDisposable,
    IDisposableRegistry,
    IMemento,
    IsWebExtension
} from '../../platform/common/types';
import { Common, DataScience } from '../../platform/common/utils/localize';
import { traceError, traceWarning } from '../../platform/logging';
import { JupyterPasswordConnect } from './jupyterPasswordConnect';
import { jupyterServerHandleFromString } from '../../kernels/jupyter/jupyterUtils';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { Disposables } from '../../platform/common/utils';
import { JupyterSelfCertsError } from '../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../platform/errors/jupyterSelfCertsExpiredError';
import { IJupyterPasswordConnect } from './types';

export const UserJupyterServerUriListKey = 'user-jupyter-server-uri-list';
const UserJupyterServerUriListMementoKey = '_builtin.jupyterServerUrlProvider.uriList';
const NewSecretStorageKey = UserJupyterServerUriListKey;
const OldSecretStorageKey = `${JVSC_EXTENSION_ID}.${UserJupyterServerUriListKey}`;
const providerId = '_builtin.jupyterServerUrlProvider';
type ServerInfoAndHandle = {
    serverHandle: JupyterServerProviderHandle;
    serverInfo: IJupyterServerUri;
};

@injectable()
export class UserJupyterServerUrlProvider
    extends Disposables
    implements IExtensionSyncActivationService, IDisposable, IJupyterUriProvider
{
    readonly id: string = providerId;
    readonly extensionId = JVSC_EXTENSION_ID;
    readonly displayName: string = DataScience.UserJupyterServerUrlProviderDisplayName;
    readonly detail: string = DataScience.UserJupyterServerUrlProviderDetail;
    private _onDidChangeHandles = new EventEmitter<void>();
    onDidChangeHandles: Event<void> = this._onDidChangeHandles.event;
    private _servers: { serverHandle: JupyterServerProviderHandle; serverInfo: IJupyterServerUri }[] = [];
    private _cachedServerInfoInitialized: Promise<void> | undefined;
    private readonly migration: MigrateOldStorage;
    constructor(
        @inject(IClipboard) private readonly clipboard: IClipboard,
        @inject(IJupyterUriProviderRegistration)
        private readonly uriProviderRegistration: IJupyterUriProviderRegistration,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IsWebExtension) private readonly isWebExtension: boolean,
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IJupyterPasswordConnect) private readonly passwordConnect: IJupyterPasswordConnect
    ) {
        super();
        disposables.push(this);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.migration = new MigrateOldStorage(this.encryptedStorage, this.globalMemento);
    }

    activate() {
        this.disposables.push(this.uriProviderRegistration.registerProvider(this));
        this._servers = [];

        this.disposables.push(
            commands.registerCommand('dataScience.ClearUserProviderJupyterServerCache', async () => {
                await Promise.all([
                    this.encryptedStorage.store(OldSecretStorageKey, undefined),
                    this.encryptedStorage.store(NewSecretStorageKey, undefined),
                    this.globalMemento.update(UserJupyterServerUriListMementoKey, undefined)
                ]);
                this._servers = [];
                this._onDidChangeHandles.fire();
            })
        );
    }

    private async loadUserEnteredUrls(ignoreCache?: boolean): Promise<void> {
        await this.migration.migrate();
        if (!this._cachedServerInfoInitialized || ignoreCache) {
            this._cachedServerInfoInitialized = new Promise<void>(async (resolve) => {
                try {
                    const data = await this.encryptedStorage.retrieve(NewSecretStorageKey);
                    const servers: ServerInfoAndHandle[] = data && data.length ? JSON.parse(data) : [];
                    this._servers = servers;
                } catch (ex) {
                    traceError('Failed to load user entered urls', ex);
                }
                resolve();
            });
        }

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
        await this.loadUserEnteredUrls();
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
                    const jupyterServerUri = parseUri(uri);
                    if (!jupyterServerUri) {
                        if (inputWasHidden) {
                            input.show();
                        }
                        input.validationMessage = DataScience.jupyterSelectURIInvalidURI;
                        return;
                    }

                    const serverHandle = { extensionId: JVSC_EXTENSION_ID, handle: uuid(), id: this.id };
                    const passwordResult = await this.passwordConnect.getPasswordConnectionInfo({
                        url: jupyterServerUri.baseUrl,
                        isTokenEmpty: jupyterServerUri.token.length === 0,
                        serverHandle
                    });
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

                    //
                    let message = '';
                    try {
                        await this.jupyterConnection.validateJupyterServer(serverHandle, jupyterServerUri, true);
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
                    jupyterServerUri.displayName =
                        (await this.applicationShell.showInputBox({
                            title: DataScience.jupyterRenameServer
                        })) || new URL(jupyterServerUri.baseUrl).hostname;

                    await this.updateMemento({
                        add: {
                            serverHandle,
                            serverInfo: jupyterServerUri
                        }
                    });
                    resolve(serverHandle.handle);
                }),
                input.onDidHide(() => {
                    inputWasHidden = true;
                    if (!JupyterPasswordConnect.prompt && !promptingForServerName) {
                        resolve(undefined);
                    }
                })
            );

            input.show();
        }).finally(() => disposeAllDisposables(disposables));
    }

    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        await this.loadUserEnteredUrls();
        const server = this._servers.find((s) => s.serverHandle.handle === handle);
        if (!server) {
            throw new Error('Server not found');
        }
        return this.getAuthHeaders(server.serverInfo, server.serverHandle);
    }

    private async getAuthHeaders(
        server: IJupyterServerUri,
        serverHandle: JupyterServerProviderHandle
    ): Promise<IJupyterServerUri> {
        const passwordResult = await this.passwordConnect.getPasswordConnectionInfo({
            url: server.baseUrl,
            isTokenEmpty: server.token.length === 0,
            serverHandle,
            displayName: server.displayName
        });
        return Object.assign({}, server, {
            authorizationHeader: passwordResult.requestHeaders || server.authorizationHeader
        });
    }
    async getHandles(): Promise<string[]> {
        await this.loadUserEnteredUrls();
        return this._servers.map((s) => s.serverHandle.handle);
    }

    async removeHandle(handle: string): Promise<void> {
        await this.loadUserEnteredUrls();
        await this.updateMemento({ removeHandle: handle });
    }

    private async updateMemento(options: { add: ServerInfoAndHandle } | { removeHandle: string }) {
        // Get the latest information, possible another workspace updated with a new server.
        await this.loadUserEnteredUrls(true);
        if ('add' in options) {
            // Remove any duplicates.
            this._servers = this._servers.filter((s) => s.serverInfo.baseUrl !== options.add.serverInfo.baseUrl);
            this._servers.push(options.add);
        } else if ('removeHandle' in options) {
            this._servers = this._servers.filter((s) => s.serverHandle.handle !== options.removeHandle);
        }
        await this.encryptedStorage.store(NewSecretStorageKey, JSON.stringify(this._servers));
        this._onDidChangeHandles.fire();
    }

    /**
     * Check if our server connection is considered secure. If it is not, ask the user if they want to connect
     */
    private async secureConnectionCheck(): Promise<boolean> {
        const insecureMessage = DataScience.insecureSessionMessage;
        const insecureLabels = [Common.bannerLabelYes, Common.bannerLabelNo];
        const response = await this.applicationShell.showWarningMessage(insecureMessage, ...insecureLabels);
        return response === Common.bannerLabelYes;
    }
}

const REMOTE_URI = 'https://remote/';
/**
 * This can be removed after a few releases.
 */
class MigrateOldStorage {
    private migration?: Promise<void>;
    constructor(
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento
    ) {}
    public async migrate() {
        if (!this.migration) {
            this.migration = this.migrateImpl();
        }
        return this.migration;
    }
    private async migrateImpl() {
        const oldStorage = await this.getOldStorage();
        if (oldStorage.length) {
            await Promise.all([
                this.encryptedStorage.store(OldSecretStorageKey, undefined),
                this.globalMemento.update(UserJupyterServerUriListMementoKey, undefined),
                this.encryptedStorage.store(NewSecretStorageKey, JSON.stringify(oldStorage))
            ]);
        }
    }
    private async getOldStorage() {
        const serverList = this.globalMemento.get<{ index: number; handle: string }[]>(
            UserJupyterServerUriListMementoKey
        );

        const cache = await this.encryptedStorage.retrieve(OldSecretStorageKey);
        if (!cache || !serverList || serverList.length === 0) {
            return [];
        }

        const encryptedList = cache.split(Settings.JupyterServerRemoteLaunchUriSeparator);
        if (encryptedList.length === 0 || encryptedList.length !== serverList.length) {
            traceError('Invalid server list, unable to retrieve server info');
            return [];
        }

        const servers: ServerInfoAndHandle[] = [];

        for (let i = 0; i < encryptedList.length; i += 1) {
            if (encryptedList[i].startsWith(REMOTE_URI)) {
                continue;
            }
            const serverInfo = parseUri(encryptedList[i]);
            if (!serverInfo) {
                traceError('Unable to parse server info', encryptedList[i]);
            } else {
                servers.push({
                    serverHandle: { extensionId: JVSC_EXTENSION_ID, handle: serverList[i].handle, id: providerId },
                    serverInfo
                });
            }
        }

        return servers;
    }
}

function parseUri(uri: string): IJupyterServerUri | undefined {
    // This is a url that we crafted. It's not a valid Jupyter Server Url.
    if (uri.startsWith(REMOTE_URI)) {
        return;
    }
    try {
        // Do not call this if we can avoid it, as this logs errors.
        jupyterServerHandleFromString(uri);
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
            displayName: '' // This would have been provided earlier
        };
    } catch (err) {
        traceError(`Failed to parse URI ${uri}`, err);
        // This should already have been parsed when set, so just throw if it's not right here
        return undefined;
    }
}
