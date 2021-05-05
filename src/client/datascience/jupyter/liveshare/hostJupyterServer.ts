// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { nbformat } from '@jupyterlab/coreutils';
import * as os from 'os';
import * as vscode from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import * as vsls from 'vsls/vscode';
import { IPythonExtensionChecker } from '../../../api/types';
import {
    IApplicationShell,
    ILiveShareApi,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../../common/application/types';
import { traceInfo } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IOutputChannel,
    Resource
} from '../../../common/types';
import { createDeferred } from '../../../common/utils/async';
import * as localize from '../../../common/utils/localize';
import { IInterpreterService } from '../../../interpreter/contracts';
import { IServiceContainer } from '../../../ioc/types';
import { Identifiers, LiveShare, LiveShareCommands, RegExpValues } from '../../constants';
import { isResourceNativeNotebook } from '../../notebook/helpers/helpers';
import { ProgressReporter } from '../../progress/progressReporter';
import {
    IJupyterSession,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    INotebook,
    INotebookExecutionLogger,
    INotebookServer,
    INotebookServerLaunchInfo
} from '../../types';
import { JupyterServerBase } from '../jupyterServer';
import { computeWorkingDirectory } from '../jupyterUtils';
import { getDisplayNameOrNameOfKernelConnection } from '../kernels/helpers';
import { KernelConnectionMetadata } from '../kernels/types';
import { HostJupyterNotebook } from './hostJupyterNotebook';
import { LiveShareParticipantHost } from './liveShareParticipantMixin';
import { IRoleBasedObject } from './roleBasedFactory';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../../kernel-launcher/types';
import { IPythonExecutionFactory } from '../../../common/process/types';
/* eslint-disable @typescript-eslint/no-explicit-any */

export class HostJupyterServer extends LiveShareParticipantHost(JupyterServerBase, LiveShare.JupyterServerSharedService)
    implements IRoleBasedObject, INotebookServer {
    private disposed = false;
    private portToForward = 0;
    private sharedPort: vscode.Disposable | undefined;
    constructor(
        private liveShare: ILiveShareApi,
        _startupTime: number,
        asyncRegistry: IAsyncDisposableRegistry,
        disposableRegistry: IDisposableRegistry,
        configService: IConfigurationService,
        sessionManager: IJupyterSessionManagerFactory,
        private workspaceService: IWorkspaceService,
        serviceContainer: IServiceContainer,
        private appService: IApplicationShell,
        private fs: IFileSystem,
        private readonly localKernelFinder: ILocalKernelFinder,
        private readonly remoteKernelFinder: IRemoteKernelFinder,
        private readonly interpreterService: IInterpreterService,
        outputChannel: IOutputChannel,
        private readonly progressReporter: ProgressReporter,
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly vscodeNotebook: IVSCodeNotebook
    ) {
        super(
            liveShare,
            asyncRegistry,
            disposableRegistry,
            configService,
            sessionManager,
            serviceContainer,
            outputChannel
        );
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            traceInfo(`Disposing HostJupyterServer`);
            await super.dispose();
            const api = await this.api;
            await this.onDetach(api);
            traceInfo(`Finished disposing HostJupyterServer`);
        }
    }

    public async connect(launchInfo: INotebookServerLaunchInfo, cancelToken?: CancellationToken): Promise<void> {
        if (launchInfo.connectionInfo && launchInfo.connectionInfo.localLaunch) {
            const portMatch = RegExpValues.ExtractPortRegex.exec(launchInfo.connectionInfo.baseUrl);
            if (portMatch && portMatch.length > 1) {
                const port = parseInt(portMatch[1], 10);
                await this.attemptToForwardPort(this.finishedApi, port);
            }
        }
        return super.connect(launchInfo, cancelToken);
    }

    public async onAttach(api: vsls.LiveShare | null): Promise<void> {
        await super.onAttach(api);

        if (api && !this.disposed) {
            const service = await this.waitForService();

            // Attach event handlers to different requests
            if (service) {
                // Requests return arrays
                service.onRequest(LiveShareCommands.syncRequest, (_args: any[], _cancellation: CancellationToken) =>
                    this.onSync()
                );
                service.onRequest(LiveShareCommands.disposeServer, (_args: any[], _cancellation: CancellationToken) =>
                    this.dispose()
                );
                service.onRequest(
                    LiveShareCommands.createNotebook,
                    async (args: any[], cancellation: CancellationToken) => {
                        const resource = this.parseUri(args[0]);
                        const identity = this.parseUri(args[1]);
                        // Don't return the notebook. We don't want it to be serialized. We just want its live share server to be started.
                        const notebook = (await this.createNotebook(
                            resource,
                            identity!,
                            undefined,
                            undefined,
                            cancellation
                        )) as HostJupyterNotebook;
                        await notebook.onAttach(api);
                    }
                );

                // See if we need to forward the port
                await this.attemptToForwardPort(api, this.portToForward);
            }
        }
    }

    public async onSessionChange(api: vsls.LiveShare | null): Promise<void> {
        await super.onSessionChange(api);

        this.getNotebooks().forEach(async (notebook) => {
            const hostNotebook = (await notebook) as HostJupyterNotebook;
            if (hostNotebook) {
                await hostNotebook.onSessionChange(api);
            }
        });
    }

    public async onDetach(api: vsls.LiveShare | null): Promise<void> {
        await super.onDetach(api);

        // Make sure to unshare our port
        if (api && this.sharedPort) {
            this.sharedPort.dispose();
            this.sharedPort = undefined;
        }
    }

    public async waitForServiceName(): Promise<string> {
        // First wait for connect to occur
        const launchInfo = await this.waitForConnect();

        // Use our base name plus our purpose. This means one unique server per purpose
        if (!launchInfo) {
            return LiveShare.JupyterServerSharedService;
        }
        // eslint-disable-next-line
        // TODO: Should there be some separator in the name?
        return `${LiveShare.JupyterServerSharedService}${launchInfo.purpose}`;
    }

    protected get isDisposed() {
        return this.disposed;
    }

    protected async createNotebookInstance(
        resource: Resource,
        identity: vscode.Uri,
        sessionManager: IJupyterSessionManager,
        possibleSession: IJupyterSession | undefined,
        disposableRegistry: IDisposableRegistry,
        configService: IConfigurationService,
        serviceContainer: IServiceContainer,
        notebookMetadata?: nbformat.INotebookMetadata,
        kernelConnection?: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<INotebook> {
        // See if already exists.
        const existing = await this.getNotebook(identity);
        if (existing) {
            // Dispose the possible session as we don't need it
            if (possibleSession) {
                await possibleSession.dispose();
            }

            // Then we can return the existing notebook.
            return existing;
        }

        let progressDisposable: vscode.Disposable | undefined;

        // Compute launch information from the resource and the notebook metadata
        const notebookPromise = createDeferred<INotebook>();
        // Save the notebook
        this.setNotebook(identity, notebookPromise.promise);

        const getExistingSession = async () => {
            const { info, changedKernel } = await this.computeLaunchInfo(
                resource,
                notebookMetadata,
                kernelConnection,
                cancelToken
            );

            progressDisposable = this.progressReporter.createProgressIndicator(
                localize.DataScience.connectingToKernel().format(
                    getDisplayNameOrNameOfKernelConnection(info.kernelConnectionMetadata)
                )
            );

            // If we switched kernels, try switching the possible session
            if (changedKernel && possibleSession && info.kernelConnectionMetadata) {
                traceInfo(`Changing Kernel to ${JSON.stringify(info.kernelConnectionMetadata.id)}`);
                await possibleSession.changeKernel(
                    resource,
                    info.kernelConnectionMetadata,
                    this.configService.getSettings(resource).jupyterLaunchTimeout
                );
            }

            // Figure out the working directory we need for our new notebook. This is only necessary for local.
            const workingDirectory = info.connectionInfo.localLaunch
                ? await computeWorkingDirectory(resource, this.workspaceService)
                : '';
            const sessionDirectoryMatches =
                info.connectionInfo.localLaunch && possibleSession
                    ? this.fs.areLocalPathsSame(possibleSession.workingDirectory, workingDirectory)
                    : true;

            // Start a session (or use the existing one if allowed)
            const session =
                possibleSession && sessionDirectoryMatches
                    ? possibleSession
                    : await sessionManager.startNew(
                          resource,
                          info.kernelConnectionMetadata,
                          workingDirectory,
                          cancelToken
                      );
            traceInfo(`Started session ${this.id}`);
            return { info, session };
        };

        try {
            const { info, session } = await getExistingSession();

            if (session) {
                // Create our notebook
                const notebook = new HostJupyterNotebook(
                    this.liveShare,
                    session,
                    configService,
                    disposableRegistry,
                    info,
                    serviceContainer.getAll<INotebookExecutionLogger>(INotebookExecutionLogger),
                    resource,
                    identity,
                    this.getDisposedError.bind(this),
                    this.workspaceService,
                    this.appService,
                    this.fs,
                    this.vscodeNotebook,
                    serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory)
                );

                // Wait for it to be ready
                traceInfo(`Waiting for idle (session) ${this.id}`);
                const idleTimeout = configService.getSettings().jupyterLaunchTimeout;
                await notebook.waitForIdle(idleTimeout);

                // Run initial setup
                await notebook.initialize(cancelToken);

                traceInfo(`Finished connecting ${this.id}`);

                notebookPromise.resolve(notebook);
            } else {
                notebookPromise.reject(this.getDisposedError());
            }
        } catch (ex) {
            // If there's an error, then reject the promise that is returned.
            // This original promise must be rejected as it is cached (check `setNotebook`).
            notebookPromise.reject(ex);
        } finally {
            progressDisposable?.dispose();
        }

        return notebookPromise.promise;
    }

    private async computeLaunchInfo(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
        kernelConnection?: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<{ info: INotebookServerLaunchInfo; changedKernel: boolean }> {
        // First we need our launch information so we can start a new session (that's what our notebook is really)
        let launchInfo = await this.waitForConnect();
        if (!launchInfo) {
            throw this.getDisposedError();
        }
        traceInfo(`Compute Launch Info uri = ${resource?.fsPath}, kernelConnection id = ${kernelConnection?.id}`);
        // Create a copy of launch info, cuz we're modifying it here.
        // This launch info contains the server connection info (that could be shared across other nbs).
        // However the kernel info is different. The kernel info is stored as a  property of this, hence create a separate instance for each nb.
        launchInfo = {
            ...launchInfo
        };

        // Determine the interpreter for our resource. If different, we need a different kernel. This is unnecessary in remote
        const resourceInterpreter =
            this.extensionChecker.isPythonExtensionInstalled && launchInfo.connectionInfo.localLaunch
                ? await this.interpreterService.getActiveInterpreter(resource)
                : undefined;

        // Find a kernel that can be used.
        // Do this only if we don't have any kernel connection information, or the resource's interpreter is different.
        let changedKernel = false;
        if (
            // For local connections this code path is not executed for native notebooks (hence only for remote).
            (isResourceNativeNotebook(resource, this.vscodeNotebook, this.fs) &&
                !launchInfo.connectionInfo.localLaunch) ||
            !kernelConnection ||
            notebookMetadata?.kernelspec ||
            resourceInterpreter?.displayName !== launchInfo.kernelConnectionMetadata?.interpreter?.displayName
        ) {
            let kernelInfo: KernelConnectionMetadata | undefined;
            if (!launchInfo.connectionInfo.localLaunch && kernelConnection?.kind === 'connectToLiveKernel') {
                kernelInfo = kernelConnection;
            } else if (!launchInfo.connectionInfo.localLaunch && kernelConnection?.kind === 'startUsingKernelSpec') {
                kernelInfo = kernelConnection;
            } else if (launchInfo.connectionInfo.localLaunch && kernelConnection) {
                kernelInfo = kernelConnection;
            } else {
                kernelInfo = await (launchInfo.connectionInfo.localLaunch
                    ? this.localKernelFinder.findKernel(resource, notebookMetadata, cancelToken)
                    : this.remoteKernelFinder.findKernel(
                          resource,
                          launchInfo.connectionInfo,
                          notebookMetadata,
                          cancelToken
                      ));
            }
            if (kernelInfo && kernelInfo !== launchInfo.kernelConnectionMetadata) {
                // Update kernel info if we found a new one.
                launchInfo.kernelConnectionMetadata = kernelInfo;
                changedKernel = true;
            }
            traceInfo(
                `Compute Launch Info uri = ${resource?.fsPath}, changed ${changedKernel}, ${launchInfo.kernelConnectionMetadata?.id}`
            );
        }

        return { info: launchInfo, changedKernel };
    }

    private parseUri(uri: string | undefined): Resource {
        const parsed = uri ? vscode.Uri.parse(uri) : undefined;
        return parsed &&
            parsed.scheme &&
            parsed.scheme !== Identifiers.InteractiveWindowIdentityScheme &&
            parsed.scheme === 'vsls'
            ? this.finishedApi!.convertSharedUriToLocal(parsed)
            : parsed;
    }

    private async attemptToForwardPort(api: vsls.LiveShare | null | undefined, port: number): Promise<void> {
        if (port !== 0 && api && api.session && api.session.role === vsls.Role.Host) {
            this.portToForward = 0;
            this.sharedPort = await api.shareServer({
                port,
                displayName: localize.DataScience.liveShareHostFormat().format(os.hostname())
            });
        } else {
            this.portToForward = port;
        }
    }

    private onSync(): Promise<any> {
        return Promise.resolve(true);
    }
}
