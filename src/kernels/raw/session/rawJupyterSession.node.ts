// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { logger } from '../../../platform/logging';
import { Resource } from '../../../platform/common/types';
import { raceTimeout } from '../../../platform/common/utils/async';
import { IRawKernelSession, LocalKernelConnectionMetadata } from '../../types';
import { noop } from '../../../platform/common/utils/misc';
import { waitForIdleOnSession } from '../../common/helpers';
import { BaseJupyterSessionConnection } from '../../common/baseJupyterSessionConnection';
import { suppressShutdownErrors } from '../../common/baseJupyterSession';
import { RawSessionConnection } from './rawSessionConnection.node';
import { CancellationToken, Disposable } from 'vscode';

/*
RawJupyterSession is the implementation of IJupyterKernelConnectionSession that instead of
connecting to JupyterLab services it instead connects to a kernel directly
through ZMQ.
It's responsible for translating our IJupyterKernelConnectionSession interface into the
jupyterlabs interface as well as starting up and connecting to a raw session
*/
export class RawJupyterSessionWrapper
    extends BaseJupyterSessionConnection<RawSessionConnection, 'localRaw'>
    implements IRawKernelSession
{
    private terminatingStatus?: KernelMessage.Status;
    public get status(): KernelMessage.Status {
        if (this.terminatingStatus && !this.isDisposed) {
            return this.terminatingStatus;
        }
        if (this.isDisposed) {
            return 'dead';
        }
        if (this.session.kernel) {
            return this.session.kernel.status;
        }
        logger.ci(`Real kernel is ${this.session.kernel ? 'defined' : 'undefined'}`);
        return 'unknown';
    }

    constructor(
        session: RawSessionConnection,
        private readonly resource: Resource,
        private readonly kernelConnectionMetadata: LocalKernelConnectionMetadata
    ) {
        super('localRaw', session);
        // Dispose the latest version of session, don't register `this.session`
        this._register(new Disposable(() => this.session.dispose()));
        this.initializeKernelSocket();
    }
    public override dispose() {
        void this.shutdown().finally(() => super.dispose());
    }

    public async waitForIdle(timeout: number, token: CancellationToken): Promise<void> {
        try {
            await waitForIdleOnSession(this.kernelConnectionMetadata, this.resource, this.session, timeout, token);
        } catch (ex) {
            logger.ci(`Error waiting for idle`, ex);
            await this.shutdown().catch(noop);
            throw ex;
        }
    }

    private shutdownInProgress = false;
    public async shutdown(): Promise<void> {
        if (this.isDisposed || this.shutdownInProgress) {
            return;
        }
        this.shutdownInProgress = true;
        this.terminatingStatus = 'terminating';
        this.statusChanged.emit('terminating');
        const kernelIdForLogging = `${this.session.kernel?.id}, ${this.kernelConnectionMetadata?.id}`;
        logger.debug(`Shutdown session ${kernelIdForLogging} - start called from ${new Error('').stack}`);
        suppressShutdownErrors(this.session.kernel);
        await raceTimeout(1000, this.session.shutdown().catch(noop));
        this.didShutdown.fire();
        this.dispose();
        logger.debug(`Shutdown session ${kernelIdForLogging} - shutdown complete`);
    }
}
