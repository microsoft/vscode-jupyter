// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ContentsManager, KernelSpecManager, KernelManager, SessionManager } from '@jupyterlab/services';
import { CancellationToken, Uri } from 'vscode';
import { traceError, traceVerbose } from '../../../platform/logging';
import { IConfigurationService, IOutputChannel, Resource, IDisplayOptions } from '../../../platform/common/types';
import { IJupyterConnection, KernelActionSource, KernelConnectionMetadata } from '../../types';
import { OldJupyterSession } from './oldJupyterSession';
import { raceTimeout } from '../../../platform/common/utils/async';
import {
    IJupyterSessionManager,
    IJupyterKernelService,
    IJupyterBackingFileCreator,
    IJupyterRequestCreator
} from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export class JupyterSessionManager implements IJupyterSessionManager {
    private sessionManager: SessionManager;
    private specsManager: KernelSpecManager;
    private kernelManager: KernelManager;
    private contentsManager: ContentsManager;
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
        private outputChannel: IOutputChannel,
        private configService: IConfigurationService,
        private readonly kernelService: IJupyterKernelService | undefined,
        private readonly backingFileCreator: IJupyterBackingFileCreator,
        private readonly requestCreator: IJupyterRequestCreator,
        private readonly connInfo: IJupyterConnection
    ) {
        const serverSettings = connInfo.settings;
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
                await raceTimeout(10_000, this.sessionManager.ready);

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

    public async startNew(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        workingDirectory: Uri,
        ui: IDisplayOptions,
        cancelToken: CancellationToken,
        creator: KernelActionSource
    ): Promise<OldJupyterSession> {
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
}
