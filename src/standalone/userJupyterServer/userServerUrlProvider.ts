// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import { Disposable, QuickInputButtons, QuickPickItem, Uri, window } from 'vscode';
import { JupyterConnection } from '../../kernels/jupyter/jupyterConnection';
import { validateSelectJupyterURI } from '../../kernels/jupyter/serverSelector';
import { IJupyterServerUri, IJupyterUriProvider, IJupyterUriProviderRegistration } from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IApplicationShell, IClipboard, IEncryptedStorage } from '../../platform/common/application/types';
import { Settings } from '../../platform/common/constants';
import { IConfigurationService, IDisposable, IsWebExtension } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';

export const UserJupyterServerUriListKey = 'user-jupyter-server-uri-list';

@injectable()
export class UserJupyterServerUrlProvider implements IExtensionSyncActivationService, IDisposable, IJupyterUriProvider {
    readonly id: string = '_builtin.jupyterServerUrlProvider';
    readonly displayName: string = DataScience.UserJupyterServerUrlProviderDisplayName();
    readonly detail: string = DataScience.UserJupyterServerUrlProviderDetail();
    private _servers: { handle: string; serverInfo: IJupyterServerUri }[] = [];
    private _initialized: Promise<void> | undefined;

    constructor(
        @inject(IClipboard) private readonly clipboard: IClipboard,
        @inject(IJupyterUriProviderRegistration)
        private readonly uriProviderRegistration: IJupyterUriProviderRegistration,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IsWebExtension) private readonly isWebExtension: boolean,
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage
    ) {}

    activate() {
        this.uriProviderRegistration.registerProvider(this);
        this._initialized = new Promise(async (resolve) => {
            const cache = await this.encryptedStorage.retrieve(
                Settings.JupyterServerRemoteLaunchService,
                UserJupyterServerUriListKey
            );

            if (cache) {
                const servers = cache.split(Settings.JupyterServerRemoteLaunchUriSeparator);
                for (let server of servers) {
                    const serverInfo = await this.parseUri(server);
                    if (serverInfo) {
                        this._servers.push({ handle: server, serverInfo });
                    }
                }
            }

            resolve();
        });
    }

    getQuickPickEntryItems(): QuickPickItem[] {
        return [
            {
                label: DataScience.jupyterSelectURIPrompt(),
                detail: DataScience.jupyterSelectURINewDetail()
            }
        ];
    }

    async handleQuickPick(item: QuickPickItem, backEnabled: boolean): Promise<string | undefined> {
        await this._initialized;
        if (item.label !== DataScience.jupyterSelectURIPrompt()) {
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
        input.title = DataScience.jupyterSelectURIPrompt();
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

                    if (this._servers.find((s) => s.handle === uri)) {
                        // already exist
                        input.validationMessage = DataScience.UserJupyterServerUrlAlreadyExistError();
                        return;
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
                            this._servers.push({ handle: uri, serverInfo });
                            await this.updateMemento();
                            resolve(uri);
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
        await this._initialized;

        const server = this._servers.find((s) => s.handle === handle);

        if (!server) {
            throw new Error('Server not found');
        }

        return server.serverInfo;
    }

    async getHandles(): Promise<string[]> {
        await this._initialized;

        return this._servers.map((s) => s.handle);
    }

    private async updateMemento() {
        const blob = this._servers.map((e) => `${e.handle}`).join(Settings.JupyterServerRemoteLaunchUriSeparator);
        return this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            UserJupyterServerUriListKey,
            blob
        );
    }

    dispose(): void {
        return;
    }
}
