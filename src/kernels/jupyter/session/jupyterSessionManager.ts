// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ContentsManager,
    KernelSpecManager,
    KernelManager,
    ServerConnection,
    Session,
    SessionManager
} from '@jupyterlab/services';
import { JSONObject } from '@lumino/coreutils';
import { CancellationToken, Disposable, Uri } from 'vscode';
import { IApplicationShell } from '../../../platform/common/application/types';
import { traceError, traceVerbose } from '../../../platform/logging';
import {
    IPersistentState,
    IConfigurationService,
    IOutputChannel,
    IPersistentStateFactory,
    Resource,
    IDisplayOptions,
    IDisposable
} from '../../../platform/common/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { createInterpreterKernelSpec } from '../../helpers';
import { IJupyterConnection, IJupyterKernelSpec, KernelActionSource, KernelConnectionMetadata } from '../../types';
import { JupyterKernelSpec } from '../jupyterKernelSpec';
import { JupyterSession } from './jupyterSession';
import { createDeferred, sleep } from '../../../platform/common/utils/async';
import {
    IJupyterSessionManager,
    IJupyterPasswordConnect,
    IJupyterKernel,
    IJupyterKernelService,
    IJupyterBackingFileCreator,
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator
} from '../types';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import type { ISpecModel } from '@jupyterlab/services/lib/kernelspec/kernelspec';
import { JupyterInvalidPasswordError } from '../../errors/jupyterInvalidPassword';

// Key for our insecure connection global state
const GlobalStateUserAllowsInsecureConnections = 'DataScienceAllowInsecureConnections';

/* eslint-disable @typescript-eslint/no-explicit-any */

export class JupyterSessionManager implements IJupyterSessionManager {
    private static secureServers = new Map<string, Promise<boolean>>();
    private sessionManager: SessionManager | undefined;
    private specsManager: KernelSpecManager | undefined;
    private kernelManager: KernelManager | undefined;
    private contentsManager: ContentsManager | undefined;
    private connInfo: IJupyterConnection | undefined;
    private serverSettings: ServerConnection.ISettings | undefined;
    private _jupyterlab?: typeof import('@jupyterlab/services');
    private readonly userAllowsInsecureConnections: IPersistentState<boolean>;
    private disposed?: boolean;
    private get jupyterlab(): typeof import('@jupyterlab/services') {
        if (!this._jupyterlab) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this._jupyterlab = require('@jupyterlab/services');
        }
        return this._jupyterlab!;
    }
    constructor(
        private jupyterPasswordConnect: IJupyterPasswordConnect,
        _config: IConfigurationService,
        private failOnPassword: boolean | undefined,
        private outputChannel: IOutputChannel,
        private configService: IConfigurationService,
        private readonly appShell: IApplicationShell,
        private readonly stateFactory: IPersistentStateFactory,
        private readonly kernelService: IJupyterKernelService | undefined,
        private readonly backingFileCreator: IJupyterBackingFileCreator,
        private readonly requestAgentCreator: IJupyterRequestAgentCreator | undefined,
        private readonly requestCreator: IJupyterRequestCreator
    ) {
        this.userAllowsInsecureConnections = this.stateFactory.createGlobalPersistentState<boolean>(
            GlobalStateUserAllowsInsecureConnections,
            false
        );
    }

    public async dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        traceVerbose(`Disposing session manager`);
        try {
            if (this.contentsManager) {
                traceVerbose('SessionManager - dispose contents manager');
                this.contentsManager.dispose();
                this.contentsManager = undefined;
            }
            if (this.sessionManager && !this.sessionManager.isDisposed) {
                traceVerbose('ShutdownSessionAndConnection - dispose session manager');
                // Make sure it finishes startup.
                await Promise.race([sleep(10_000), this.sessionManager.ready]);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.sessionManager.dispose(); // Note, shutting down all will kill all kernels on the same connection. We don't want that.
                this.sessionManager = undefined;
            }
            if (!this.kernelManager?.isDisposed) {
                this.kernelManager?.dispose();
            }
            if (!this.specsManager?.isDisposed) {
                this.specsManager?.dispose();
                this.specsManager = undefined;
            }
        } catch (e) {
            traceError(`Exception on session manager shutdown: `, e);
        } finally {
            traceVerbose('Finished disposing jupyter session manager');
        }
    }

    public async initialize(connInfo: IJupyterConnection): Promise<void> {
        this.connInfo = connInfo;
        this.serverSettings = await this.getServerConnectSettings(connInfo);
        traceError('Connecting to jupyter server', JSON.stringify(this.serverSettings));
        this.specsManager = new this.jupyterlab.KernelSpecManager({ serverSettings: this.serverSettings });
        this.kernelManager = new this.jupyterlab.KernelManager({ serverSettings: this.serverSettings });
        this.sessionManager = new this.jupyterlab.SessionManager({
            serverSettings: this.serverSettings,
            kernelManager: this.kernelManager
        });
        this.contentsManager = new this.jupyterlab.ContentsManager({ serverSettings: this.serverSettings });
    }

    public async getRunningSessions(): Promise<Session.IModel[]> {
        if (!this.sessionManager) {
            return [];
        }
        // Not refreshing will result in `running` returning an empty iterator.
        await this.sessionManager.refreshRunning();

        const sessions: Session.IModel[] = [];
        const iterator = this.sessionManager.running();
        let session = iterator.next();

        while (session) {
            sessions.push(session);
            session = iterator.next();
        }

        return sessions;
    }

    public async getRunningKernels(): Promise<IJupyterKernel[]> {
        const models = await this.jupyterlab.KernelAPI.listRunning(this.serverSettings);
        // Remove duplicates.
        const dup = new Set<string>();
        return models
            .map((m) => {
                const jsonObject: JSONObject = m as any;
                return {
                    id: m.id,
                    name: m.name,
                    lastActivityTime: jsonObject.last_activity
                        ? new Date(Date.parse(jsonObject.last_activity.toString()))
                        : new Date(),
                    numberOfConnections: jsonObject.connections ? parseInt(jsonObject.connections.toString(), 10) : 0
                };
            })
            .filter((item) => {
                if (dup.has(item.id)) {
                    return false;
                }
                dup.add(item.id);
                return true;
            });
    }

    public async startNew(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        workingDirectory: Uri,
        ui: IDisplayOptions,
        cancelToken: CancellationToken,
        creator: KernelActionSource
    ): Promise<JupyterSession> {
        if (
            !this.connInfo ||
            !this.sessionManager ||
            !this.contentsManager ||
            !this.serverSettings ||
            !this.specsManager
        ) {
            throw new SessionDisposedError();
        }
        // Create a new session and attempt to connect to it
        const session = new JupyterSession(
            resource,
            this.connInfo,
            kernelConnection,
            this.specsManager,
            this.sessionManager,
            this.contentsManager,
            this.outputChannel,
            workingDirectory,
            this.configService.getSettings(resource).jupyterLaunchTimeout,
            this.kernelService,
            this.configService.getSettings(resource).jupyterInterruptTimeout,
            this.backingFileCreator,
            this.requestCreator,
            creator
        );
        try {
            await session.connect({ token: cancelToken, ui });
        } finally {
            if (!session.isConnected) {
                await session.dispose();
            }
        }
        return session;
    }

    public async getKernelSpecs(): Promise<IJupyterKernelSpec[]> {
        if (!this.connInfo || !this.sessionManager || !this.contentsManager) {
            throw new SessionDisposedError();
        }
        try {
            const stopWatch = new StopWatch();
            const specsManager = this.specsManager;
            if (!specsManager) {
                traceError(
                    `No SessionManager to enumerate kernelspecs (no specs manager). Returning a default kernel. Specs ${JSON.stringify(
                        this.specsManager?.specs?.kernelspecs || {}
                    )}.`
                );
                sendTelemetryEvent(Telemetry.JupyterKernelSpecEnumeration, undefined, {
                    failed: true,
                    reason: 'NoSpecsManager'
                });
                // If for some reason the session manager refuses to communicate, fall
                // back to a default. This may not exist, but it's likely.
                return [await createInterpreterKernelSpec()];
            }
            const telemetryProperties = {
                wasSessionManagerReady: this.sessionManager.isReady,
                wasSpecsManagerReady: specsManager.isReady,
                sessionManagerReady: this.sessionManager.isReady,
                specsManagerReady: specsManager.isReady,
                waitedForChangeEvent: false
            };
            const getKernelSpecs = (defaultValue: Record<string, ISpecModel | undefined> = {}) => {
                return specsManager.specs && Object.keys(specsManager.specs.kernelspecs).length
                    ? specsManager.specs.kernelspecs
                    : defaultValue;
            };

            // Fetch the list the session manager already knows about. Refreshing may not work or could be very slow.
            const oldKernelSpecs = getKernelSpecs();

            // Wait for the session to be ready
            await Promise.race([sleep(10_000), this.sessionManager.ready]);
            telemetryProperties.sessionManagerReady = this.sessionManager.isReady;
            // Ask the session manager to refresh its list of kernel specs. This might never
            // come back so only wait for ten seconds.
            await Promise.race([sleep(10_000), specsManager.refreshSpecs()]);
            telemetryProperties.specsManagerReady = specsManager.isReady;

            let telemetrySent = false;
            if (specsManager && Object.keys(specsManager.specs?.kernelspecs || {}).length === 0) {
                // At this point wait for the specs to change
                const disposables: IDisposable[] = [];
                const promise = createDeferred();
                const resolve = promise.resolve.bind(promise);
                specsManager.specsChanged.connect(resolve);
                disposables.push(new Disposable(() => specsManager.specsChanged.disconnect(resolve)));
                const allPromises = Promise.all([
                    promise.promise,
                    specsManager.ready,
                    specsManager.refreshSpecs(),
                    this.sessionManager.ready
                ]);
                await Promise.race([sleep(10_000), allPromises]);
                telemetryProperties.waitedForChangeEvent = true;
                if (!promise.completed) {
                    telemetrySent = true;
                    sendTelemetryEvent(Telemetry.JupyterKernelSpecEnumeration, undefined, {
                        failed: true,
                        sessionManagerReady: this.sessionManager.isReady,
                        specsManagerReady: specsManager.isReady,
                        reason: specsManager.isReady
                            ? this.sessionManager.isReady
                                ? 'SpecsDidNotChangeInTime'
                                : 'SessionManagerIsNotReady'
                            : 'SpecManagerIsNotReady'
                    });
                }
                disposeAllDisposables(disposables);
            }

            const kernelspecs = getKernelSpecs(oldKernelSpecs);
            if (Object.keys(kernelspecs || {}).length) {
                const specs: IJupyterKernelSpec[] = [];
                Object.entries(kernelspecs).forEach(([_key, value]) => {
                    if (value) {
                        specs.push(new JupyterKernelSpec(value));
                    }
                });
                sendTelemetryEvent(
                    Telemetry.JupyterKernelSpecEnumeration,
                    { duration: stopWatch.elapsedTime },
                    telemetryProperties
                );
                return specs;
            } else {
                traceError(
                    `SessionManager cannot enumerate kernelspecs. Returning a default kernel. Specs ${JSON.stringify(
                        kernelspecs
                    )}.`
                );
                if (!telemetrySent) {
                    sendTelemetryEvent(Telemetry.JupyterKernelSpecEnumeration, undefined, {
                        failed: true,
                        reason: 'NoSpecsEventAfterRefresh'
                    });
                }
                // If for some reason the session manager refuses to communicate, fall
                // back to a default. This may not exist, but it's likely.
                return [await createInterpreterKernelSpec()];
            }
        } catch (e) {
            traceError(`SessionManager:getKernelSpecs failure: `, e);
            // For some reason this is failing. Just return nothing
            return [];
        }
    }

    private async getServerConnectSettings(connInfo: IJupyterConnection): Promise<ServerConnection.ISettings> {
        traceError('getServerConnectSettings', JSON.stringify(connInfo));
        let serverSettings: Partial<ServerConnection.ISettings> = {
            baseUrl: connInfo.baseUrl,
            appUrl: '',
            // A web socket is required to allow token authentication
            wsUrl: connInfo.baseUrl.replace('http', 'ws')
        };

        // Before we connect, see if we are trying to make an insecure connection, if we are, warn the user
        await this.secureConnectionCheck(connInfo);

        // Agent is allowed to be set on this object, but ts doesn't like it on RequestInit, so any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let requestInit: any = this.requestCreator.getRequestInit();
        let cookieString;

        // If no token is specified prompt for a password
        traceError('connInfo.token', `"${connInfo.token}"`);
        if ((connInfo.token === '' || connInfo.token === 'null') && !connInfo.getAuthHeader) {
            if (this.failOnPassword) {
                throw new Error('Password request not allowed.');
            }
            serverSettings = { ...serverSettings, token: '' };
            const pwSettings = await this.jupyterPasswordConnect.getPasswordConnectionInfo(connInfo.baseUrl);
            if (pwSettings && pwSettings.requestHeaders) {
                traceError('pwSettings & pwSettings.requestHeaders', JSON.stringify(pwSettings));
                requestInit = { ...requestInit, headers: pwSettings.requestHeaders };
                cookieString = (pwSettings.requestHeaders as any).Cookie || '';

                // Password may have overwritten the base url and token as well
                if (pwSettings.remappedBaseUrl) {
                    (serverSettings as any).baseUrl = pwSettings.remappedBaseUrl;
                    (serverSettings as any).wsUrl = pwSettings.remappedBaseUrl.replace('http', 'ws');
                }
                if (pwSettings.remappedToken) {
                    (serverSettings as any).token = pwSettings.remappedToken;
                }
            } else if (pwSettings) {
                serverSettings = { ...serverSettings, token: connInfo.token };
                traceError('pwSettings', JSON.stringify(pwSettings));
                traceError('serverSettings', JSON.stringify(serverSettings));
            } else {
                throw new JupyterInvalidPasswordError();
            }
        } else {
            serverSettings = { ...serverSettings, token: connInfo.token, appendToken: true };
            traceError('serverSettings', JSON.stringify(serverSettings));
        }

        const allowUnauthorized = this.configService.getSettings(undefined).allowUnauthorizedRemoteConnection;
        // If this is an https connection and we want to allow unauthorized connections set that option on our agent
        // we don't need to save the agent as the previous behaviour is just to create a temporary default agent when not specified
        if (connInfo.baseUrl.startsWith('https') && allowUnauthorized && this.requestAgentCreator) {
            const requestAgent = this.requestAgentCreator.createHttpRequestAgent();
            requestInit = { ...requestInit, agent: requestAgent };
            traceError('allowUnauthorized', JSON.stringify(requestInit));
        }

        // This replaces the WebSocket constructor in jupyter lab services with our own implementation
        // See _createSocket here:
        // https://github.com/jupyterlab/jupyterlab/blob/cfc8ebda95e882b4ed2eefd54863bb8cdb0ab763/packages/services/src/kernel/default.ts
        serverSettings = {
            ...serverSettings,
            init: requestInit,
            WebSocket: this.requestCreator.getWebsocketCtor(
                cookieString,
                allowUnauthorized,
                connInfo.getAuthHeader,
                connInfo.getWebsocketProtocols?.bind(connInfo)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ) as any,
            fetch: this.requestCreator.getFetchMethod(),
            Request: this.requestCreator.getRequestCtor(cookieString, allowUnauthorized, connInfo.getAuthHeader),
            Headers: this.requestCreator.getHeadersCtor()
        };
        traceError('serverSettings', JSON.stringify(serverSettings));
        const settings = this.jupyterlab.ServerConnection.makeSettings(serverSettings);
        traceError('settings', JSON.stringify(settings));
        return settings;
    }

    // If connecting on HTTP without a token prompt the user that this connection may not be secure
    private async insecureServerWarningPrompt(): Promise<boolean> {
        const insecureMessage = DataScience.insecureSessionMessage;
        const insecureLabels = [Common.bannerLabelYes, Common.bannerLabelNo, Common.doNotShowAgain];
        const response = await this.appShell.showWarningMessage(insecureMessage, ...insecureLabels);

        switch (response) {
            case Common.bannerLabelYes:
                // On yes just proceed as normal
                return true;

            case Common.doNotShowAgain:
                // For don't ask again turn on the global true
                await this.userAllowsInsecureConnections.updateValue(true);
                return true;

            case Common.bannerLabelNo:
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
        const isEmptyToken = connInfo.token === '' || connInfo.token === 'null';
        if (connInfo.localLaunch || connInfo.baseUrl.startsWith('https') || !isEmptyToken) {
            return;
        }

        // At this point prompt the user, cache the promise so we don't ask multiple times for the same server
        let serverSecurePromise = JupyterSessionManager.secureServers.get(connInfo.baseUrl);

        if (serverSecurePromise === undefined) {
            if (connInfo.serverId && !connInfo.serverId.startsWith('_builtin')) {
                // If a Jupyter URI provider is providing this URI, then we trust it.
                serverSecurePromise = Promise.resolve(true);
                JupyterSessionManager.secureServers.set(connInfo.baseUrl, serverSecurePromise);
            } else {
                serverSecurePromise = this.insecureServerWarningPrompt();
                JupyterSessionManager.secureServers.set(connInfo.baseUrl, serverSecurePromise);
            }
        }

        // If our server is not secure, throw here to bail out on the process
        if (!(await serverSecurePromise)) {
            throw new Error(DataScience.insecureSessionDenied);
        }
    }
}
