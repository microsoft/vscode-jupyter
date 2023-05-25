// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EventEmitter, Uri } from 'vscode';
import { ICommandManager } from '../../platform/common/application/types';
import { Commands } from '../../platform/common/constants';
import { traceInfo } from '../../platform/logging';
import { JupyterServerSelector } from '../../kernels/jupyter/connection/serverSelector';
import { IJupyterServerUri, IJupyterUriProvider, IJupyterUriProviderRegistration } from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { computeHash } from '../../platform/common/crypto';
import { Disposables } from '../../platform/common/utils';

/**
 * Registers commands to allow the user to set the remote server URI.
 */
@injectable()
export class JupyterServerSelectorCommand
    extends Disposables
    implements IExtensionSyncActivationService, IJupyterUriProvider
{
    private handleMappings = new Map<string, { uri: Uri; server: IJupyterServerUri }>();
    private _onDidChangeHandles = new EventEmitter<void>();
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector,
        @inject(IJupyterUriProviderRegistration)
        private readonly uriProviderRegistration: IJupyterUriProviderRegistration
    ) {
        super();
    }
    public readonly id = 'JupyterServerSelectorForTesting';
    public readonly displayName = 'Jupyter Server for Testing';
    public readonly onDidChangeHandles = this._onDidChangeHandles.event;
    public activate() {
        this.disposables.push(this.uriProviderRegistration.registerProvider(this));
        this.disposables.push(
            this.commandManager.registerCommand(Commands.SelectJupyterURI, this.selectJupyterUri, this)
        );
    }
    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        if (!this.handleMappings.has(handle)) {
            throw new Error(`Invalid handle ${handle}`);
        }
        return this.handleMappings.get(handle)!.server;
    }
    async getHandles(): Promise<string[]> {
        return Array.from(this.handleMappings.keys());
    }
    private async selectJupyterUri(source: Uri): Promise<void> {
        traceInfo(`Setting Jupyter Server URI to remote: ${source}`);
        const uri = source.toString(true);
        const url = new URL(uri);
        const baseUrl = `${url.protocol}//${url.host}${url.pathname === '/lab' ? '' : url.pathname}`;
        const token = url.searchParams.get('token') ?? '';
        const handle = await computeHash(source.toString(true), 'SHA-1');
        const serverUri: IJupyterServerUri = {
            baseUrl,
            displayName: this.displayName,
            token
        };
        this.handleMappings.set(handle, { uri: source, server: serverUri });
        // Set the uri directly
        await this.serverSelector.addJupyterServer({ id: this.id, handle });
        this._onDidChangeHandles.fire();
    }
}
