// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type {
    Contents,
    ContentsManager,
    Kernel,
    ServerConnection,
    Session,
    SessionManager
} from '@jupyterlab/services';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { CancellationToken } from 'vscode-jsonrpc';
import { Cancellation } from '../../common/cancellation';
import { traceError, traceInfo } from '../../common/logger';
import { IOutputChannel } from '../../common/types';
import { Deferred, createDeferredFromPromise } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { captureTelemetry } from '../../telemetry';
import { BaseJupyterSession, JupyterSessionStartError } from '../baseJupyterSession';
import { Telemetry } from '../constants';
import { IpyKernelNotInstalledError } from '../kernel-launcher/types';
import { reportAction } from '../progress/decorator';
import { ReportableAction } from '../progress/types';
import {
    IJupyterConnection,
    IKernelDependencyService,
    ISessionWithSocket,
    KernelInterpreterDependencyResponse
} from '../types';
import { JupyterInvalidKernelError } from './jupyterInvalidKernelError';
import { JupyterWaitForIdleError } from './jupyterWaitForIdleError';
import { JupyterWebSockets } from './jupyterWebSocket';
import { getNameOfKernelConnection } from './kernels/helpers';
import { KernelConnectionMetadata } from './kernels/types';
//
export class JupyterSession extends BaseJupyterSession {
    private dependencyPromises = new Map<string, Deferred<KernelInterpreterDependencyResponse>>();

    constructor(
        private connInfo: IJupyterConnection,
        private serverSettings: ServerConnection.ISettings,
        kernelSpec: KernelConnectionMetadata | undefined,
        private sessionManager: SessionManager,
        private contentsManager: ContentsManager,
        private readonly outputChannel: IOutputChannel,
        private readonly restartSessionCreated: (id: Kernel.IKernelConnection) => void,
        restartSessionUsed: (id: Kernel.IKernelConnection) => void,
        readonly workingDirectory: string,
        private readonly idleTimeout: number,
        private readonly kernelDependencyService: IKernelDependencyService
    ) {
        super(restartSessionUsed, workingDirectory, idleTimeout);
        this.kernelConnectionMetadata = kernelSpec;
    }

    @reportAction(ReportableAction.JupyterSessionWaitForIdleSession)
    @captureTelemetry(Telemetry.WaitForIdleJupyter, undefined, true)
    public waitForIdle(timeout: number): Promise<void> {
        // Wait for idle on this session
        return this.waitForIdleOnSession(this.session, timeout);
    }

    public async connect(timeoutMs: number, cancelToken?: CancellationToken, disableUI?: boolean): Promise<void> {
        if (!this.connInfo) {
            throw new Error(localize.DataScience.sessionDisposed());
        }

        // Start a new session
        this.setSession(
            await this.createNewKernelSession(this.kernelConnectionMetadata, timeoutMs, cancelToken, disableUI)
        );

        // Listen for session status changes
        this.session?.statusChanged.connect(this.statusHandler); // NOSONAR

        // Made it this far, we're connected now
        this.connected = true;
    }

    public async createNewKernelSession(
        kernelConnection: KernelConnectionMetadata | undefined,
        timeoutMS: number,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<ISessionWithSocket> {
        let newSession: ISessionWithSocket | undefined;

        try {
            // Don't immediately assume this kernel is valid. Try creating a session with it first.
            if (
                kernelConnection &&
                kernelConnection.kind === 'connectToLiveKernel' &&
                kernelConnection.kernelModel.id
            ) {
                // Remote case.
                newSession = this.sessionManager.connectTo(kernelConnection.kernelModel.session);
                newSession.isRemoteSession = true;
            } else {
                newSession = await this.createSession(this.serverSettings, kernelConnection, cancelToken, disableUI);
                if (!this.connInfo.localLaunch) {
                    newSession.isRemoteSession = true;
                }
            }

            // Make sure it is idle before we return
            await this.waitForIdleOnSession(newSession, timeoutMS);
        } catch (exc) {
            if (exc instanceof JupyterWaitForIdleError) {
                throw exc;
            } else {
                traceError('Failed to change kernel', exc);
                // Throw a new exception indicating we cannot change.
                throw new JupyterInvalidKernelError(kernelConnection);
            }
        }

        return newSession;
    }

    protected async createRestartSession(
        kernelConnection: KernelConnectionMetadata | undefined,
        session: ISessionWithSocket,
        _timeout: number,
        cancelToken?: CancellationToken
    ): Promise<ISessionWithSocket> {
        // We need all of the above to create a restart session
        if (!session || !this.contentsManager || !this.sessionManager) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        let result: ISessionWithSocket | undefined;
        let tryCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let exception: any;
        while (tryCount < 3) {
            try {
                result = await this.createSession(session.serverSettings, kernelConnection, cancelToken, true);
                await this.waitForIdleOnSession(result, this.idleTimeout);
                this.restartSessionCreated(result.kernel);
                return result;
            } catch (exc) {
                traceInfo(`Error waiting for restart session: ${exc}`);
                tryCount += 1;
                if (result) {
                    this.shutdownSession(result, undefined).ignoreErrors();
                }
                result = undefined;
                exception = exc;
            }
        }
        throw exception;
    }

    protected startRestartSession(timeout: number) {
        if (!this.restartSessionPromise && this.session && this.contentsManager) {
            this.restartSessionPromise = this.createRestartSession(
                this.kernelConnectionMetadata,
                this.session,
                timeout
            );
        }
    }

    private async createBackingFile(): Promise<Contents.IModel> {
        let backingFile: Contents.IModel;

        // First make sure the notebook is in the right relative path (jupyter expects a relative path with unix delimiters)
        const relativeDirectory = path.relative(this.connInfo.rootDirectory, this.workingDirectory).replace(/\\/g, '/');

        // However jupyter does not support relative paths outside of the original root.
        const backingFileOptions: Contents.ICreateOptions =
            this.connInfo.localLaunch && !relativeDirectory.startsWith('..')
                ? { type: 'notebook', path: relativeDirectory }
                : { type: 'notebook' };

        try {
            // Create a temporary notebook for this session. Each needs a unique name (otherwise we get the same session every time)
            backingFile = await this.contentsManager.newUntitled(backingFileOptions);
            const backingFileDir = path.dirname(backingFile.path);
            backingFile = await this.contentsManager.rename(
                backingFile.path,
                backingFileDir.length && backingFileDir !== '.'
                    ? `${backingFileDir}/t-${uuid()}.ipynb`
                    : `t-${uuid()}.ipynb` // Note, the docs say the path uses UNIX delimiters.
            );
        } catch (exc) {
            // If it failed for local, try without a relative directory
            if (this.connInfo.localLaunch) {
                backingFile = await this.contentsManager.newUntitled({ type: 'notebook' });
                const backingFileDir = path.dirname(backingFile.path);
                backingFile = await this.contentsManager.rename(
                    backingFile.path,
                    backingFileDir.length && backingFileDir !== '.'
                        ? `${backingFileDir}/t-${uuid()}.ipynb`
                        : `t-${uuid()}.ipynb` // Note, the docs say the path uses UNIX delimiters.
                );
            } else {
                throw exc;
            }
        }

        if (backingFile) {
            return backingFile;
        }
        throw new Error(`Backing file cannot be generated for Jupyter connection`);
    }

    private async createSession(
        serverSettings: ServerConnection.ISettings,
        kernelConnection: KernelConnectionMetadata | undefined,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<ISessionWithSocket> {
        // Create our backing file for the notebook
        const backingFile = await this.createBackingFile();

        // Make sure the kernel has ipykernel installed if on a local machine.
        if (kernelConnection?.interpreter && this.connInfo.localLaunch) {
            await this.installDependenciesIntoInterpreter(kernelConnection.interpreter, cancelToken, disableUI);
        }

        // Create our session options using this temporary notebook and our connection info
        const options: Session.IOptions = {
            path: backingFile.path,
            kernelName: getNameOfKernelConnection(kernelConnection) || '',
            name: uuid(), // This is crucial to distinguish this session from any other.
            serverSettings: serverSettings
        };

        return Cancellation.race(
            () =>
                this.sessionManager!.startNew(options)
                    .then(async (session) => {
                        this.logRemoteOutput(
                            localize.DataScience.createdNewKernel().format(this.connInfo.baseUrl, session.kernel.id)
                        );

                        // Add on the kernel sock information
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (session as any).kernelSocketInformation = {
                            socket: JupyterWebSockets.get(session.kernel.id),
                            options: {
                                clientId: session.kernel.clientId,
                                id: session.kernel.id,
                                model: { ...session.kernel.model },
                                userName: session.kernel.username
                            }
                        };

                        return session;
                    })
                    .catch((ex) => Promise.reject(new JupyterSessionStartError(ex)))
                    .finally(() => {
                        if (this.connInfo) {
                            this.contentsManager.delete(backingFile.path).ignoreErrors();
                        }
                    }),
            cancelToken
        );
    }

    private logRemoteOutput(output: string) {
        if (this.connInfo && !this.connInfo.localLaunch) {
            this.outputChannel.appendLine(output);
        }
    }

    private async installDependenciesIntoInterpreter(
        interpreter: PythonEnvironment,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ) {
        // TODO: On next submission move this code into a common location.

        // Cache the install question so when two kernels start at the same time for the same interpreter we don't ask twice
        let deferred = this.dependencyPromises.get(interpreter.path);
        if (!deferred) {
            deferred = createDeferredFromPromise(
                this.kernelDependencyService.installMissingDependencies(interpreter, cancelToken, disableUI)
            );
            this.dependencyPromises.set(interpreter.path, deferred);
        }

        // Get the result of the question
        try {
            const result = await deferred.promise;
            if (result !== KernelInterpreterDependencyResponse.ok) {
                throw new IpyKernelNotInstalledError(
                    localize.DataScience.ipykernelNotInstalled().format(
                        `${interpreter.displayName || interpreter.path}:${interpreter.path}`
                    ),
                    result
                );
            }
        } finally {
            // Don't need to cache anymore
            this.dependencyPromises.delete(interpreter.path);
        }
    }
}
