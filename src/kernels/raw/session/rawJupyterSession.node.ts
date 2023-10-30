// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { traceVerbose, traceInfoIfCI } from '../../../platform/logging';
import { Resource } from '../../../platform/common/types';
import { raceTimeout } from '../../../platform/common/utils/async';
import { IRawKernelSession, LocalKernelConnectionMetadata } from '../../types';
import { noop } from '../../../platform/common/utils/misc';
import { waitForIdleOnSession } from '../../common/helpers';
import { BaseJupyterSessionConnection } from '../../common/baseJupyterSessionConnection';
import { suppressShutdownErrors } from '../../common/baseJupyterSession';
import { RawSessionConnection } from './rawSessionConnection.node';
import { CancellationToken } from 'vscode';

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
    public get atleastOneCellExecutedSuccessfully() {
        return this.session.atleastOneCellExecutedSuccessfully;
    }
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
        traceInfoIfCI(`Real kernel is ${this.session.kernel ? 'defined' : 'undefined'}`);
        return 'unknown';
    }

    constructor(
        session: RawSessionConnection,
        private readonly resource: Resource,
        private readonly kernelConnectionMetadata: LocalKernelConnectionMetadata
    ) {
        super('localRaw', session);
        this.initializeKernelSocket();
    }
    public override dispose() {
        this.disposeAsync().catch(noop);
    }
    public override async disposeAsync(): Promise<void> {
        await this.shutdown()
            .catch(noop)
            .finally(() => this.session.dispose())
            .finally(() => super.dispose());
    }

    public async waitForIdle(timeout: number, token: CancellationToken): Promise<void> {
        try {
            await waitForIdleOnSession(this.kernelConnectionMetadata, this.resource, this.session, timeout, token);
        } catch (ex) {
            traceInfoIfCI(`Error waiting for idle`, ex);
            await this.shutdown().catch(noop);
            throw ex;
        }
    }

    public async shutdown(): Promise<void> {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;
        this.terminatingStatus = 'terminating';
        this.statusChanged.emit('terminating');
        const kernelIdForLogging = `${this.session.kernel?.id}, ${this.kernelConnectionMetadata?.id}`;
        traceVerbose(`Shutdown session ${kernelIdForLogging} - start called from ${new Error('').stack}`);
        suppressShutdownErrors(this.session.kernel);
        await raceTimeout(1000, this.session.shutdown().catch(noop));
        this.didShutdown.fire();
        super.dispose();
        traceVerbose(`Shutdown session ${kernelIdForLogging} - shutdown complete`);
    }
}
