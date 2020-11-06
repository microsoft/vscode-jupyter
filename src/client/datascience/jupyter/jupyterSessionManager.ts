// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { ContentsManager, Kernel, ServerConnection, Session, SessionManager } from '@jupyterlab/services';
import { EventEmitter } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { traceError, traceInfo } from '../../common/logger';
import { IConfigurationService, IOutputChannel } from '../../common/types';
import { sleep } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import {
    IJupyterConnection,
    IJupyterKernel,
    IJupyterKernelSpec,
    IJupyterSession,
    IJupyterSessionManager
} from '../types';
import { JupyterSession } from './jupyterSession';
import { createDefaultKernelSpec } from './kernels/helpers';
import { JupyterKernelSpec } from './kernels/jupyterKernelSpec';
import { KernelConnectionMetadata } from './kernels/types';

// Key for our insecure connection global state

// tslint:disable: no-any

export class JupyterSessionManager implements IJupyterSessionManager {
    public get sessionManager(): SessionManager {
        return this._sessionManager!;
    }
    public get contentsManager(): ContentsManager {
        return this._contentsManager!;
    }
    private get jupyterlab(): typeof import('@jupyterlab/services') {
        if (!this._jupyterlab) {
            // tslint:disable-next-line: no-require-imports
            this._jupyterlab = require('@jupyterlab/services');
        }
        return this._jupyterlab!;
    }
    private _contentsManager?: ContentsManager;
    private _jupyterlab?: typeof import('@jupyterlab/services');
    private _sessionManager?: SessionManager;
    private restartSessionCreatedEvent = new EventEmitter<Kernel.IKernelConnection>();
    private restartSessionUsedEvent = new EventEmitter<Kernel.IKernelConnection>();
    constructor(
        private readonly connInfo: IJupyterConnection,
        private readonly serverSettings: ServerConnection.ISettings,
        private readonly outputChannel: IOutputChannel,
        private readonly configService: IConfigurationService
    ) {
        this._sessionManager = new this.jupyterlab.SessionManager({ serverSettings: this.serverSettings });
        this._contentsManager = new this.jupyterlab.ContentsManager({ serverSettings: this.serverSettings });
    }

    public get onRestartSessionCreated() {
        return this.restartSessionCreatedEvent.event;
    }

    public get onRestartSessionUsed() {
        return this.restartSessionUsedEvent.event;
    }

    public getConnInfo(): IJupyterConnection {
        return this.connInfo!;
    }

    public async startNew(
        kernelConnection: KernelConnectionMetadata | undefined,
        workingDirectory: string,
        cancelToken?: CancellationToken
    ): Promise<IJupyterSession> {
        if (!this.connInfo || !this._sessionManager || !this._contentsManager || !this.serverSettings) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        // Create a new session and attempt to connect to it
        const session = new JupyterSession(
            this.connInfo,
            this.serverSettings,
            kernelConnection,
            this._sessionManager,
            this._contentsManager,
            this.outputChannel,
            this.restartSessionCreatedEvent.fire.bind(this.restartSessionCreatedEvent),
            this.restartSessionUsedEvent.fire.bind(this.restartSessionUsedEvent),
            workingDirectory,
            this.configService.getSettings().jupyterLaunchTimeout
        );
        try {
            await session.connect(this.configService.getSettings().jupyterLaunchTimeout, cancelToken);
        } finally {
            if (!session.isConnected) {
                await session.dispose();
            }
        }
        return session;
    }
    public async dispose() {
        traceInfo(`Disposing session manager`);
        try {
            if (this._contentsManager && !this._contentsManager.isDisposed) {
                traceInfo('ConnectionManager - dispose contents manager');
                this._contentsManager.dispose();
                this._contentsManager = undefined;
            }
            if (this._sessionManager && !this._sessionManager.isDisposed) {
                traceInfo('ConnectionManager - dispose session manager');
                // Make sure it finishes startup.
                await Promise.race([sleep(10_000), this._sessionManager.ready]);

                // tslint:disable-next-line: no-any
                const sessionManager = this._sessionManager as any;
                this._sessionManager.dispose(); // Note, shutting down all will kill all kernels on the same connection. We don't want that.
                this._sessionManager = undefined;

                // The session manager can actually be stuck in the context of a timer. Clear out the specs inside of
                // it so the memory for the session is minimized. Otherwise functional tests can run out of memory
                if (sessionManager._specs) {
                    sessionManager._specs = {};
                }
                if (sessionManager._sessions && sessionManager._sessions.clear) {
                    sessionManager._sessions.clear();
                }
                if (sessionManager._pollModels) {
                    this.clearPoll(sessionManager._pollModels);
                }
                if (sessionManager._pollSpecs) {
                    this.clearPoll(sessionManager._pollSpecs);
                }
            }
        } catch (e) {
            traceError(`Exception on session manager shutdown: `, e);
        } finally {
            traceInfo('Finished disposing jupyter session manager');
        }
    }

    public async getRunningSessions(): Promise<Session.IModel[]> {
        if (!this._sessionManager) {
            return [];
        }
        // Not refreshing will result in `running` returning an empty iterator.
        await this._sessionManager.refreshRunning();

        const sessions: Session.IModel[] = [];
        const iterator = this._sessionManager.running();
        let session = iterator.next();

        while (session) {
            sessions.push(session);
            session = iterator.next();
        }

        return sessions;
    }

    public async getRunningKernels(): Promise<IJupyterKernel[]> {
        const models = await this.jupyterlab.Kernel.listRunning(this.serverSettings);
        // Remove duplicates.
        const dup = new Set<string>();
        return models
            .map((m) => {
                return {
                    id: m.id,
                    name: m.name,
                    lastActivityTime: m.last_activity ? new Date(Date.parse(m.last_activity.toString())) : new Date(),
                    numberOfConnections: m.connections ? parseInt(m.connections.toString(), 10) : 0
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
    public async getDefaultKernel(): Promise<string | undefined> {
        if (!this._sessionManager) {
            return;
        }
        await this._sessionManager.refreshRunning();
        return this._sessionManager.specs?.default;
    }

    public async getKernelSpecs(): Promise<IJupyterKernelSpec[]> {
        if (!this.connInfo || !this._sessionManager || !this._contentsManager) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        try {
            // Fetch the list the session manager already knows about. Refreshing may not work.
            const oldKernelSpecs =
                this._sessionManager.specs && Object.keys(this._sessionManager.specs.kernelspecs).length
                    ? this._sessionManager.specs.kernelspecs
                    : {};

            // Wait for the session to be ready
            await Promise.race([sleep(10_000), this._sessionManager.ready]);

            // Ask the session manager to refresh its list of kernel specs. This might never
            // come back so only wait for ten seconds.
            await Promise.race([sleep(10_000), this._sessionManager.refreshSpecs()]);

            // Enumerate all of the kernel specs, turning each into a JupyterKernelSpec
            const kernelspecs =
                this._sessionManager.specs && Object.keys(this._sessionManager.specs.kernelspecs).length
                    ? this._sessionManager.specs.kernelspecs
                    : oldKernelSpecs;
            const keys = Object.keys(kernelspecs);
            if (keys && keys.length) {
                return keys.map((k) => {
                    const spec = kernelspecs[k];
                    return new JupyterKernelSpec(spec) as IJupyterKernelSpec;
                });
            } else {
                traceError(`SessionManager cannot enumerate kernelspecs. Returning default.`);
                // If for some reason the session manager refuses to communicate, fall
                // back to a default. This may not exist, but it's likely.
                return [createDefaultKernelSpec()];
            }
        } catch (e) {
            traceError(`SessionManager:getKernelSpecs failure: `, e);
            // For some reason this is failing. Just return nothing
            return [];
        }
    }

    // tslint:disable-next-line: no-any
    private clearPoll(poll: { _timeout: any }) {
        try {
            clearTimeout(poll._timeout);
        } catch {
            noop();
        }
    }
}
