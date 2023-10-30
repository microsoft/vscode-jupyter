// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage, Session } from '@jupyterlab/services';
import { CancellationError, CancellationToken, CancellationTokenSource, Uri } from 'vscode';
import { traceVerbose, traceWarning, traceInfoIfCI } from '../../../platform/logging';
import { Resource, IDisposable } from '../../../platform/common/types';
import { raceTimeout } from '../../../platform/common/utils/async';
import { suppressShutdownErrors } from '../../common/baseJupyterSession';
import {
    KernelConnectionMetadata,
    isLocalConnection,
    IJupyterConnection,
    KernelActionSource,
    IJupyterKernelSession,
    isRemoteConnection
} from '../../types';
import { DisplayOptions } from '../../displayOptions';
import { IJupyterKernelService } from '../types';
import { noop } from '../../../platform/common/utils/misc';
import { getResourceType } from '../../../platform/common/utils';
import { waitForIdleOnSession } from '../../common/helpers';
import { BaseJupyterSessionConnection } from '../../common/baseJupyterSessionConnection';
import { dispose } from '../../../platform/common/helpers';

export class JupyterSessionWrapper
    extends BaseJupyterSessionConnection<Session.ISessionConnection, 'localJupyter' | 'remoteJupyter'>
    implements IJupyterKernelSession
{
    public get status(): KernelMessage.Status {
        if (this.isDisposed) {
            return 'dead';
        }
        if (this.session?.kernel) {
            return this.session.kernel.status;
        }
        traceInfoIfCI(
            `Kernel status not started because real session is ${
                this.session ? 'defined' : 'undefined'
            } & real kernel is ${this.session?.kernel ? 'defined' : 'undefined'}`
        );
        return 'unknown';
    }
    private restartToken?: CancellationTokenSource;

    constructor(
        session: Session.ISessionConnection,
        private readonly resource: Resource,
        private readonly kernelConnectionMetadata: KernelConnectionMetadata,
        public readonly workingDirectory: Uri,
        private readonly kernelService: IJupyterKernelService | undefined,
        private readonly creator: KernelActionSource
    ) {
        super(isLocalConnection(kernelConnectionMetadata) ? 'localJupyter' : 'remoteJupyter', session);
        this.initializeKernelSocket();
    }

    public override dispose() {
        this.restartToken?.cancel();
        this.restartToken?.dispose();
        this.shutdownImplementation(false).catch(noop);
    }
    public override async disposeAsync(): Promise<void> {
        await this.shutdownImplementation(false).catch(noop);
        await super.disposeAsync();
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
    public override async restart(): Promise<void> {
        const disposables: IDisposable[] = [];
        const token = new CancellationTokenSource();
        this.restartToken = token;
        const ui = new DisplayOptions(false);
        disposables.push(ui);
        disposables.push(token);
        try {
            await this.validateLocalKernelDependencies(token.token, ui);
            await super.restart();
        } finally {
            dispose(disposables);
        }
    }
    private async validateLocalKernelDependencies(token: CancellationToken, ui: DisplayOptions) {
        if (
            !this.kernelConnectionMetadata?.interpreter ||
            !isLocalConnection(this.kernelConnectionMetadata) ||
            !this.kernelService
        ) {
            return;
        }
        if (token.isCancellationRequested) {
            throw new CancellationError();
        }
        // Make sure the kernel has ipykernel installed if on a local machine.
        // When using a Jupyter server to start kernels locally
        // we need to ensure ipykernel is still available before we attempt to restart a kernel.
        // Its possible for some reason that users uninstalled ipykernel or its in a broken state
        // Hence we need to validate the env before we can restart the kernel.
        // In the past users got into a state where ipykernel was no longer properly installed
        // after the kernel was started.
        await this.kernelService.ensureKernelIsUsable(
            this.resource,
            this.kernelConnectionMetadata,
            ui,
            token,
            this.creator === '3rdPartyExtension'
        );
    }

    public override async shutdown(): Promise<void> {
        this.restartToken?.cancel();
        this.restartToken?.dispose();
        return this.shutdownImplementation(true);
    }

    private async shutdownImplementation(shutdownEvenIfRemote?: boolean) {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;
        traceVerbose(`Shutdown session - current session, called from ${new Error('').stack}`);
        const kernelIdForLogging = `${this.session.kernel?.id}, ${this.kernelConnectionMetadata.id}`;
        traceVerbose(`shutdownSession ${kernelIdForLogging} - start`);
        try {
            if (shutdownEvenIfRemote || this.canShutdownSession()) {
                try {
                    traceVerbose(`Session can be shutdown ${this.kernelConnectionMetadata.id}`);
                    suppressShutdownErrors(this.session.kernel);
                    // Shutdown may fail if the process has been killed
                    if (!this.session.isDisposed) {
                        await raceTimeout(1000, this.session.shutdown().catch(noop));
                    }
                } catch {
                    // If session.shutdown didn't work, just dispose
                    try {
                        // If session.shutdown didn't work, just dispose
                        if (!this.session.isDisposed) {
                            this.session.dispose();
                        }
                    } catch (e) {
                        traceWarning('Failures in disposing the session', e);
                    }
                } finally {
                    this.didShutdown.fire();
                }
            } else {
                traceVerbose(`Session cannot be shutdown ${this.kernelConnectionMetadata.id}`);
            }
            try {
                // If session.shutdown didn't work, just dispose
                if (!this.session.isDisposed) {
                    this.session.dispose();
                }
            } catch (e) {
                traceWarning('Failures in disposing the session', e);
            }
            super.dispose();
            traceVerbose('Shutdown session -- complete');
        } catch (e) {
            traceWarning('Failures in disposing the session', e);
        }
        traceVerbose(`shutdownSession ${kernelIdForLogging} - shutdown complete`);
    }
    private canShutdownSession(): boolean {
        if (isLocalConnection(this.kernelConnectionMetadata)) {
            return true;
        }
        // We can never shut down existing (live) kernels.
        if (this.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel') {
            return false;
        }
        // If this Interactive Window, then always shutdown sessions (even with remote Jupyter).
        if (this.resource && getResourceType(this.resource) === 'interactive') {
            return true;
        }
        // If we're in notebooks and using Remote Jupyter connections, then never shutdown the sessions.
        if (
            this.resource &&
            getResourceType(this.resource) === 'notebook' &&
            isRemoteConnection(this.kernelConnectionMetadata)
        ) {
            return false;
        }

        return true;
    }
}

export function getRemoteSessionOptions(
    _remoteConnection: IJupyterConnection,
    _resource?: Uri
): Pick<Session.ISessionOptions, 'path' | 'name'> | undefined | void {
    // if (!resource || resource.scheme === 'untitled' || !remoteConnection.mappedRemoteNotebookDir) {
    //     return;
    // }
    // // Get Uris of both, local and remote files.
    // // Convert Uris to strings to Uri again, as its possible the Uris are not always compatible.
    // // E.g. one could be dealing with custom file system providers.
    // const filePath = Uri.file(resource.path);
    // const mappedLocalPath = Uri.file(remoteConnection.mappedRemoteNotebookDir);
    // if (!path.isEqualOrParent(filePath, mappedLocalPath)) {
    //     return;
    // }
    // const sessionPath = path.relativePath(mappedLocalPath, filePath);
    // // If we have mapped the local dir to the remote dir, then we need to use the name of the file.
    // const sessionName = path.basename(resource);
    // if (sessionName && sessionPath) {
    //     return {
    //         path: sessionPath,
    //         name: sessionName
    //     };
    // }
}
