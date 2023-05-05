// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import type { Slot } from '@lumino/signaling';
import { CancellationError, CancellationTokenSource, Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import {
    Cancellation,
    createPromiseFromCancellation,
    isCancellationError
} from '../../../platform/common/cancellation';
import { getTelemetrySafeErrorMessageFromPythonTraceback } from '../../../platform/errors/errorUtils';
import { traceInfo, traceError, traceVerbose, traceWarning } from '../../../platform/logging';
import { IDisplayOptions, IDisposable, Resource } from '../../../platform/common/types';
import { createDeferred, sleep } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import { sendKernelTelemetryEvent } from '../../telemetry/sendKernelTelemetryEvent';
import { trackKernelResourceInformation } from '../../telemetry/helper';
import { Telemetry } from '../../../telemetry';
import { getDisplayNameOrNameOfKernelConnection } from '../../../kernels/helpers';
import { IRawKernelSession, ISessionWithSocket, KernelConnectionMetadata } from '../../../kernels/types';
import { BaseJupyterSession } from '../../common/baseJupyterSession';
import { IKernelLauncher, IKernelProcess } from '../types';
import { RawSession } from './rawSession.node';
import { DisplayOptions } from '../../displayOptions';
import { noop } from '../../../platform/common/utils/misc';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';

/*
RawJupyterSession is the implementation of IJupyterKernelConnectionSession that instead of
connecting to JupyterLab services it instead connects to a kernel directly
through ZMQ.
It's responsible for translating our IJupyterKernelConnectionSession interface into the
jupyterlabs interface as well as starting up and connecting to a raw session
*/
export class RawJupyterSession extends BaseJupyterSession<'localRaw'> implements IRawKernelSession {
    private processExitHandler = new WeakMap<RawSession, IDisposable>();
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
    constructor(
        private readonly kernelLauncher: IKernelLauncher,
        resource: Resource,
        workingDirectory: Uri,
        interruptTimeout: number,
        kernelConnection: KernelConnectionMetadata,
        private readonly launchTimeout: number
    ) {
        super('localRaw', resource, kernelConnection, workingDirectory, interruptTimeout);
    }

    public async waitForIdle(timeout: number, token: CancellationToken): Promise<void> {
        // Wait until status says idle.
        if (this.session) {
            return this.waitForIdleOnSession(this.session, timeout, token);
        }
    }

    // Connect to the given kernelspec, which should already have ipykernel installed into its interpreter
    public async connect(options: { token: CancellationToken; ui: IDisplayOptions }): Promise<void> {
        // Save the resource that we connect with
        let newSession: RawSession;
        await trackKernelResourceInformation(this.resource, { kernelConnection: this.kernelConnectionMetadata });
        try {
            // Try to start up our raw session, allow for cancellation or timeout
            // Notebook Provider level will handle the thrown error
            newSession = await this.startRawSession({ ...options, purpose: 'start' });
            Cancellation.throwIfCanceled(options.token);
            this.setSession(newSession);

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

    protected override shutdownSession(
        session: RawSession | undefined,
        statusHandler: Slot<ISessionWithSocket, KernelMessage.Status> | undefined,
        isRequestToShutdownRestartSession: boolean | undefined
    ): Promise<void> {
        // Remove our process exit handler. Kernel is shutting down on purpose
        // so we don't need to listen to shutdown anymore.
        const disposable = session && this.processExitHandler.get(session);
        disposable?.dispose();
        // We want to know why we got shut down
        const stacktrace = new Error().stack;
        return super.shutdownSession(session, statusHandler, isRequestToShutdownRestartSession).then(() => {
            sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionShutdown, undefined, {
                isRequestToShutdownRestartSession,
                stacktrace
            });
            if (session) {
                return session.kernelProcess.dispose();
            }
        });
    }

    protected override setSession(session: RawSession | undefined) {
        if (session) {
            traceInfo(
                `Started Kernel ${getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)} (pid: ${
                    session.kernelProcess.pid
                })`
            );
        }
        super.setSession(session);
        if (!session) {
            return;
        }
        this.terminatingStatus = undefined;
        // Watch to see if our process exits
        // This is the place to do this, after this session has been setup as the active kernel.
        const disposable = session.kernelProcess.exited(({ exitCode, reason }) => {
            // If this session is no longer the active session, then we don't need to do anything
            // with this exit event (could be we're killing it, or restarting).
            // In the case of restarting, the old session is disposed & a new one created.
            // When disposing the old kernel we shouldn't fire events about session getting terminated.
            if (session !== this.session) {
                return;
            }
            sendKernelTelemetryEvent(
                this.resource,
                Telemetry.RawKernelSessionKernelProcessExited,
                exitCode ? { exitCode } : undefined,
                {
                    exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(reason)
                }
            );
            traceError(`Raw kernel process exited code: ${exitCode}`);

            // If the raw kernel process dies, then send the terminating event, and shutdown the session.
            // Afer shutting down the session, the status changes to `dead`
            this.terminatingStatus = 'terminating';
            this.onStatusChangedEvent.fire('terminating');
            // Shutdown the session but not this class.
            this.setSession(undefined);
            this.shutdownSession(session, this.statusHandler, false)
                .catch((reason) => {
                    traceError(`Error shutting down jupyter session: ${reason}`);
                })
                .finally(() => {
                    // If we're still terminanting this session,
                    // trigger dead status
                    if (this.terminatingStatus) {
                        this.terminatingStatus = 'dead';
                        this.onStatusChangedEvent.fire('dead');
                    }
                });
        });
        this.disposables.push(disposable);
        this.processExitHandler.set(session, disposable);
    }

    protected startRestartSession(disableUI: boolean) {
        const token = new CancellationTokenSource();
        const promise = this.createRestartSession(disableUI, token.token);
        this.restartSessionPromise = { token, promise };
        promise.catch(noop);
        promise
            .finally(() => {
                token.dispose();
                if (this.restartSessionPromise?.promise === promise) {
                    this.restartSessionPromise = undefined;
                }
            })
            .catch(noop);
        return promise;
    }
    private async createRestartSession(
        disableUI: boolean,
        cancelToken: CancellationToken
    ): Promise<ISessionWithSocket> {
        if (!this.kernelConnectionMetadata || this.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel') {
            throw new Error('Unsupported - unable to restart live kernel sessions using raw kernel.');
        }
        return this.startRawSession({ token: cancelToken, ui: new DisplayOptions(disableUI), purpose: 'restart' });
    }

    private async startRawSession(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
        purpose?: 'start' | 'restart';
    }): Promise<RawSession> {
        if (
            this.kernelConnectionMetadata.kind !== 'startUsingLocalKernelSpec' &&
            this.kernelConnectionMetadata.kind !== 'startUsingPythonInterpreter'
        ) {
            throw new Error(
                `Unable to start Raw Kernels for Kernel Connection of type ${this.kernelConnectionMetadata.kind}`
            );
        }

        this.terminatingStatus = undefined;
        const process = await KernelProgressReporter.wrapAndReportProgress(
            this.resource,
            DataScience.connectingToKernel(getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)),
            () =>
                this.kernelLauncher.launch(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    this.kernelConnectionMetadata as any,
                    this.launchTimeout,
                    this.resource,
                    this.workingDirectory.fsPath,
                    options.token
                )
        );
        return KernelProgressReporter.wrapAndReportProgress(
            this.resource,
            DataScience.waitingForJupyterSessionToBeIdle,
            () => this.postStartRawSession(options, process)
        );
    }
    private async postStartRawSession(
        options: { token: CancellationToken; ui: IDisplayOptions },
        process: IKernelProcess
    ): Promise<RawSession> {
        // Create our raw session, it will own the process lifetime
        const result = new RawSession(process, this.resource);

        try {
            // Wait for it to be ready
            traceVerbose('Waiting for Raw Session to be ready in postStartRawSession');
            await Promise.race([
                result.waitForReady(),
                createPromiseFromCancellation({ cancelAction: 'reject', token: options.token })
            ]);
            traceVerbose('Successfully waited for Raw Session to be ready in postStartRawSession');
        } catch (ex) {
            traceError('Failed waiting for Raw Session to be ready', ex);
            await process.dispose();
            result.dispose().catch(noop);
            if (isCancellationError(ex) || options.token.isCancellationRequested) {
                throw new CancellationError();
            }
            throw ex;
        }

        // Attempt to get kernel to respond to requests (this is what jupyter does today).
        // Kinda warms up the kernel communication & ensure things are in the right state.
        traceVerbose(`Kernel status before requesting kernel info and after ready is ${result.kernel.status}`);
        // Lets wait for the response (max of 3s), like jupyter (python code) & jupyter client (jupyter lab npm) does.
        // Lets not wait for full timeout, we don't want to slow kernel startup.
        // Note: in node_modules/@jupyterlab/services/lib/kernel/default.js we only wait for 3s.
        // Hence we'll try for a max of 3 seconds (1.5s for first try & then another 1.5s for the second attempt),
        // Note: jupyter (python code) tries this a couple f times).
        // Note: We don't yet want to do what Jupyter does today, it could slow the startup of kernels.
        // Lets try this and see (hence the telemetry to see the cost of this check).
        // We know 10s is way too slow, see https://github.com/microsoft/vscode-jupyter/issues/8917
        const stopWatch = new StopWatch();
        let gotIoPubMessage = createDeferred<boolean>();
        let attempts = 1;
        for (attempts = 1; attempts <= 2; attempts++) {
            gotIoPubMessage = createDeferred<boolean>();
            const iopubHandler = () => gotIoPubMessage.resolve(true);
            result.iopubMessage.connect(iopubHandler);
            try {
                traceVerbose('Sending request for kernelinfo');
                await Promise.race([
                    Promise.all([result.kernel.requestKernelInfo(), gotIoPubMessage.promise]),
                    sleep(Math.min(this.launchTimeout, 1_500)),
                    createPromiseFromCancellation({ cancelAction: 'reject', token: options.token })
                ]);
            } catch (ex) {
                traceError('Failed to request kernel info', ex);
                await process.dispose();
                result.dispose().catch(noop);
                throw ex;
            } finally {
                result.iopubMessage.disconnect(iopubHandler);
            }

            if (gotIoPubMessage.completed) {
                traceVerbose(`Got response for requestKernelInfo`);
                break;
            } else {
                traceVerbose(`Did not get a response for requestKernelInfo`);
                continue;
            }
        }
        if (gotIoPubMessage.completed) {
            traceVerbose('Successfully compelted postStartRawSession');
        } else {
            traceWarning(`Didn't get response for requestKernelInfo after ${stopWatch.elapsedTime}ms.`);
        }
        sendKernelTelemetryEvent(
            this.resource,
            Telemetry.RawKernelInfoResponse,
            { duration: stopWatch.elapsedTime, attempts },
            {
                timedout: !gotIoPubMessage.completed
            }
        );

        /**
         * To get a better understanding of the way Jupyter works, we need to look at Jupyter Client code.
         * Here's an excerpt (there are a lot of checks in a number of different files, this is NOT he only place)
         * Leaving this here for reference purposes.

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

        return result;
    }
}
