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
import { Disposable } from 'vscode';
import { logger } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { createInterpreterKernelSpec } from '../../helpers';
import { IJupyterKernelSpec } from '../../types';
import { JupyterKernelSpec } from '../jupyterKernelSpec';
import { createDeferred, raceTimeout } from '../../../platform/common/utils/async';
import { IJupyterKernel } from '../types';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { ObservableDisposable, dispose } from '../../../platform/common/utils/lifecycle';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import type { ISpecModel } from '@jupyterlab/services/lib/kernelspec/kernelspec';
import { noop } from '../../../platform/common/utils/misc';

export class JupyterLabHelper extends ObservableDisposable {
    public sessionManager: SessionManager;
    public kernelSpecManager: KernelSpecManager;
    public kernelManager: KernelManager;
    public contentsManager: ContentsManager;
    private _jupyterlab?: typeof import('@jupyterlab/services');
    private get jupyterlab(): typeof import('@jupyterlab/services') {
        if (!this._jupyterlab) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this._jupyterlab = require('@jupyterlab/services');
        }
        return this._jupyterlab!;
    }
    private constructor(private readonly serverSettings: ServerConnection.ISettings) {
        super();
        this.kernelSpecManager = new this.jupyterlab.KernelSpecManager({ serverSettings: this.serverSettings });
        this.kernelManager = new this.jupyterlab.KernelManager({ serverSettings: this.serverSettings });
        this.sessionManager = new this.jupyterlab.SessionManager({
            serverSettings: this.serverSettings,
            kernelManager: this.kernelManager
        });
        this.contentsManager = new this.jupyterlab.ContentsManager({ serverSettings: this.serverSettings });
    }
    public static create(serverSettings: ServerConnection.ISettings) {
        return new JupyterLabHelper(serverSettings);
    }

    private _isDisposing = false;
    public override dispose() {
        if (this.isDisposed || this._isDisposing) {
            return;
        }
        this._isDisposing = true;
        (async () => {
            logger.trace(`Disposing Jupyter Lab Helper`);
            try {
                if (this.contentsManager) {
                    logger.trace('SessionManager - dispose contents manager');
                    this.contentsManager.dispose();
                }
                if (this.sessionManager && !this.sessionManager.isDisposed) {
                    logger.trace('ShutdownSessionAndConnection - dispose session manager');
                    // Make sure it finishes startup.
                    await raceTimeout(10_000, this.sessionManager.ready);

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    this.sessionManager.dispose(); // Note, shutting down all will kill all kernels on the same connection. We don't want that.
                }
                if (!this.kernelManager?.isDisposed) {
                    this.kernelManager?.dispose();
                }
                if (!this.kernelSpecManager?.isDisposed) {
                    this.kernelSpecManager?.dispose();
                }
            } catch (e) {
                logger.error(`Exception on Jupyter Lab Helper shutdown: `, e);
            } finally {
                logger.trace('Finished disposing Jupyter Lab Helper');
            }
        })()
            .catch(noop)
            .finally(() => super.dispose());
    }

    public async getRunningSessions(): Promise<Session.IModel[]> {
        if (!this.sessionManager) {
            return [];
        }
        await raceTimeout(10_000, this.sessionManager.ready).catch(noop);
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    public async getKernelSpecs(): Promise<IJupyterKernelSpec[]> {
        if (!this.serverSettings || !this.sessionManager || !this.contentsManager) {
            throw new SessionDisposedError();
        }
        try {
            const stopWatch = new StopWatch();
            const specsManager = this.kernelSpecManager;
            if (!specsManager) {
                logger.error(
                    `No SessionManager to enumerate kernelspecs (no specs manager). Returning a default kernel. Specs ${JSON.stringify(
                        this.kernelSpecManager?.specs?.kernelspecs || {}
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
                dispose(disposables);
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
                logger.error(
                    `Jupyter Lab Helper cannot enumerate kernelspecs. Returning a default kernel. Specs ${JSON.stringify(
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
            logger.error(`Jupyter Lab Helper:getKernelSpecs failure: `, e);
            // For some reason this is failing. Just return nothing
            return [];
        }
    }
}
