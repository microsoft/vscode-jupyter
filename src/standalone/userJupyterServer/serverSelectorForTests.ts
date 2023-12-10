// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, EventEmitter, Uri, commands } from 'vscode';
import { JVSC_EXTENSION_ID, TestingKernelPickerProviderId } from '../../platform/common/constants';
import { traceInfo } from '../../platform/logging';
import { IJupyterServerProviderRegistry, IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { computeHash } from '../../platform/common/crypto';
import { JupyterServer, JupyterServerProvider } from '../../api';
import { DisposableBase } from '../../platform/common/utils/lifecycle';

/**
 * Registers commands to allow the user to set the remote server URI.
 */
@injectable()
export class JupyterServerSelectorCommand
    extends DisposableBase
    implements IExtensionSyncActivationService, JupyterServerProvider
{
    private handleMappings = new Map<string, { uri: Uri; server: JupyterServer }>();
    private _onDidChangeHandles = this._register(new EventEmitter<void>());
    public readonly extensionId: string = JVSC_EXTENSION_ID;
    public readonly id = TestingKernelPickerProviderId;
    public readonly displayName = 'Jupyter Server for Testing';
    constructor(
        @inject(IJupyterServerProviderRegistry)
        private readonly uriProviderRegistration: IJupyterServerProviderRegistry,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage
    ) {
        super();
    }
    public readonly onDidChangeServers = this._onDidChangeHandles.event;
    async provideJupyterServers(_token: CancellationToken): Promise<JupyterServer[]> {
        return Array.from(this.handleMappings.values()).map((s) => s.server);
    }
    async resolveJupyterServer(server: JupyterServer, _token: CancellationToken): Promise<JupyterServer> {
        return server;
    }
    public activate() {
        this._register(
            this.uriProviderRegistration.createJupyterServerCollection(
                JVSC_EXTENSION_ID,
                this.id,
                this.displayName,
                this
            )
        );
        this._register(commands.registerCommand('jupyter.selectjupyteruri', this.selectJupyterUri, this));
    }
    private async selectJupyterUri(source: Uri): Promise<void> {
        traceInfo(`Setting Jupyter Server URI to remote: ${source}`);
        const uri = source.toString(true);
        const url = new URL(uri);
        const baseUrl = Uri.parse(`${url.protocol}//${url.host}${url.pathname === '/lab' ? '' : url.pathname}`);
        const token = url.searchParams.get('token') ?? '';
        const handle = await computeHash(source.toString(true), 'SHA-1');
        const serverUri: JupyterServer = {
            label: this.displayName,
            id: handle,
            connectionInformation: {
                baseUrl,
                token
            }
        };
        this.handleMappings.set(handle, { uri: source, server: serverUri });
        // Set the uri directly
        await this.serverUriStorage.add({ id: this.id, handle, extensionId: JVSC_EXTENSION_ID });
        this._onDidChangeHandles.fire();
    }
}
