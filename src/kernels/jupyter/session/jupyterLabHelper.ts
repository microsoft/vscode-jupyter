// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ContentsManager, KernelSpecManager, KernelManager, Session, SessionManager } from '@jupyterlab/services';
import { JSONObject } from '@lumino/coreutils';
import { Disposable } from 'vscode';
import { traceError, traceVerbose } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { createInterpreterKernelSpec } from '../../helpers';
import { IJupyterConnection, IJupyterKernelSpec } from '../../types';
import { JupyterKernelSpec } from '../jupyterKernelSpec';
import { createDeferred, sleep } from '../../../platform/common/utils/async';
import { IJupyterKernel } from '../types';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import type { ISpecModel } from '@jupyterlab/services/lib/kernelspec/kernelspec';

/* eslint-disable @typescript-eslint/no-explicit-any */

export class JupyterLabHelper {
    private readonly sessionManager: SessionManager;
    private readonly specsManager: KernelSpecManager;
    private readonly kernelManager: KernelManager;
    private readonly contentsManager: ContentsManager;
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
    constructor(private readonly connection: IJupyterConnection) {
        const serverSettings = connection.serverSettings;
        this.specsManager = new this.jupyterlab.KernelSpecManager({ serverSettings });
        this.kernelManager = new this.jupyterlab.KernelManager({ serverSettings });
        this.sessionManager = new this.jupyterlab.SessionManager({
            serverSettings,
            kernelManager: this.kernelManager
        });
        this.contentsManager = new this.jupyterlab.ContentsManager({ serverSettings });
    }

    public async dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        traceVerbose(`Disposing session manager`);
        try {
            traceVerbose('SessionManager - dispose contents manager');
            this.contentsManager.dispose();
            if (!this.sessionManager.isDisposed) {
                traceVerbose('ShutdownSessionAndConnection - dispose session manager');
                // Make sure it finishes startup.
                await Promise.race([sleep(10_000), this.sessionManager.ready]);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.sessionManager.dispose(); // Note, shutting down all will kill all kernels on the same connection. We don't want that.
            }
            if (!this.kernelManager.isDisposed) {
                this.kernelManager.dispose();
            }
            if (!this.specsManager.isDisposed) {
                this.specsManager.dispose();
            }
        } catch (e) {
            traceError(`Exception on session manager shutdown: `, e);
        } finally {
            traceVerbose('Finished disposing jupyter session manager');
        }
    }
    public async getRunningSessions(): Promise<Session.IModel[]> {
        // Wait for the session to be ready
        // Do not call `sessionManager.refreshRunning()` as that is already called
        // as soon as sessionManager is instantiated.
        // Calling again cancels the previous and could result in errors.
        // hence we first need to wait for `ready`, which is resolved as soon as
        // `refreshRunning` is completed.
        // Thereby making the call for `refreshRunning` redundant.
        await Promise.race([sleep(10_000), this.sessionManager.ready]);

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
        const models = await this.jupyterlab.KernelAPI.listRunning(this.connection.serverSettings);
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

    public async getKernelSpecs(): Promise<IJupyterKernelSpec[]> {
        try {
            const stopWatch = new StopWatch();
            const specsManager = this.specsManager;
            if (!specsManager) {
                traceError(
                    `No SessionManager to enumerate kernelspecs (no specs manager). Returning a default kernel. Specs ${JSON.stringify(
                        this.specsManager.specs?.kernelspecs || {}
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
}
