// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, CancellationTokenSource, EventEmitter, Uri, commands, window } from 'vscode';
import fetch from 'node-fetch';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { IEncryptedStorage } from '../../platform/common/application/types';
import { IJupyterServerProviderRegistry, IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { IRemoteKernelFinderController } from '../../kernels/jupyter/finder/types';
import { JVSC_EXTENSION_ID, MeeshoKernelPickerProviderId } from '../../platform/common/constants';
import { JupyterServer, JupyterServerProvider, IJupyterServerUri } from '../../api';
import { DisposableBase } from '../../platform/common/utils/lifecycle';
import { computeHash } from '../../platform/common/crypto';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import { parseUri } from '../../standalone/userJupyterServer/userServerUrlProvider';
import { IKernelAccessService } from '../../kernels/access/types';
import { ProgressLocation } from 'vscode';

/**
 * Connects to Meesho Inhouse Notebook server via manual URL entry.
 * Uses built-in Jupyter connection validation for robustness.
 */
@injectable()
export class MeeshoInhouseConnect
    extends DisposableBase
    implements IExtensionSyncActivationService, JupyterServerProvider
{
    private handleMappings = new Map<string, { baseUrl: Uri; token: string }>();
    private _onDidChangeServers = this._register(new EventEmitter<void>());
    public readonly extensionId: string = JVSC_EXTENSION_ID;
    public readonly id = MeeshoKernelPickerProviderId;
    public readonly displayName = 'Meesho Inhouse Notebook';

    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IJupyterServerProviderRegistry)
        private readonly uriProviderRegistration: IJupyterServerProviderRegistry,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IKernelAccessService) private readonly accessService: IKernelAccessService,
        @inject(IRemoteKernelFinderController)
        private readonly remoteKernelFinderController: IRemoteKernelFinderController
    ) {
        super();
        disposables.push(this);
    }

    public readonly onDidChangeServers = this._onDidChangeServers.event;

    async provideJupyterServers(_token: CancellationToken): Promise<JupyterServer[]> {
        return Array.from(this.handleMappings.entries()).map(([handle, info]) => ({
            id: handle,
            label: `Meesho Server (${info.baseUrl.authority})`,
            connectionInformation: {
                baseUrl: info.baseUrl,
                token: info.token
            }
        }));
    }

    async resolveJupyterServer(server: JupyterServer, _token: CancellationToken): Promise<JupyterServer> {
        return server;
    }

    public async activate() {
        console.log('MeeshoInhouseConnect: Activating...');
        try {
            // Restore last used server if any
            const lastUrl = await this.encryptedStorage.retrieve('Meesho', 'LastServerUrl');
            if (lastUrl) {
                console.log(`MeeshoInhouseConnect: Restoring last server: ${lastUrl}`);
                await this.addServerToMappings(lastUrl);
            }

            this._register(
                this.uriProviderRegistration.createJupyterServerCollection(
                    JVSC_EXTENSION_ID,
                    this.id,
                    this.displayName,
                    this
                )
            );
            this._register(commands.registerCommand('jupyter.meeshoConnect', this.meeshoConnect, this));
            console.log('MeeshoInhouseConnect: Activated successfully.');
        } catch (ex) {
            console.error('MeeshoInhouseConnect: Failed to activate', ex);
        }
    }

    private async meeshoConnect(): Promise<void> {
        console.log('Meesho Connect: Triggered');

        // 1. Try to get email for auto-start
        let email = this.accessService.getUserEmail();
        if (email) {
            console.log(`Meesho Connect: Found email in data.json: ${email}`);
        } else {
            console.log('Meesho Connect: Email not found in data.json, checking encrypted storage.');
            email = await this.encryptedStorage.retrieve('Meesho', 'UserEmail');
        }

        if (!email) {
            console.log('Meesho Connect: No email found in data.json or storage. Prompting user.');
            email = await window.showInputBox({
                prompt: 'Enter your Meesho email (to automatically start your server)',
                placeHolder: 'name.surname@meesho.com',
                ignoreFocusOut: true,
                validateInput: (v) =>
                    v.split('@')[1] === 'meesho.com' || v.split('@')[1] === 'meeshogcp.in'
                        ? null
                        : 'Please enter a valid Meesho email'
            });
            if (email) {
                console.log(`Meesho Connect: User provided email: ${email}`);
                void this.encryptedStorage.store('Meesho', 'UserEmail', email);
            } else {
                console.log('Meesho Connect: User cancelled email prompt.');
            }
        }

        let autoUrl: string | undefined;
        if (email) {
            console.log(`Meesho Connect: Starting automated process for ${email}.`);
            try {
                autoUrl = await this.getOrStartServer(email);
                if (autoUrl) {
                    console.log(`Meesho Connect: Automated process succeeded for ${email}. URL: ${autoUrl}`);
                    await this.connectToUrl(autoUrl);
                    return;
                } else {
                    console.log(
                        `Meesho Connect: Automated process did not return a URL for ${email} (possibly timed out or cancelled).`
                    );
                }
            } catch (err: any) {
                console.error(`Meesho Connect: Automated process for ${email} failed:`, err);
                window.showErrorMessage(`Failed to auto-start server for ${email}: ${err.message || err}`);
            }
        } else {
            console.log('Meesho Connect: No user email available. Skipping automated process.');
        }

        // 2. Fallback: prompt for URL
        // Only show if automated process didn't succeed
        if (!autoUrl) {
            console.log('Meesho Connect: Redirecting to manual URL entry.');
            const url = await window.showInputBox({
                prompt: 'Manual Fallback: Enter your Meesho Inhouse Notebook URL (with token)',
                placeHolder: 'https://inhouse-notebook.meeshogcp.in/user/your.name/lab?token=...',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    const parsed = parseUri(value);
                    if (!parsed) {
                        return 'Please enter a valid URL';
                    }
                    if (!parsed.token) {
                        return 'URL must include a ?token=... parameter';
                    }
                    return null;
                }
            });

            if (url) {
                await this.connectToUrl(url);
            }
        }
    }

    private async getOrStartServer(email: string): Promise<string | undefined> {
        return window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Meesho Inhouse Notebook: Checking server for ${email}`,
                cancellable: true
            },
            async (progress, token) => {
                const baseUrl = 'http://inhouse-notebook-api.prd.meesho.int:8085/api/v1/clients/users';
                const encodedEmail = encodeURIComponent(email);
                let startCalled = false;

                // Poll for up to 5 minutes
                for (let i = 0; i < 60; i++) {
                    if (token.isCancellationRequested) {
                        return undefined;
                    }

                    try {
                        console.log(`Meesho Connect: Polling status for ${email} (attempt ${i + 1})...`);
                        const response = await fetch(`${baseUrl}/${encodedEmail}`, {
                            headers: { accept: 'application/json' }
                        });

                        if (!response.ok) {
                            if (response.status === 404) {
                                throw new Error(`User ${email} not found in Meesho Inhouse Notebook system.`);
                            }
                            throw new Error(`API error: ${response.status}`);
                        }

                        const result = await response.json();
                        if (result.success === false) {
                            throw new Error(result.message || 'API request failed');
                        }

                        if (result.data) {
                            const status = result.data.status;
                            const url = result.data.user_server_url;

                            if (status === 'Running' && url) {
                                progress.report({ message: 'Server is running! Fetching kernels...' });
                                return url;
                            }

                            if (status === 'Terminated' && !startCalled) {
                                progress.report({ message: 'Server is terminated. Starting server...' });
                                const startResponse = await fetch(`${baseUrl}/${encodedEmail}/start`, {
                                    method: 'POST',
                                    headers: { accept: 'application/json' },
                                    body: ''
                                });
                                if (!startResponse.ok) {
                                    throw new Error(`Failed to start server: ${startResponse.status}`);
                                }
                                startCalled = true;
                            } else {
                                const waitMsg = startCalled
                                    ? 'Starting...'
                                    : status === 'Starting'
                                    ? 'Spinning up...'
                                    : 'Waiting...';
                                progress.report({ message: `Server status: ${status}. ${waitMsg}` });
                            }
                        } else {
                            progress.report({ message: 'Requesting server status...' });
                        }
                    } catch (err: any) {
                        console.error('Meesho Connect: Auto-start error', err);
                        if (err.message?.includes('not found')) {
                            throw err; // Don't retry if user not found
                        }
                        progress.report({ message: `Error: ${err.message || err}. Retrying...` });
                    }

                    await new Promise((resolve) => setTimeout(resolve, 5000));
                }

                window.showErrorMessage(
                    'Timed out waiting for Meesho server to start. Please try again or enter URL manually.'
                );
                return undefined;
            }
        );
    }

    private async isServerReachable(baseUrl: Uri, token: string, handle: string): Promise<boolean> {
        try {
            const serverUri: IJupyterServerUri = {
                baseUrl: baseUrl.toString(true),
                token: token,
                displayName: this.displayName
            };
            await this.jupyterConnection.validateRemoteUri(
                { id: this.id, handle, extensionId: JVSC_EXTENSION_ID },
                serverUri,
                true // doNotDisplayUnActionableMessages
            );
            return true;
        } catch (err) {
            console.warn('Meesho Connect: Reachability check failed', err);
            return false;
        }
    }

    private async connectToUrl(serverUrl: string): Promise<void> {
        try {
            console.log(`Meesho Connect: Processing URL ${serverUrl}`);
            const handle = await this.addServerToMappings(serverUrl);
            const info = this.handleMappings.get(handle)!;

            // Notify storage immediately so the extension knows about this server
            console.log(`Meesho Connect: Adding to server storage with handle ${handle}`);
            await this.serverUriStorage.add({ id: this.id, handle, extensionId: JVSC_EXTENSION_ID });

            // Save for next time
            void this.encryptedStorage.store('Meesho', 'LastServerUrl', serverUrl);

            // Fire event and wait a bit for the system to process the new server
            this._onDidChangeServers.fire();

            // Wait for the server to be "ready" in our own provider's view
            // This ensures that when the picker opens and calls provideJupyterServers, it gets the server.
            console.log('Meesho Connect: Waiting for server to be ready in provider view...');
            for (let i = 0; i < 15; i++) {
                const token = new CancellationTokenSource().token;
                const servers = await this.provideJupyterServers(token);
                if (servers.some((s) => s.id === handle)) {
                    console.log(`Meesho Connect: Server ${handle} is ready in provider after ${i * 100}ms.`);
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            // Final fire to be absolutely sure
            this._onDidChangeServers.fire();

            // Small delay to let the kernel finder catch up with the new server collection
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Trigger a refresh of the remote kernel finder (same as the refresh icon in the kernel picker).
            // This fetches kernel specs from the remote server so they appear in the picker.
            try {
                const serverProviderHandle = { id: this.id, handle, extensionId: JVSC_EXTENSION_ID };
                console.log('Meesho Connect: Refreshing remote kernel finder to fetch kernels...');
                const finder = this.remoteKernelFinderController.getOrCreateRemoteKernelFinder(
                    serverProviderHandle,
                    this.displayName
                );
                await finder.refresh();
                console.log('Meesho Connect: Remote kernel finder refreshed successfully.');
            } catch (refreshErr: any) {
                console.warn(
                    'Meesho Connect: Failed to refresh kernel finder, kernels may not appear immediately:',
                    refreshErr
                );
            }

            await this.openKernelPicker();

            // Background reachability check
            void this.isServerReachable(info.baseUrl, info.token, handle).then((isReachable) => {
                if (!isReachable) {
                    console.warn('Meesho Connect: Server added but seems unreachable in background check.');
                }
            });
        } catch (ex: any) {
            window.showErrorMessage(`Failed to connect: ${ex.message || ex}`);
        }
    }

    private async openKernelPicker() {
        // Trigger the kernel picker specifically for Meesho provider to skip intermediate steps
        console.log('Meesho Connect: Triggering jupyter.kernel.selectJupyterServerKernel');
        const controllerId = await commands.executeCommand<string>(
            'jupyter.kernel.selectJupyterServerKernel',
            JVSC_EXTENSION_ID,
            MeeshoKernelPickerProviderId
        );
        if (controllerId) {
            console.log(`Meesho Connect: Selected controller ${controllerId}. Applying...`);
            await commands.executeCommand('notebook.selectKernel', {
                id: controllerId,
                extension: JVSC_EXTENSION_ID
            });
        }
    }

    private async addServerToMappings(serverUrl: string): Promise<string> {
        const parsed = parseUri(serverUrl);
        if (!parsed) {
            throw new Error('Invalid URL');
        }

        const baseUrl = Uri.parse(parsed.baseUrl);
        const token = parsed.token || '';
        const handle = await computeHash(serverUrl, 'SHA-1');

        console.log(`Meesho Connect: Mapping handle ${handle} to ${parsed.baseUrl}`);
        this.handleMappings.set(handle, { baseUrl, token });
        return handle;
    }
}
