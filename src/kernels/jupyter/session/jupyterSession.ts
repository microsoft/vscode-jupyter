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
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';
import { Cancellation } from '../../../client/common/cancellation';
import { BaseError } from '../../../client/../extension/errors/types';
import { traceVerbose, traceError, traceInfo, traceInfoIfCI } from '../../../client/common/logger';
import { Resource, IOutputChannel } from '../../../client/common/types';
import { waitForCondition } from '../../../client/common/utils/async';
import { DataScience } from '../../../client/common/utils/localize';
import { DisplayOptions } from '../../../client/datascience/displayOptions';
import { JupyterInvalidKernelError } from '../../../extension/errors/jupyterInvalidKernelError';
import { SessionDisposedError } from '../../../extension/errors/sessionDisposedError';
import { IJupyterConnection, IDisplayOptions, ISessionWithSocket } from '../../../client/datascience/types';
import { captureTelemetry } from '../../../client/telemetry';
import { Telemetry } from '../../../datascience-ui/common/constants';
import { BaseJupyterSession, JupyterSessionStartError } from '../../common/baseJupyterSession';
import { getNameOfKernelConnection } from '../../helpers';
import { KernelConnectionMetadata, isLocalConnection } from '../../types';
import { JupyterKernelService } from '../jupyterKernelService';
import { JupyterWebSockets } from './jupyterWebSocket';
import { getDisplayPath } from '../../../client/common/platform/fs-paths';

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

    @captureTelemetry(Telemetry.WaitForIdleJupyter, undefined, true)
    public waitForIdle(timeout: number): Promise<void> {
        // Wait for idle on this session
        return this.waitForIdleOnSession(this.session, timeout);
    }

    public get kernel(): Kernel.IKernelConnection | undefined {
        return this.session?.kernel || undefined;
    }

    public get kernelId(): string {
        return this.session?.kernel?.id || '';
    }

    public async connect(options: { token: CancellationToken; ui: IDisplayOptions }): Promise<void> {
        // Start a new session
        this.setSession(await this.createNewKernelSession(options));

        // Listen for session status changes
        this.session?.statusChanged.connect(this.statusHandler); // NOSONAR

        // Made it this far, we're connected now
        this.connected = true;
    }

    public async createNewKernelSession(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
    }): Promise<ISessionWithSocket> {
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

                // newSession.kernel?.connectionStatus
                await waitForCondition(
                    async () => newSession?.kernel?.connectionStatus === 'connected',
                    this.idleTimeout,
                    100
                );
            } else {
                traceVerbose(`createNewKernelSession ${this.kernelConnectionMetadata?.id}`);
                newSession = await this.createSession(options);
                newSession.resource = this.resource;

                // Make sure it is idle before we return
                await this.waitForIdleOnSession(newSession, this.idleTimeout);
            }
        } catch (exc) {
            // Don't log errors if UI is disabled (e.g. auto starting a kernel)
            // Else we just pollute the logs with lots of noise.
            const loggerFn = options.ui.disableUI ? traceVerbose : traceError;
            // Don't swallow known exceptions.
            if (exc instanceof BaseError) {
                loggerFn('Failed to change kernel, re-throwing', exc);
                throw exc;
            } else {
                loggerFn('Failed to change kernel', exc);
                // Throw a new exception indicating we cannot change.
                throw new JupyterInvalidKernelError(this.kernelConnectionMetadata);
            }
        }

        return newSession;
    }

    protected async createRestartSession(
        disableUI: boolean,
        session: ISessionWithSocket,
        cancelToken: CancellationToken
    ): Promise<ISessionWithSocket> {
        // We need all of the above to create a restart session
        if (!session || !this.contentsManager || !this.sessionManager) {
            throw new SessionDisposedError();
        }
        let result: ISessionWithSocket | undefined;
        let tryCount = 0;
        const ui = new DisplayOptions(disableUI);
        try {
            traceVerbose(
                `JupyterSession.createNewKernelSession ${tryCount}, id is ${this.kernelConnectionMetadata?.id}`
            );
            result = await this.createSession({ token: cancelToken, ui });
            await this.waitForIdleOnSession(result, this.idleTimeout);
            if (result.kernel) {
                this.restartSessionCreated(result.kernel);
            }
            return result;
        } catch (exc) {
            traceInfo(`Error waiting for restart session: ${exc}`);
            if (result) {
                this.shutdownSession(result, undefined, true).ignoreErrors();
            }
            result = undefined;
            throw exc;
        } finally {
            ui.dispose();
        }
    }

    protected startRestartSession(disableUI: boolean) {
        if (!this.restartSessionPromise && this.session && this.contentsManager) {
            const token = new CancellationTokenSource();
            const promise = this.createRestartSession(disableUI, this.session, token.token);
            this.restartSessionPromise = { token, promise };
            promise.finally(() => token.dispose());
        }
    }

    private async createBackingFile(): Promise<Contents.IModel | undefined> {
        let backingFile: Contents.IModel | undefined = undefined;

        // First make sure the notebook is in the right relative path (jupyter expects a relative path with unix delimiters)
        const relativeDirectory = path.relative(this.connInfo.rootDirectory, this.workingDirectory).replace(/\\/g, '/');

        // However jupyter does not support relative paths outside of the original root.
        const backingFileOptions: Contents.ICreateOptions =
            isLocalConnection(this.kernelConnectionMetadata) && !relativeDirectory.startsWith('..')
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
            if (isLocalConnection(this.kernelConnectionMetadata)) {
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

    private async createSession(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
    }): Promise<ISessionWithSocket> {
        traceInfoIfCI(
            `JupyterSession.createSession for ${getDisplayPath(this.resource)}, options.ui.disableUI=${
                options.ui.disableUI
            }`
        );
        // Create our backing file for the notebook
        const backingFile = await this.createBackingFile();

        // Make sure the kernel has ipykernel installed if on a local machine.
        if (this.kernelConnectionMetadata?.interpreter && isLocalConnection(this.kernelConnectionMetadata)) {
            // Make sure the kernel actually exists and is up to date.
            try {
                traceInfoIfCI(
                    `JupyterSession.createSession ${this.kernelConnectionMetadata.id} for ${getDisplayPath(
                        this.resource
                    )}, options.ui.disableUI=${options.ui.disableUI}`
                );
                await this.kernelService.ensureKernelIsUsable(
                    this.resource,
                    this.kernelConnectionMetadata,
                    options.ui,
                    options.token
                );
            } catch (ex) {
                // If we failed to create the kernel, we need to clean up the file.
                if (this.connInfo && backingFile) {
                    this.contentsManager.delete(backingFile.path).ignoreErrors();
                }
                throw ex;
            }
        }

        // If kernelName is empty this can cause problems for servers that don't
        // understand that empty kernel name means the default kernel.
        // See https://github.com/microsoft/vscode-jupyter/issues/5290
        const kernelName =
            getNameOfKernelConnection(this.kernelConnectionMetadata) ?? this.specsManager?.specs?.default ?? '';

        // Create our session options using this temporary notebook and our connection info
        const sessionOptions: Session.ISessionOptions = {
            path: backingFile?.path || `${uuid()}.ipynb`, // Name has to be unique
            kernel: {
                name: kernelName
            },
            name: uuid(), // This is crucial to distinguish this session from any other.
            type: 'notebook'
        };

        traceInfo(
            `Starting a new session for kernel id = ${
                this.kernelConnectionMetadata?.id
            }, name = ${kernelName} for ${getDisplayPath(this.resource)}`
        );
        return Cancellation.race(
            () =>
                this.sessionManager!.startNew(sessionOptions, {
                    kernelConnectionOptions: {
                        handleComms: true // This has to be true for ipywidgets to work
                    }
                })
                    .then(async (session) => {
                        if (session.kernel) {
                            this.logRemoteOutput(
                                DataScience.createdNewKernel().format(this.connInfo.baseUrl, session?.kernel?.id || '')
                            );
                            const sessionWithSocket = session as ISessionWithSocket;

                            // Add on the kernel metadata & sock information
                            sessionWithSocket.resource = this.resource;
                            sessionWithSocket.kernelConnectionMetadata = this.kernelConnectionMetadata;
                            sessionWithSocket.kernelSocketInformation = {
                                get socket() {
                                    // When we restart kernels, a new websocket is created and we need to get the new one.
                                    // & the id in the dictionary is the kernel.id.
                                    return JupyterWebSockets.get(session.kernel!.id);
                                },
                                options: {
                                    clientId: session.kernel.clientId,
                                    id: session.kernel.id,
                                    model: { ...session.kernel.model },
                                    userName: session.kernel.username
                                }
                            };
                            if (!isLocalConnection(this.kernelConnectionMetadata)) {
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
            options.token
        );
    }

    private logRemoteOutput(output: string) {
        if (!isLocalConnection(this.kernelConnectionMetadata)) {
            this.outputChannel.appendLine(output);
        }
    }
}
