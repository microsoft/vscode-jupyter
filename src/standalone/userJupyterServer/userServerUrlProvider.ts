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
import { validateSelectJupyterURI } from '../../kernels/jupyter/connection/serverSelector';
import {
    IJupyterServerUri,
    IJupyterServerUriStorage,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration
} from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IApplicationShell, IClipboard, IEncryptedStorage } from '../../platform/common/application/types';
import { Settings } from '../../platform/common/constants';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    IMemento,
    IsWebExtension
} from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { traceError } from '../../platform/logging';
import { JupyterPasswordConnect } from '../../kernels/jupyter/connection/jupyterPasswordConnect';

export const UserJupyterServerUriListKey = 'user-jupyter-server-uri-list';
const UserJupyterServerUriListMementoKey = '_builtin.jupyterServerUrlProvider.uriList';

@injectable()
export class UserJupyterServerUrlProvider implements IExtensionSyncActivationService, IDisposable, IJupyterUriProvider {
    readonly id: string = '_builtin.jupyterServerUrlProvider';
    readonly displayName: string = DataScience.UserJupyterServerUrlProviderDisplayName;
    readonly detail: string = DataScience.UserJupyterServerUrlProviderDetail;
    private _onDidChangeHandles = new EventEmitter<void>();
    onDidChangeHandles: Event<void> = this._onDidChangeHandles.event;
    private _servers: { handle: string; uri: string; serverInfo: IJupyterServerUri }[] = [];
    private _cachedServerInfoInitialized: Promise<void> | undefined;
    private _localDisposables: Disposable[] = [];
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
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        this.disposables.push(this);
    }

    activate() {
        this._localDisposables.push(this.uriProviderRegistration.registerProvider(this));
        this._servers = [];

        this._localDisposables.push(
            commands.registerCommand('dataScience.ClearUserProviderJupyterServerCache', async () => {
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

        this._initializeCachedServerInfo()
            .then(async () => {
                // once cache is initialized, check if we should do migration
                const existingServers = await this.serverUriStorage.getAll();
                const migratedServers = [];
                for (const server of existingServers) {
                    const info = server.provider;
                    if (info) {
                        continue;
                    }

                    if (this._servers.find((s) => s.uri === server.uri)) {
                        // already exist
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

                this._servers.push(...migratedServers);
                this._onDidChangeHandles.fire();
            })
            .catch(noop);
    }

    private async _initializeCachedServerInfo(): Promise<void> {
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
                resolve();
                return;
            }

            const encryptedList = cache.split(Settings.JupyterServerRemoteLaunchUriSeparator);

            if (encryptedList.length === 0 || encryptedList.length !== serverList.length) {
                traceError('Invalid server list, unable to retrieve server info');
                resolve();
                return;
            }

            const servers = [];

            for (let i = 0; i < encryptedList.length; i += 1) {
                const serverInfo = this.parseUri(encryptedList[i]);
                if (!serverInfo) {
                    traceError('Unable to parse server info', serverInfo);
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

    getQuickPickEntryItems(): (QuickPickItem & {
        /**
         * If this is the only quick pick item in the list and this is true, then this item will be selected by default.
         */
        default?: boolean;
    })[] {
        return [
            {
                default: true,
                label: DataScience.jupyterSelectURIPrompt,
                detail: DataScience.jupyterSelectURINewDetail
            }
        ];
    }

    async handleQuickPick(item: QuickPickItem, backEnabled: boolean): Promise<string | undefined> {
        await this._cachedServerInfoInitialized;
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
                    const uri = input.value;

                    try {
                        for (let server of this._servers) {
                            if (server.uri === uri) {
                                // already exist
                                input.validationMessage = DataScience.UserJupyterServerUrlAlreadyExistError;
                                return;
                            }
                        }
                    } catch (ex) {
                        // Ignore errors.
                        traceError('Failed to check if server already exists', ex);
                    }

                    const message = await validateSelectJupyterURI(
                        this.jupyterConnection,
                        this.applicationShell,
                        this.configService,
                        this.isWebExtension,
                        uri
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
                        const displayName = await this.applicationShell.showInputBox({
                            title: DataScience.jupyterRenameServer
                        });

                        const serverInfo = this.parseUri(uri, (displayName || '').trim());
                        if (serverInfo) {
                            const handle = uuid();
                            this._servers.push({
                                handle: handle,
                                uri: uri,
                                serverInfo
                            });
                            await this.updateMemento();
                            resolve(handle);
                        } else {
                            resolve(undefined);
                        }
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

    private parseUri(uri: string, displayName?: string): IJupyterServerUri | undefined {
        let url: URL;
        try {
            url = new URL(uri);

            // Special case for URI's ending with 'lab'. Remove this from the URI. This is not
            // the location for connecting to jupyterlab
            const baseUrl = `${url.protocol}//${url.host}${url.pathname === '/lab' ? '' : url.pathname}`;

            const token = `${url.searchParams.get('token')}`;
            const isTokenEmpty = token === '' || token === 'null';
            const authorizationHeader = {
                Authorization: `token ${token}`
            };
            const hostName = url.hostname;

            return {
                baseUrl: baseUrl,
                token: isTokenEmpty ? '' : token,
                displayName: displayName || hostName,
                authorizationHeader: isTokenEmpty ? {} : authorizationHeader
            };
        } catch (err) {
            // This should already have been parsed when set, so just throw if it's not right here
            return undefined;
        }
    }

    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        const server = this._servers.find((s) => s.handle === handle);

        if (!server) {
            throw new Error('Server not found');
        }

        return server.serverInfo;
    }

    async getHandles(): Promise<string[]> {
        await this._initializeCachedServerInfo();
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
}
