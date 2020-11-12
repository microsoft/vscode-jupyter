// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ServerConnection } from '@jupyterlab/services';
import { Agent as HttpsAgent } from 'https';
import { inject, injectable, named } from 'inversify';
import * as nodeFetch from 'node-fetch';
import { Event, EventEmitter, Uri } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IApplicationShell, IWorkspaceService } from '../../common/application/types';
import { Experiments } from '../../common/experiments/groups';
import { traceInfo } from '../../common/logger';
import {
    IConfigurationService,
    IDisposableRegistry,
    IExperimentService,
    IOutputChannel,
    IPersistentState,
    IPersistentStateFactory
} from '../../common/types';
import { Common, DataScience } from '../../common/utils/localize';
import { Identifiers, JUPYTER_OUTPUT_CHANNEL } from '../../datascience/constants';
import { createAuthorizingRequest } from '../../datascience/jupyter/jupyterRequest';
import { JupyterSessionManager } from '../../datascience/jupyter/jupyterSessionManager';
import { createRemoteConnectionInfo } from '../../datascience/jupyter/jupyterUtils';
import { createJupyterWebSocket } from '../../datascience/jupyter/jupyterWebSocket';
import { JupyterServerPicker } from '../../datascience/jupyter/serverPicker';
import {
    IJupyterConnection,
    IJupyterPasswordConnect,
    IJupyterServerUri,
    IJupyterUriProviderRegistration,
    INotebookServerOptions,
    JupyterServerUriHandle
} from '../../datascience/types';
import { IJupyterServerConnectionService, JupyterServerConnection } from '../ui/types';
import { RemoteFileSchemeManager } from './fileSchemeManager';

// tslint:disable: unified-signatures

// Key for our insecure connection global state
export const GlobalStateUserAllowsInsecureConnections = 'DataScienceAllowInsecureConnections';

type ConnectionInfo = {
    settings: ServerConnection.ISettings;
    connection: IJupyterConnection;
    fileScheme: string;
};

const remoteConnections = new Map<string, ConnectionInfo>();

export function getRemoteConnection(id: string): ConnectionInfo | undefined {
    return remoteConnections.get(id);
}

@injectable()
export class JupyterServerConnectionService
    implements IJupyterServerConnectionService, IExtensionSingleActivationService {
    public get onDidAddServer(): Event<JupyterServerConnection> {
        return this._onDidAddServer.event;
    }
    public get onDidRemoveServer(): Event<JupyterServerConnection | undefined> {
        return this._onDidRemoveServer.event;
    }
    private get jupyterlab(): typeof import('@jupyterlab/services') {
        if (!this._jupyterlab) {
            // tslint:disable-next-line: no-require-imports
            this._jupyterlab = require('@jupyterlab/services');
        }
        return this._jupyterlab!;
    }
    private static secureServers = new Map<string, Promise<boolean>>();
    private readonly userAllowsInsecureConnections: IPersistentState<boolean>;
    private _jupyterlab?: typeof import('@jupyterlab/services');
    private readonly _onDidAddServer = new EventEmitter<JupyterServerConnection>();
    private readonly _onDidRemoveServer = new EventEmitter<JupyterServerConnection | undefined>();
    private uriToJupyterServerUri = new Map<string, IJupyterServerUri>();
    private pendingTimeouts: (NodeJS.Timeout | number)[] = [];
    private _isRemoteExperimentEnabled?: boolean;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IJupyterPasswordConnect) private jupyterPasswordConnect: IJupyterPasswordConnect,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(JupyterServerPicker) private readonly serverPicker: JupyterServerPicker,
        @inject(RemoteFileSchemeManager) private readonly fileSchemeManager: RemoteFileSchemeManager,
        @inject(IPersistentStateFactory) private readonly stateFactory: IPersistentStateFactory,
        @inject(IOutputChannel) @named(JUPYTER_OUTPUT_CHANNEL) private readonly jupyterOutput: IOutputChannel,
        @inject(IExperimentService) private readonly experiment: IExperimentService
    ) {
        this.userAllowsInsecureConnections = this.stateFactory.createGlobalPersistentState<boolean>(
            GlobalStateUserAllowsInsecureConnections,
            false
        );
        disposables.push(this._onDidAddServer);
        disposables.push(this._onDidRemoveServer);
    }
    public async getConnections(): Promise<JupyterServerConnection[]> {
        return Array.from(remoteConnections.keys()).map((id) => {
            return {
                id,
                displayName: remoteConnections.get(id)!.connection.displayName,
                fileScheme: remoteConnections.get(id)!.fileScheme
            };
        });
    }
    public async selectConnection(): Promise<JupyterServerConnection | undefined> {
        const connections = await this.getConnections();
        if (connections.length === 0) {
            return;
        }
        if (connections.length === 1) {
            return connections[0];
        }
        const list = connections.map((item) => {
            return {
                label: item.displayName,
                item
            };
        });

        const selection = await this.appShell.showQuickPick(list, {
            canPickMany: false,
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: DataScience.quickPickPlaceHolderLabelForSelectionOfNotebookCreationServer()
        });
        return selection?.item;
    }
    public get isRemoteExperimentEnabled() {
        if (typeof this._isRemoteExperimentEnabled !== 'boolean') {
            throw new Error('We should not be calling isRemoteExperimentEnabled in ctors or the like');
        }
        return this._isRemoteExperimentEnabled;
    }

    public findConnection(remoteUri: Uri): ConnectionInfo | undefined;
    public findConnection(jupyterConnectionId: string): ConnectionInfo | undefined;
    public findConnection(idOrRemoteUri: Uri | string): ConnectionInfo | undefined {
        const connectionId =
            typeof idOrRemoteUri === 'string'
                ? idOrRemoteUri
                : Array.from(remoteConnections.keys()).find((id) => {
                      const item = remoteConnections.get(id)!;
                      return item.fileScheme === idOrRemoteUri.scheme;
                  });

        return connectionId ? remoteConnections.get(connectionId) : undefined;
    }
    public isConnected(remoteFileUri: Uri): boolean {
        return Array.from(remoteConnections.values()).some((item) => item.fileScheme === remoteFileUri.scheme);
    }
    public async activate() {
        // This slows down loading of extension.
        this._isRemoteExperimentEnabled = await this.experiment.inExperiment(Experiments.NativeNotebook);
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
        remoteConnections.clear();
        this.clearTimeouts();
    }
    public async addServer(baseUrl?: string): Promise<void> {
        // Check if we have already added this.
        const connections = await this.getConnections();
        if (
            baseUrl &&
            connections.some((item) => {
                const conn = this.findConnection(item.id);
                if (!conn) {
                    return false;
                }
                return conn.connection.baseUrl.toLowerCase().startsWith(baseUrl!.toLowerCase());
            })
        ) {
            return;
        }

        if (!baseUrl) {
            const selection = await this.serverPicker.selectJupyterURI(false);
            if (selection?.selection !== 'remote') {
                return;
            }
            baseUrl = selection.uri;
        }
        const options = await this.generateNotebookServerOptions(baseUrl);
        const connection = await this.getRemoteConnectionInfo(options);
        const [settings, fileScheme] = await Promise.all([
            this.getServerConnectSettings(connection),
            this.fileSchemeManager.getFileScheme(connection)
        ]);
        this.trackServer(connection, settings, fileScheme);
        this._onDidAddServer.fire({ id: connection.id, displayName: connection.displayName, fileScheme });
    }
    public logout(id: string): void {
        const info = remoteConnections.get(id);
        remoteConnections.delete(id);
        if (info) {
            this._onDidRemoveServer.fire({
                id: info.connection.id,
                displayName: info.connection.displayName,
                fileScheme: info.fileScheme
            });
        } else {
            this._onDidRemoveServer.fire(undefined);
        }
    }
    public async createConnectionManager(id: string | IJupyterConnection): Promise<JupyterSessionManager> {
        const connectionId = typeof id === 'string' ? id : id.id;
        if (!remoteConnections.has(connectionId)) {
            throw new Error('Remote Server Not found');
        }
        const { connection, settings } = remoteConnections.get(connectionId)!;
        return new JupyterSessionManager(connection, settings, this.jupyterOutput, this.configuration);
    }

    public async getRemoteConnectionInfo(options: INotebookServerOptions): Promise<IJupyterConnection> {
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

    /**
     * Used by interactive & webview based notebooks.
     * If this gets called then automatically add that server to the list.
     */
    public async getServerConnectSettings(
        connection: IJupyterConnection,
        failOnPassword?: boolean
    ): Promise<ServerConnection.ISettings> {
        const settings = await this.getServerConnectSettingsInternal(connection, failOnPassword);
        if (this._isRemoteExperimentEnabled && !connection.localLaunch) {
            // Automatically add this to the remote file system.
            const fileScheme = await this.fileSchemeManager.getFileScheme(connection);
            this.trackServer(connection, settings, fileScheme);
        }
        return settings;
    }

    // If connecting on HTTP without a token prompt the user that this connection may not be secure
    private async insecureServerWarningPrompt(): Promise<boolean> {
        const insecureMessage = DataScience.insecureSessionMessage();
        const insecureLabels = [Common.bannerLabelYes(), Common.bannerLabelNo(), Common.doNotShowAgain()];
        const response = await this.appShell.showWarningMessage(insecureMessage, ...insecureLabels);

        switch (response) {
            case Common.bannerLabelYes():
                // On yes just proceed as normal
                return true;

            case Common.doNotShowAgain():
                // For don't ask again turn on the global true
                await this.userAllowsInsecureConnections.updateValue(true);
                return true;

            case Common.bannerLabelNo():
            default:
                // No or for no choice return back false to block
                return false;
        }
    }
    // Check if our server connection is considered secure. If it is not, ask the user if they want to connect
    // If not, throw to bail out on the process
    private async secureConnectionCheck(connInfo: IJupyterConnection): Promise<void> {
        // If they have turned on global server trust then everything is secure
        if (this.userAllowsInsecureConnections.value) {
            return;
        }

        // If they are local launch, https, or have a token, then they are secure
        if (connInfo.localLaunch || connInfo.baseUrl.startsWith('https') || connInfo.token !== 'null') {
            return;
        }

        // At this point prompt the user, cache the promise so we don't ask multiple times for the same server
        let serverSecurePromise = JupyterServerConnectionService.secureServers.get(connInfo.baseUrl);

        if (serverSecurePromise === undefined) {
            serverSecurePromise = this.insecureServerWarningPrompt();
            JupyterServerConnectionService.secureServers.set(connInfo.baseUrl, serverSecurePromise);
        }

        // If our server is not secure, throw here to bail out on the process
        if (!(await serverSecurePromise)) {
            throw new Error(DataScience.insecureSessionDenied());
        }
    }
    private async getServerConnectSettingsInternal(
        connInfo: IJupyterConnection,
        failOnPassword?: boolean
    ): Promise<ServerConnection.ISettings> {
        let serverSettings: Partial<ServerConnection.ISettings> = {
            baseUrl: connInfo.baseUrl,
            appUrl: '',
            // A web socket is required to allow token authentication
            wsUrl: connInfo.baseUrl.replace('http', 'ws')
        };

        // Before we connect, see if we are trying to make an insecure connection, if we are, warn the user
        await this.secureConnectionCheck(connInfo);

        // Agent is allowed to be set on this object, but ts doesn't like it on RequestInit, so any
        // tslint:disable-next-line:no-any
        let requestInit: any = { cache: 'no-store', credentials: 'same-origin' };
        let cookieString;
        // tslint:disable-next-line: no-any
        let requestCtor: any = nodeFetch.Request;

        // If authorization header is provided, then we need to prevent jupyterlab services from
        // writing the authorization header.
        if (connInfo.getAuthHeader) {
            requestCtor = createAuthorizingRequest(connInfo.getAuthHeader);
        }

        // If no token is specified prompt for a password
        if ((connInfo.token === '' || connInfo.token === 'null') && !connInfo.getAuthHeader) {
            if (failOnPassword) {
                throw new Error('Password request not allowed.');
            }
            serverSettings = { ...serverSettings, token: '' };
            const pwSettings = await this.jupyterPasswordConnect.getPasswordConnectionInfo(connInfo.baseUrl);
            if (pwSettings && pwSettings.requestHeaders) {
                requestInit = { ...requestInit, headers: pwSettings.requestHeaders };
                // tslint:disable-next-line: no-any
                cookieString = (pwSettings.requestHeaders as any).Cookie || '';

                // Password may have overwritten the base url and token as well
                if (pwSettings.remappedBaseUrl) {
                    // tslint:disable-next-line: no-any
                    (serverSettings as any).baseUrl = pwSettings.remappedBaseUrl;
                    // tslint:disable-next-line: no-any
                    (serverSettings as any).wsUrl = pwSettings.remappedBaseUrl.replace('http', 'ws');
                }
                if (pwSettings.remappedToken) {
                    // tslint:disable-next-line: no-any
                    (serverSettings as any).token = pwSettings.remappedToken;
                }
            } else if (pwSettings) {
                serverSettings = { ...serverSettings, token: connInfo.token };
            } else {
                // Failed to get password info, notify the user
                throw new Error(DataScience.passwordFailure());
            }
        } else {
            serverSettings = { ...serverSettings, token: connInfo.token };
        }

        const allowUnauthorized = this.configuration.getSettings(undefined).allowUnauthorizedRemoteConnection;
        // If this is an https connection and we want to allow unauthorized connections set that option on our agent
        // we don't need to save the agent as the previous behaviour is just to create a temporary default agent when not specified
        if (connInfo.baseUrl.startsWith('https') && allowUnauthorized) {
            const requestAgent = new HttpsAgent({ rejectUnauthorized: false });
            requestInit = { ...requestInit, agent: requestAgent };
        }

        // This replaces the WebSocket constructor in jupyter lab services with our own implementation
        // See _createSocket here:
        // https://github.com/jupyterlab/jupyterlab/blob/cfc8ebda95e882b4ed2eefd54863bb8cdb0ab763/packages/services/src/kernel/default.ts
        serverSettings = {
            ...serverSettings,
            init: requestInit,
            WebSocket: createJupyterWebSocket(
                cookieString,
                allowUnauthorized,
                connInfo.getAuthHeader
                // tslint:disable-next-line:no-any
            ) as any,
            // Redefine fetch to our node-modules so it picks up the correct version.
            // Typecasting as any works fine as long as all 3 of these are the same version
            // tslint:disable-next-line:no-any
            fetch: nodeFetch.default as any,
            // tslint:disable-next-line:no-any
            Request: requestCtor,
            // tslint:disable-next-line:no-any
            Headers: nodeFetch.Headers as any
        };

        traceInfo(`Creating server with settings : ${JSON.stringify(serverSettings)}`);
        return this.jupyterlab.ServerConnection.makeSettings(serverSettings);
    }
    private trackServer(connection: IJupyterConnection, settings: ServerConnection.ISettings, fileScheme: string) {
        remoteConnections.set(connection.id, { connection, settings, fileScheme });
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
