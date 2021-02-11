// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { Kernel } from '@jupyterlab/services';
import type { Slot } from '@phosphor/signaling';
import { CancellationToken } from 'vscode-jsonrpc';
import { CancellationError } from '../../common/cancellation';
import { WrappedError } from '../../common/errors/errorUtils';
import { traceError, traceInfo } from '../../common/logger';
import { IDisposable, IOutputChannel, Resource } from '../../common/types';
import { TimedOutError } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { captureTelemetry } from '../../telemetry';
import { BaseJupyterSession } from '../baseJupyterSession';
import { Identifiers, Telemetry } from '../constants';
import { getDisplayNameOrNameOfKernelConnection } from '../jupyter/kernels/helpers';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { IKernelLauncher, IpyKernelNotInstalledError } from '../kernel-launcher/types';
import { reportAction } from '../progress/decorator';
import { ReportableAction } from '../progress/types';
import { RawSession } from '../raw-kernel/rawSession';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../telemetry/telemetry';
import { ISessionWithSocket } from '../types';

// Error thrown when we are unable to start a raw kernel session
export class RawKernelSessionStartError extends WrappedError {
    constructor(kernelConnection: KernelConnectionMetadata, originalException?: Error) {
        super(
            localize.DataScience.rawKernelSessionFailed().format(
                getDisplayNameOrNameOfKernelConnection(kernelConnection)
            ),
            originalException
        );
    }
}

/*
RawJupyterSession is the implementation of IJupyterSession that instead of
connecting to JupyterLab services it instead connects to a kernel directly
through ZMQ.
It's responsible for translating our IJupyterSession interface into the
jupyterlabs interface as well as starting up and connecting to a raw session
*/
export class RawJupyterSession extends BaseJupyterSession {
    private processExitHandler: IDisposable | undefined;
    private _disposables: IDisposable[] = [];
    constructor(
        private readonly kernelLauncher: IKernelLauncher,
        private readonly resource: Resource,
        private readonly outputChannel: IOutputChannel,
        private readonly restartSessionCreated: (id: Kernel.IKernelConnection) => void,
        restartSessionUsed: (id: Kernel.IKernelConnection) => void,
        workingDirectory: string,
        timeout: number
    ) {
        super(restartSessionUsed, workingDirectory, timeout);
    }

    @reportAction(ReportableAction.JupyterSessionWaitForIdleSession)
    public async waitForIdle(timeout: number): Promise<void> {
        // Wait until status says idle.
        if (this.session) {
            return this.waitForIdleOnSession(this.session, timeout);
        }
        return Promise.resolve();
    }
    public async dispose(): Promise<void> {
        this._disposables.forEach((d) => d.dispose());
        await super.dispose();
    }

    public shutdown(): Promise<void> {
        if (this.processExitHandler) {
            this.processExitHandler.dispose();
            this.processExitHandler = undefined;
        }
        return super.shutdown();
    }

    // Connect to the given kernelspec, which should already have ipykernel installed into its interpreter
    public async connect(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        timeout: number,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<KernelConnectionMetadata | undefined> {
        // Save the resource that we connect with
        let newSession: RawSession | null | CancellationError = null;
        trackKernelResourceInformation(resource, { kernelConnection });
        const stopWatch = new StopWatch();
        try {
            // Try to start up our raw session, allow for cancellation or timeout
            // Notebook Provider level will handle the thrown error
            newSession = await this.startRawSession(kernelConnection, timeout, cancelToken, disableUI);

            // Only connect our session if we didn't cancel or timeout
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartSuccess);
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime);
            traceInfo('Raw session started and connected');
            this.setSession(newSession);

            // Listen for session status changes
            this.session?.statusChanged.connect(this.statusHandler); // NOSONAR

            // Update kernelspec and interpreter
            this.kernelConnectionMetadata = newSession.kernelProcess?.kernelConnectionMetadata;

            this.outputChannel.appendLine(
                localize.DataScience.kernelStarted().format(
                    getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)
                )
            );
        } catch (error) {
            this.connected = false;
            if (error instanceof CancellationError) {
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime, undefined, error);
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartUserCancel);
                traceInfo('Starting of raw session cancelled by user');
                throw error;
            } else if (error instanceof TimedOutError) {
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime, undefined, error);
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartTimeout);
                traceError('Raw session failed to start in given timeout');
                // Translate into original error
                throw new RawKernelSessionStartError(kernelConnection, error);
            } else if (error instanceof IpyKernelNotInstalledError) {
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime, undefined, error);
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartNoIpykernel, {
                    reason: error.reason
                });
                traceError('Raw session failed to start because dependencies not installed');
                throw error;
            } else {
                // Send our telemetry event with the error included
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime, undefined, error);
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStartException,
                    undefined,
                    undefined,
                    error
                );
                traceError(`Failed to connect raw kernel session: ${error}`);
                throw error;
            }
        } finally {
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionConnect, stopWatch.elapsedTime);
        }

        this.connected = true;
        return (newSession as RawSession).kernelProcess.kernelConnectionMetadata;
    }

    public async createNewKernelSession(
        kernelConnection: KernelConnectionMetadata,
        timeoutMS: number,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<ISessionWithSocket> {
        if (!kernelConnection || 'session' in kernelConnection) {
            // Don't allow for connecting to a LiveKernelModel
            throw new Error(localize.DataScience.sessionDisposed());
        }

        const displayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
        this.outputChannel.appendLine(localize.DataScience.kernelStarted().format(displayName));

        const newSession = await this.startRawSession(kernelConnection, timeoutMS, cancelToken, disableUI);

        // Make sure it is idle before we return
        await this.waitForIdleOnSession(newSession, timeoutMS);
        return newSession;
    }

    protected shutdownSession(
        session: ISessionWithSocket | undefined,
        statusHandler: Slot<ISessionWithSocket, Kernel.Status> | undefined
    ): Promise<void> {
        // REmove our process exit handler. Kernel is shutting down on purpose
        // so we don't need to listen.
        if (this.processExitHandler) {
            this.processExitHandler.dispose();
            this.processExitHandler = undefined;
        }
        return super.shutdownSession(session, statusHandler).then(() => {
            if (session) {
                return (session as RawSession).kernelProcess.dispose();
            }
        });
    }

    protected setSession(session: ISessionWithSocket | undefined) {
        super.setSession(session);

        // When setting the session clear our current exit handler and hook up to the
        // new session process
        if (this.processExitHandler) {
            this.processExitHandler.dispose();
            this.processExitHandler = undefined;
        }
        if (session && (session as RawSession).kernelProcess) {
            // Watch to see if our process exits
            this.processExitHandler = (session as RawSession).kernelProcess.exited((exitCode) => {
                traceError(`Raw kernel process exited code: ${exitCode}`);
                this.shutdown().catch((reason) => {
                    traceError(`Error shutting down jupyter session: ${reason}`);
                });
                // Next code the user executes will show a session disposed message
            });
        }
    }

    protected startRestartSession(timeout: number) {
        if (!this.restartSessionPromise && this.session) {
            this.restartSessionPromise = this.createRestartSession(
                this.kernelConnectionMetadata,
                this.session,
                timeout
            );
        }
    }
    protected async createRestartSession(
        kernelConnection: KernelConnectionMetadata | undefined,
        _session: ISessionWithSocket,
        timeout: number,
        cancelToken?: CancellationToken
    ): Promise<ISessionWithSocket> {
        if (!kernelConnection || kernelConnection.kind === 'connectToLiveKernel') {
            // Need to have connected before restarting and can't use a LiveKernelModel
            throw new Error(localize.DataScience.sessionDisposed());
        }
        const startPromise = this.startRawSession(kernelConnection, timeout, cancelToken);
        return startPromise.then((session) => {
            this.restartSessionCreated(session.kernel);
            return session;
        });
    }

    @captureTelemetry(Telemetry.RawKernelStartRawSession, undefined, true)
    private async startRawSession(
        kernelConnection: KernelConnectionMetadata,
        timeout: number,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<RawSession> {
        if (
            kernelConnection.kind !== 'startUsingKernelSpec' &&
            kernelConnection.kind !== 'startUsingPythonInterpreter'
        ) {
            throw new Error(`Unable to start Raw Kernels for Kernel Connection of type ${kernelConnection.kind}`);
        }
        const process = await this.kernelLauncher.launch(
            kernelConnection,
            timeout,
            this.resource,
            this.workingDirectory,
            cancelToken,
            disableUI
        );

        // Create our raw session, it will own the process lifetime
        const result = new RawSession(process);

        // When our kernel connects and gets a status message it triggers the ready promise
        await result.kernel.ready;

        // So that we don't have problems with ipywidgets, always register the default ipywidgets comm target.
        // Restart sessions and retries might make this hard to do correctly otherwise.
        result.kernel.registerCommTarget(Identifiers.DefaultCommTarget, noop);

        return result;
    }
}
