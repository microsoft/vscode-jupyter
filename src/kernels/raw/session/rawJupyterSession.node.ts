// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { Cancellation, isCancellationError } from '../../../platform/common/cancellation';
import { traceError, traceVerbose } from '../../../platform/logging';
import { IDisplayOptions, Resource } from '../../../platform/common/types';
import { trackKernelResourceInformation } from '../../telemetry/helper';
import {
    IRawKernelSession,
    ISessionWithSocket,
    KernelConnectionMetadata,
    isLocalConnection
} from '../../../kernels/types';
import { BaseJupyterSession } from '../../common/baseJupyterSession';
import { IKernelLauncher } from '../types';
import { RawSession } from './rawSession.node';

/*
RawJupyterSession is the implementation of IJupyterKernelConnectionSession that instead of
connecting to JupyterLab services it instead connects to a kernel directly
through ZMQ.
It's responsible for translating our IJupyterKernelConnectionSession interface into the
jupyterlabs interface as well as starting up and connecting to a raw session
*/
export class RawJupyterSession extends BaseJupyterSession<'localRaw'> implements IRawKernelSession {
    private terminatingStatus?: KernelMessage.Status;
    public get atleastOneCellExecutedSuccessfully() {
        if (this.session && this.session instanceof RawSession) {
            return this.session.atleastOneCellExecutedSuccessfully;
        }
        return false;
    }
    public override get status(): KernelMessage.Status {
        if (this.terminatingStatus && super.status !== 'dead') {
            return this.terminatingStatus;
        }
        return super.status;
    }
    private readonly _rawSession: RawSession;
    public override get session(): ISessionWithSocket {
        return this._rawSession!;
    }

    constructor(
        private readonly kernelLauncher: IKernelLauncher,
        resource: Resource,
        workingDirectory: Uri,
        kernelConnection: KernelConnectionMetadata,
        private readonly launchTimeout: number,
        type: 'notebook' | 'console'
    ) {
        super('localRaw', resource, kernelConnection, workingDirectory);
        if (!isLocalConnection(kernelConnection)) {
            throw new Error(`Invalid KernelConnectionMetadata for RawJupyterSession, ${kernelConnection.kind}`);
        }
        this._rawSession = new RawSession(
            this.resource,
            this.kernelLauncher,
            this.workingDirectory,
            kernelConnection,
            this.launchTimeout,
            type
        );
    }

    // Connect to the given kernelspec, which should already have ipykernel installed into its interpreter
    public async start(options: { token: CancellationToken; ui: IDisplayOptions }): Promise<void> {
        await trackKernelResourceInformation(this.resource, { kernelConnection: this.kernelConnectionMetadata });
        try {
            // Try to start up our raw session, allow for cancellation or timeout
            // Notebook Provider level will handle the thrown error
            this.terminatingStatus = undefined;
            await this._rawSession.startKernel(options);
            Cancellation.throwIfCanceled(options.token);
            this.setSession(this._rawSession);

            // Listen for session status changes
            this.session?.statusChanged.connect(this.statusHandler); // NOSONAR
        } catch (error) {
            this.connected = false;
            if (isCancellationError(error) || options.token.isCancellationRequested) {
                traceVerbose('Starting of raw session cancelled by user');
                throw error;
            } else {
                traceError(`Failed to connect raw kernel session: ${error}`);
                throw error;
            }
        }

        this.connected = true;
    }
}
