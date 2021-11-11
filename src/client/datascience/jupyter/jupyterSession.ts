// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type {
    Contents,
    ContentsManager,
    Kernel,
    KernelSpecManager,
    Session,
    SessionManager
} from '@jupyterlab/services';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { CancellationToken } from 'vscode-jsonrpc';
import { Cancellation } from '../../common/cancellation';
import { BaseError } from '../../common/errors/types';
import { traceError, traceInfo, traceInfoIfCI } from '../../common/logger';
import { IOutputChannel, Resource } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { DataScience } from '../../common/utils/localize';
import { captureTelemetry } from '../../telemetry';
import { BaseJupyterSession, JupyterSessionStartError } from '../baseJupyterSession';
import { Telemetry } from '../constants';
import { reportAction } from '../progress/decorator';
import { ReportableAction } from '../progress/types';
import { IJupyterConnection, ISessionWithSocket } from '../types';
import { JupyterInvalidKernelError } from '../errors/jupyterInvalidKernelError';
import { JupyterWebSockets } from './jupyterWebSocket';
import { getNameOfKernelConnection } from './kernels/helpers';
import { JupyterKernelService } from './kernels/jupyterKernelService';
import { KernelConnectionMetadata } from './kernels/types';
import { SessionDisposedError } from '../errors/sessionDisposedError';

const jvscIdentifier = '-jvsc-';
function getRemoteIPynbSuffix(): string {
    return `${jvscIdentifier}${uuid()}`;
}

/**
 * When creating remote sessions, we generate bogus names for the notebook.
 * These names are prefixed with the same local file name, and a random suffix.
 * However the random part does contain an identifier, and we can stip this off
 * to get the original local ipynb file name.
 */
export function removeNotebookSuffixAddedByExtension(notebookPath: string) {
    if (notebookPath.includes(jvscIdentifier)) {
        const guidRegEx = /[a-f0-9]$/;
        if (
            notebookPath
                .substring(notebookPath.lastIndexOf(jvscIdentifier) + jvscIdentifier.length)
                .search(guidRegEx) !== -1
        ) {
            return `${notebookPath.substring(0, notebookPath.lastIndexOf(jvscIdentifier))}.ipynb`;
        }
    }
    return notebookPath;
}
// function is
export class JupyterSession extends BaseJupyterSession {
    constructor(
        resource: Resource,
        private connInfo: IJupyterConnection,
        kernelConnectionMetadata: KernelConnectionMetadata,
        private specsManager: KernelSpecManager,
        private sessionManager: SessionManager,
        private contentsManager: ContentsManager,
        private readonly outputChannel: IOutputChannel,
        private readonly restartSessionCreated: (id: Kernel.IKernelConnection) => void,
        restartSessionUsed: (id: Kernel.IKernelConnection) => void,
        readonly workingDirectory: string,
        private readonly idleTimeout: number,
        private readonly kernelService: JupyterKernelService,
        interruptTimeout: number
    ) {
        super(resource, kernelConnectionMetadata, restartSessionUsed, workingDirectory, interruptTimeout);
    }

    @reportAction(ReportableAction.JupyterSessionWaitForIdleSession)
    @captureTelemetry(Telemetry.WaitForIdleJupyter, undefined, true)
    public waitForIdle(timeout: number): Promise<void> {
        // Wait for idle on this session
        return this.waitForIdleOnSession(this.session, timeout);
    }

    public async connect(cancelToken?: CancellationToken, disableUI?: boolean): Promise<void> {
        // Start a new session
        this.setSession(await this.createNewKernelSession(cancelToken, disableUI));

        // Listen for session status changes
        this.session?.statusChanged.connect(this.statusHandler); // NOSONAR

        // Made it this far, we're connected now
        this.connected = true;
    }

    public async createNewKernelSession(
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<ISessionWithSocket> {
        let newSession: ISessionWithSocket | undefined;
        try {
            // Don't immediately assume this kernel is valid. Try creating a session with it first.
            if (
                this.kernelConnectionMetadata &&
                this.kernelConnectionMetadata.kind === 'connectToLiveKernel' &&
                this.kernelConnectionMetadata.kernelModel.id &&
                this.kernelConnectionMetadata.kernelModel.model
            ) {
                // Remote case.
                newSession = this.sessionManager.connectTo({
                    ...this.kernelConnectionMetadata.kernelModel,
                    model: this.kernelConnectionMetadata.kernelModel.model
                }) as ISessionWithSocket;
                newSession.kernelConnectionMetadata = this.kernelConnectionMetadata;
                newSession.kernelSocketInformation = {
                    socket: JupyterWebSockets.get(this.kernelConnectionMetadata.id),
                    options: {
                        clientId: '',
                        id: this.kernelConnectionMetadata.id,
                        model: { ...this.kernelConnectionMetadata.kernelModel.model },
                        userName: ''
                    }
                };
                newSession.isRemoteSession = true;
                newSession.resource = this.resource;
            } else {
                traceInfoIfCI(`createNewKernelSession ${this.kernelConnectionMetadata?.id}`);
                newSession = await this.createSession(cancelToken, disableUI);
                newSession.resource = this.resource;
            }

            // Make sure it is idle before we return
            await this.waitForIdleOnSession(newSession, this.idleTimeout);
        } catch (exc) {
            // Don't swallow known exceptions.
            if (exc instanceof BaseError) {
                traceError('Failed to change kernel, re-throwing', exc);
                throw exc;
            } else {
                traceError('Failed to change kernel', exc);
                // Throw a new exception indicating we cannot change.
                throw new JupyterInvalidKernelError(this.kernelConnectionMetadata);
            }
        }

        return newSession;
    }

    protected async createRestartSession(
        session: ISessionWithSocket,
        cancelToken?: CancellationToken
    ): Promise<ISessionWithSocket> {
        // We need all of the above to create a restart session
        if (!session || !this.contentsManager || !this.sessionManager) {
            throw new SessionDisposedError();
        }
        let result: ISessionWithSocket | undefined;
        let tryCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let exception: any;
        while (tryCount < 3) {
            try {
                traceInfoIfCI(
                    `JupyterSession.createNewKernelSession ${tryCount}, id is ${this.kernelConnectionMetadata?.id}`
                );
                result = await this.createSession(cancelToken, true);
                await this.waitForIdleOnSession(result, this.idleTimeout);
                if (result.kernel) {
                    this.restartSessionCreated(result.kernel);
                }
                return result;
            } catch (exc) {
                traceInfo(`Error waiting for restart session: ${exc}`);
                tryCount += 1;
                if (result) {
                    this.shutdownSession(result, undefined, true).ignoreErrors();
                }
                result = undefined;
                exception = exc;
            }
        }
        throw exception;
    }

    protected startRestartSession() {
        if (!this.restartSessionPromise && this.session && this.contentsManager) {
            this.restartSessionPromise = this.createRestartSession(this.session);
        }
    }

    private async createBackingFile(): Promise<Contents.IModel | undefined> {
        let backingFile: Contents.IModel | undefined = undefined;

        // First make sure the notebook is in the right relative path (jupyter expects a relative path with unix delimiters)
        const relativeDirectory = path.relative(this.connInfo.rootDirectory, this.workingDirectory).replace(/\\/g, '/');

        // However jupyter does not support relative paths outside of the original root.
        const backingFileOptions: Contents.ICreateOptions =
            this.connInfo.localLaunch && !relativeDirectory.startsWith('..')
                ? { type: 'notebook', path: relativeDirectory }
                : { type: 'notebook' };

        // Generate a more descriptive name
        const newName = this.resource
            ? `${path.basename(this.resource.fsPath, '.ipynb')}${getRemoteIPynbSuffix()}.ipynb`
            : `${DataScience.defaultNotebookName()}-${uuid()}.ipynb`;

        try {
            // Create a temporary notebook for this session. Each needs a unique name (otherwise we get the same session every time)
            backingFile = await this.contentsManager.newUntitled(backingFileOptions);
            const backingFileDir = path.dirname(backingFile.path);
            backingFile = await this.contentsManager.rename(
                backingFile.path,
                backingFileDir.length && backingFileDir !== '.' ? `${backingFileDir}/${newName}` : newName // Note, the docs say the path uses UNIX delimiters.
            );
        } catch (exc) {
            // If it failed for local, try without a relative directory
            if (this.connInfo.localLaunch) {
                try {
                    backingFile = await this.contentsManager.newUntitled({ type: 'notebook' });
                    const backingFileDir = path.dirname(backingFile.path);
                    backingFile = await this.contentsManager.rename(
                        backingFile.path,
                        backingFileDir.length && backingFileDir !== '.' ? `${backingFileDir}/${newName}` : newName // Note, the docs say the path uses UNIX delimiters.
                    );
                } catch (e) {}
            } else {
                traceError(`Backing file not supported: ${exc}`);
            }
        }

        if (backingFile) {
            return backingFile;
        }
    }

    private async createSession(cancelToken?: CancellationToken, disableUI?: boolean): Promise<ISessionWithSocket> {
        // Create our backing file for the notebook
        const backingFile = await this.createBackingFile();

        // Make sure the kernel has ipykernel installed if on a local machine.
        if (this.kernelConnectionMetadata?.interpreter && this.connInfo.localLaunch) {
            // Make sure the kernel actually exists and is up to date.
            traceInfoIfCI(`JupyterSession.createSession ${this.kernelConnectionMetadata.id}`);
            await this.kernelService.ensureKernelIsUsable(
                this.resource,
                this.kernelConnectionMetadata,
                cancelToken,
                disableUI
            );
        }

        // If kernelName is empty this can cause problems for servers that don't
        // understand that empty kernel name means the default kernel.
        // See https://github.com/microsoft/vscode-jupyter/issues/5290
        const kernelName =
            getNameOfKernelConnection(this.kernelConnectionMetadata) ?? this.specsManager?.specs?.default ?? '';

        // Create our session options using this temporary notebook and our connection info
        const options: Session.ISessionOptions = {
            path: backingFile?.path || `${uuid()}.ipynb`, // Name has to be unique
            kernel: {
                name: kernelName
            },
            name: uuid(), // This is crucial to distinguish this session from any other.
            type: 'notebook'
        };

        traceInfo(`Starting a new session for kernel id = ${this.kernelConnectionMetadata?.id}, name = ${kernelName}`);
        return Cancellation.race(
            () =>
                this.sessionManager!.startNew(options, {
                    kernelConnectionOptions: {
                        handleComms: true // This has to be true for ipywidgets to work
                    }
                })
                    .then(async (session) => {
                        if (session.kernel) {
                            this.logRemoteOutput(
                                localize.DataScience.createdNewKernel().format(
                                    this.connInfo.baseUrl,
                                    session?.kernel?.id || ''
                                )
                            );
                            const sessionWithSocket = session as ISessionWithSocket;

                            // Add on the kernel metadata & sock information
                            sessionWithSocket.resource = this.resource;
                            sessionWithSocket.kernelConnectionMetadata = this.kernelConnectionMetadata;
                            sessionWithSocket.kernelSocketInformation = {
                                socket: JupyterWebSockets.get(session.kernel.id),
                                options: {
                                    clientId: session.kernel.clientId,
                                    id: session.kernel.id,
                                    model: { ...session.kernel.model },
                                    userName: session.kernel.username
                                }
                            };
                            if (!this.connInfo.localLaunch) {
                                sessionWithSocket.isRemoteSession = true;
                            }
                            return sessionWithSocket;
                        }
                        throw new JupyterSessionStartError(new Error(`No kernel created`));
                    })
                    .catch((ex) => Promise.reject(new JupyterSessionStartError(ex)))
                    .finally(() => {
                        if (this.connInfo && backingFile) {
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
}
