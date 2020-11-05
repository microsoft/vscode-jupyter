// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IWorkspaceService } from '../../common/application/types';
import { IConfigurationService, IDisposableRegistry } from '../../common/types';
import { Identifiers } from '../../datascience/constants';
import { createRemoteConnectionInfo } from '../../datascience/jupyter/jupyterUtils';
import { JupyterServerSelector } from '../../datascience/jupyter/serverSelector';
import {
    IJupyterConnection,
    IJupyterServerUri,
    IJupyterUriProviderRegistration,
    INotebookServerOptions,
    JupyterServerUriHandle
} from '../../datascience/types';

let remoteConnections: IJupyterConnection[] = [];

@injectable()
export class RemoteJupyterConnectionsService implements IExtensionSingleActivationService {
    public get onDidAddServer(): Event<IJupyterConnection> {
        return this._onDidAddServer.event;
    }
    public get onDidRemoveServer(): Event<IJupyterConnection | undefined> {
        return this._onDidRemoveServer.event;
    }
    private readonly _onDidAddServer = new EventEmitter<IJupyterConnection>();
    private readonly _onDidRemoveServer = new EventEmitter<IJupyterConnection | undefined>();
    private uriToJupyterServerUri = new Map<string, IJupyterServerUri>();
    private pendingTimeouts: (NodeJS.Timeout | number)[] = [];
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector
    ) {
        disposables.push(this._onDidAddServer);
        disposables.push(this._onDidRemoveServer);
    }
    public async activate() {
        // Backwards compatibility (only used for interactive window & old notebooks).
        // Native notebooks will not store information in `jupyter.jupyterServerType`.
        this.workspace.onDidChangeConfiguration(
            (e) => {
                if (e.affectsConfiguration('jupyter.jupyterServerType', undefined)) {
                    // When server URI changes, clear our pending URI timeouts
                    this.clearTimeouts();
                }
            },
            this,
            this.disposables
        );
    }
    public dispose() {
        remoteConnections = [];
        this.clearTimeouts();
    }
    public async addServer(): Promise<void> {
        const selection = await this.serverSelector.selectJupyterURI(false);
        if (!selection?.uri) {
            return;
        }
        const options = await this.generateNotebookServerOptions(selection.uri);
        const connection = await this.getRemoteConnectionInfo(options);
        remoteConnections.push(connection);
        this._onDidAddServer.fire(connection);
    }
    public async logout(id: string): Promise<void> {
        const itemToRemove = remoteConnections.find((item) => item.id === id);
        remoteConnections = remoteConnections.filter((item) => item !== itemToRemove);
        this._onDidRemoveServer.fire(itemToRemove);
    }

    public async getRemoteConnectionInfo(options: INotebookServerOptions) {
        if (!options.uri) {
            throw new Error('Uri cannot be undefined');
        }
        await this.updateServerUri(options.uri);
        const getServerUri = (uri: string): IJupyterServerUri | undefined => {
            const idAndHandle = this.extractJupyterServerHandleAndId(uri);
            if (idAndHandle) {
                return this.uriToJupyterServerUri.get(uri);
            }
        };
        return createRemoteConnectionInfo(options.uri, getServerUri);
    }

    private clearTimeouts() {
        // tslint:disable-next-line: no-any
        this.pendingTimeouts.forEach((t) => clearTimeout(t as any));
        this.pendingTimeouts = [];
    }
    private async updateServerUri(uri: string): Promise<void> {
        const idAndHandle = this.extractJupyterServerHandleAndId(uri);
        if (idAndHandle) {
            const serverUri = await this.jupyterPickerRegistration.getJupyterServerUri(
                idAndHandle.id,
                idAndHandle.handle
            );
            this.uriToJupyterServerUri.set(uri, serverUri);
            // See if there's an expiration date
            if (serverUri.expiration) {
                const timeoutInMS = serverUri.expiration.getTime() - Date.now();
                // Week seems long enough (in case the expiration is ridiculous)
                if (timeoutInMS > 0 && timeoutInMS < 604800000) {
                    this.pendingTimeouts.push(setTimeout(() => this.updateServerUri(uri).ignoreErrors(), timeoutInMS));
                }
            }
        }
    }
    private extractJupyterServerHandleAndId(uri: string): { handle: JupyterServerUriHandle; id: string } | undefined {
        const url: URL = new URL(uri);

        // Id has to be there too.
        const id = url.searchParams.get(Identifiers.REMOTE_URI_ID_PARAM);
        const uriHandle = url.searchParams.get(Identifiers.REMOTE_URI_HANDLE_PARAM);
        return id && uriHandle ? { handle: uriHandle, id } : undefined;
    }

    private async generateNotebookServerOptions(serverUri: string): Promise<INotebookServerOptions & { uri: string }> {
        const useDefaultConfig: boolean | undefined = this.configuration.getSettings(undefined)
            .useDefaultConfigForJupyter;

        return {
            uri: serverUri,
            skipUsingDefaultConfig: !useDefaultConfig,
            purpose: Identifiers.HistoryPurpose,
            allowUI: () => true
        };
    }
}
