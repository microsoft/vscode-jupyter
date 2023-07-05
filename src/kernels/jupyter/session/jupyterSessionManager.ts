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
import { traceError, traceVerbose } from '../../../platform/logging';
import {
    IConfigurationService,
    IOutputChannel,
    Resource,
    IDisplayOptions,
    IDisposable
} from '../../../platform/common/types';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { createInterpreterKernelSpec } from '../../helpers';
import { IJupyterConnection, IJupyterKernelSpec, KernelActionSource, KernelConnectionMetadata } from '../../types';
import { JupyterKernelSpec } from '../jupyterKernelSpec';
import { OldJupyterSession } from './oldJupyterSession';
import { createDeferred, raceTimeout } from '../../../platform/common/utils/async';
import {
    IJupyterSessionManager,
    IJupyterKernel,
    IJupyterKernelService,
    IJupyterBackingFileCreator,
    IJupyterRequestCreator
} from '../types';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import type { ISpecModel } from '@jupyterlab/services/lib/kernelspec/kernelspec';
import { JupyterConnection } from '../connection/jupyterConnection';

/* eslint-disable @typescript-eslint/no-explicit-any */

export class JupyterSessionManager implements IJupyterSessionManager {
    private sessionManager: SessionManager | undefined;
    private specsManager: KernelSpecManager | undefined;
    private kernelManager: KernelManager | undefined;
    private contentsManager: ContentsManager | undefined;
    private connInfo: IJupyterConnection | undefined;
    private serverSettings: ServerConnection.ISettings | undefined;
    private _jupyterlab?: typeof import('@jupyterlab/services');
    private disposed?: boolean;
    public get isDisposed() {
        return this.disposed === true;
    }
    private get jupyterlab(): typeof import('@jupyterlab/services') {
        if (!this._jupyterlab) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this._jupyterlab = require('@jupyterlab/services');
        }
        return this._jupyterlab!;
    }
    constructor(
        _config: IConfigurationService,
        private outputChannel: IOutputChannel,
        private configService: IConfigurationService,
        private readonly kernelService: IJupyterKernelService | undefined,
        private readonly backingFileCreator: IJupyterBackingFileCreator,
        private readonly requestCreator: IJupyterRequestCreator,
        private readonly jupyterConnection: JupyterConnection
    ) {}

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
                await raceTimeout(10_000, this.sessionManager.ready);

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
        this.serverSettings = await this.jupyterConnection.getServerConnectSettings(connInfo);
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
    ): Promise<OldJupyterSession> {
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
        const session = new OldJupyterSession(
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
            this.backingFileCreator,
            this.requestCreator,
            creator
        );
        try {
            await session.connect({ token: cancelToken, ui });
        } finally {
            if (!session.isConnected) {
                await session.disposeAsync();
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
            await raceTimeout(10_000, this.sessionManager.ready);
            telemetryProperties.sessionManagerReady = this.sessionManager.isReady;
            // Ask the session manager to refresh its list of kernel specs. This might never
            // come back so only wait for ten seconds.
            await raceTimeout(10_000, specsManager.refreshSpecs());
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
                await raceTimeout(10_000, allPromises);
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
}
