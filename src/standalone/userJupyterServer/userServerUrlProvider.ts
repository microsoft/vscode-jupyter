// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
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
import { JupyterConnection } from '../../kernels/jupyter/jupyterConnection';
import { validateSelectJupyterURI } from '../../kernels/jupyter/serverSelector';
import { IJupyterServerUri, IJupyterUriProvider, IJupyterUriProviderRegistration } from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IApplicationShell, IClipboard, IEncryptedStorage } from '../../platform/common/application/types';
import { Settings } from '../../platform/common/constants';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    IFeaturesManager,
    IMemento,
    IsWebExtension
} from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { traceError } from '../../platform/logging';

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
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager
    ) {
        this.disposables.push(this);
    }

    activate() {
        const updatePerFeature = () => {
            if (this.featuresManager.features.kernelPickerType === 'Insiders') {
                this._activateProvider();
            } else {
                this._localDisposables.forEach((d) => d.dispose());
                this._localDisposables = [];
            }
        };

        this.disposables.push(this.featuresManager.onDidChangeFeatures(() => updatePerFeature()));
        updatePerFeature();
    }

    private _activateProvider() {
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

            if (!cache || !serverList) {
                resolve();
                return;
            }

            const encryptedList = cache.split(Settings.JupyterServerRemoteLaunchUriSeparator);

            if (encryptedList.length === 0) {
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
                        input.validationMessage = message;
                    } else {
                        const serverInfo = this.parseUri(uri);
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
                    resolve(undefined);
                })
            );

            input.show();
        }).finally(() => {
            disposables.forEach((d) => d.dispose());
        });
    }

    private parseUri(uri: string): IJupyterServerUri | undefined {
        let url: URL;
        try {
            url = new URL(uri);

            // Special case for URI's ending with 'lab'. Remove this from the URI. This is not
            // the location for connecting to jupyterlab
            const baseUrl = `${url.protocol}//${url.host}${url.pathname === '/lab' ? '' : url.pathname}`;

            const token = `${url.searchParams.get('token')}`;
            const authorizationHeader = {
                Authorization: `token ${token}`
            };
            const hostName = url.hostname;

            return {
                baseUrl: baseUrl,
                token: token,
                displayName: hostName,
                authorizationHeader
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
