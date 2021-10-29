// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import type { Slot } from '@lumino/signaling';
import { CancellationToken } from 'vscode-jsonrpc';
import { CancellationError } from '../../common/cancellation';
import { getTelemetrySafeErrorMessageFromPythonTraceback } from '../../common/errors/errorUtils';
import { traceError, traceInfo, traceInfoIfCI, traceWarning } from '../../common/logger';
import { IDisposable, IOutputChannel, Resource } from '../../common/types';
import { createDeferred, sleep, TimedOutError } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
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
        resource: Resource,
        private readonly outputChannel: IOutputChannel,
        restartSessionUsed: (id: Kernel.IKernelConnection) => void,
        workingDirectory: string,
        interruptTimeout: number,
        restartTimeout: number
    ) {
        super(resource, restartSessionUsed, workingDirectory, interruptTimeout, restartTimeout);
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

    // Connect to the given kernelspec, which should already have ipykernel installed into its interpreter
    public async connect(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        timeout: number,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<KernelConnectionMetadata | undefined> {
        // Save the resource that we connect with
        let newSession: RawSession;
        trackKernelResourceInformation(resource, { kernelConnection });
        const stopWatch = new StopWatch();
        try {
            // Try to start up our raw session, allow for cancellation or timeout
            // Notebook Provider level will handle the thrown error
            newSession = await this.startRawSession(resource, kernelConnection, timeout, cancelToken, disableUI);

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
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartUserCancel);
                traceInfo('Starting of raw session cancelled by user');
                throw error;
            } else if (error instanceof TimedOutError) {
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartTimeout);
                traceError('Raw session failed to start in given timeout');
                throw error;
            } else if (error instanceof IpyKernelNotInstalledError) {
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartNoIpykernel, {
                    reason: error.reason
                });
                traceError('Raw session failed to start because dependencies not installed');
                throw error;
            } else {
                // Send our telemetry event with the error included
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    error as any
                );
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStartException,
                    undefined,
                    undefined,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    error as any
                );
                traceError(`Failed to connect raw kernel session: ${error}`);
                throw error;
            }
        } finally {
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionConnect, stopWatch.elapsedTime);
        }

        this.connected = true;
        return newSession.kernelProcess.kernelConnectionMetadata;
    }

    public async createNewKernelSession(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        timeoutMS: number,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<ISessionWithSocket> {
        if (!kernelConnection || 'session' in kernelConnection) {
            // Don't allow for connecting to a LiveKernelModel
            throw new Error('Unsupported - Cannot start live kernels using raw session');
        }

        const displayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
        this.outputChannel.appendLine(localize.DataScience.kernelStarted().format(displayName));

        const newSession = await this.startRawSession(resource, kernelConnection, timeoutMS, cancelToken, disableUI);

        // Make sure it is idle before we return
        await this.waitForIdleOnSession(newSession, timeoutMS);
        return newSession;
    }

    protected shutdownSession(
        session: ISessionWithSocket | undefined,
        statusHandler: Slot<ISessionWithSocket, KernelMessage.Status> | undefined,
        isRequestToShutdownRestartSession: boolean | undefined
    ): Promise<void> {
        // REmove our process exit handler. Kernel is shutting down on purpose
        // so we don't need to listen.
        if (this.processExitHandler) {
            this.processExitHandler.dispose();
            this.processExitHandler = undefined;
        }
        // We want to know why we got shut down
        const stacktrace = new Error().stack;
        return super.shutdownSession(session, statusHandler, isRequestToShutdownRestartSession).then(() => {
            sendTelemetryEvent(Telemetry.RawKernelSessionShutdown, undefined, {
                isRequestToShutdownRestartSession,
                stacktrace
            });
            if (session) {
                return (session as RawSession).kernelProcess.dispose();
            }
        });
    }

    protected setSession(session: RawSession) {
        super.setSession(session);

        // When setting the session clear our current exit handler and hook up to the
        // new session process
        if (this.processExitHandler) {
            this.processExitHandler.dispose();
            this.processExitHandler = undefined;
        }
        if (session?.kernelProcess) {
            // Watch to see if our process exits
            this.processExitHandler = session.kernelProcess.exited(({ exitCode, reason }) => {
                sendTelemetryEvent(Telemetry.RawKernelSessionKernelProcessExited, undefined, {
                    exitCode,
                    exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(reason)
                });
                traceError(`Raw kernel process exited code: ${exitCode}`);
                this.shutdown().catch((reason) => {
                    traceError(`Error shutting down jupyter session: ${reason}`);
                });
                // Next code the user executes will show a session disposed message
            });
            this._disposables.push(this.processExitHandler);
        }
    }

    protected startRestartSession(timeout: number) {
        if (!this.restartSessionPromise) {
            this.restartSessionPromise = this.createRestartSession(timeout);
        }
    }
    protected async createRestartSession(
        timeout: number,
        cancelToken?: CancellationToken
    ): Promise<ISessionWithSocket> {
        if (!this.kernelConnectionMetadata || this.kernelConnectionMetadata.kind === 'connectToLiveKernel') {
            throw new Error('Unsupported - unable to restart live kernel sessions using raw kernel.');
        }
        return this.startRawSession(this.resource, this.kernelConnectionMetadata, timeout, cancelToken);
    }

    @captureTelemetry(Telemetry.RawKernelStartRawSession, undefined, true)
    private async startRawSession(
        resource: Resource,
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

        traceInfo(`Starting raw kernel ${getDisplayNameOrNameOfKernelConnection(kernelConnection)}`);

        const process = await this.kernelLauncher.launch(
            kernelConnection,
            timeout,
            resource,
            this.workingDirectory,
            cancelToken,
            disableUI
        );

        // Create our raw session, it will own the process lifetime
        const result = new RawSession(process, this.resource);

        // Wait for it to be ready
        await result.waitForReady();

        // Attempt to get kernel to respond to requests (this is what jupyter does today).
        // Kinda warms up the kernel communiocation & ensure things are in the right state.
        traceInfoIfCI(`Kernel status before requesting kernel info and after ready is ${result.kernel.status}`);
        // Lets wait for the response (max of 10s), like jupyter does (lets not wait for full timeout, we don't want to slow kernel startup).
        // Try again (twice, jupyter tries this a couple f times).
        // For now, lets try just twice.
        // Note: We don't yet want to do what Jupyter does today, it could slow the startup of kernels.
        // Lets try this and see (hence the telemetry to see the cost of this check).
        const stopWatch = new StopWatch();
        let gotIoPubMessage = createDeferred<boolean>();
        let attempts = 1;
        for (attempts = 1; attempts <= 2; attempts++) {
            gotIoPubMessage = createDeferred<boolean>();
            const iopubHandler = () => gotIoPubMessage.resolve(true);
            result.iopubMessage.connect(iopubHandler);
            await Promise.race([
                Promise.all([result.kernel.requestKernelInfo(), gotIoPubMessage.promise]),
                sleep(Math.min(timeout, 10))
            ]);

            result.iopubMessage.disconnect(iopubHandler);
            if (gotIoPubMessage.completed) {
                traceInfoIfCI(`Get response for requestKernelInfo`);
                break;
            } else {
                traceWarning(`Didn't get response for requestKernelInfo`);
                continue;
            }
        }
        sendTelemetryEvent(Telemetry.RawKernelInfoResonse, stopWatch.elapsedTime, {
            attempts,
            timedout: !gotIoPubMessage.completed
        });

        /**
         * To get a better understanding of the way Jupyter works, we need to look at Jupyter Client code.
         * Here's an excerpt (there are a lot of checks in a number of different files, this is NOT he only place)
         * Leaving this here for refernce purposes.

            def wait_for_ready(self):
                # Wait for kernel info reply on shell channel
                while True:
                    self.kernel_info()
                    try:
                        msg = self.shell_channel.get_msg(block=True, timeout=1)
                    except Empty:
                        pass
                    else:
                        if msg['msg_type'] == 'kernel_info_reply':
                            # Checking that IOPub is connected. If it is not connected, start over.
                            try:
                                self.iopub_channel.get_msg(block=True, timeout=0.2)
                            except Empty:
                                pass
                            else:
                                self._handle_kernel_info_reply(msg)
                                break

                # Flush IOPub channel
                while True:
                    try:
                        msg = self.iopub_channel.get_msg(block=True, timeout=0.2)
                        print(msg['msg_type'])
                    except Empty:
                        break
        */

        traceWarning(`Didn't get response for requestKernelInfo`);

        // So that we don't have problems with ipywidgets, always register the default ipywidgets comm target.
        // Restart sessions and retries might make this hard to do correctly otherwise.
        result.kernel.registerCommTarget(Identifiers.DefaultCommTarget, noop);

        return result;
    }
}
