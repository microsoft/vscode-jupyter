// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { nbformat } from '@jupyterlab/coreutils';
import * as vscode from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { IPythonExtensionChecker } from '../../../api/types';
import { IApplicationShell, IVSCodeNotebook, IWorkspaceService } from '../../../common/application/types';
import { traceInfo, traceInfoIf } from '../../../common/logger';
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
import { isResourceNativeNotebook } from '../../notebook/helpers/helpers';
import { ProgressReporter } from '../../progress/progressReporter';
import {
    IJupyterSession,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    INotebook,
    INotebookServer,
    INotebookServerLaunchInfo
} from '../../types';
import { JupyterServerBase } from '../jupyterServer';
import { computeWorkingDirectory } from '../jupyterUtils';
import { getDisplayNameOrNameOfKernelConnection } from '../kernels/helpers';
import { KernelConnectionMetadata } from '../kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../../kernel-launcher/types';
import { isCI, STANDARD_OUTPUT_CHANNEL } from '../../../common/constants';
import { inject, injectable, named } from 'inversify';
import { JupyterNotebookBase } from '../jupyterNotebook';
/* eslint-disable @typescript-eslint/no-explicit-any */

@injectable()
export class HostJupyterServer extends JupyterServerBase implements INotebookServer {
    private disposed = false;
    constructor(
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(IJupyterSessionManagerFactory) sessionManager: IJupyterSessionManagerFactory,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IApplicationShell) private readonly appService: IApplicationShell,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IRemoteKernelFinder) private readonly remoteKernelFinder: IRemoteKernelFinder,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) outputChannel: IOutputChannel,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IVSCodeNotebook) private readonly vscodeNotebook: IVSCodeNotebook
    ) {
        super(asyncRegistry, disposableRegistry, configService, sessionManager, outputChannel);
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            traceInfo(`Disposing HostJupyterServer`);
            await super.dispose();
            traceInfo(`Finished disposing HostJupyterServer`);
        }
    }

    public async connect(launchInfo: INotebookServerLaunchInfo, cancelToken?: CancellationToken): Promise<void> {
        return super.connect(launchInfo, cancelToken);
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
                const notebook = new JupyterNotebookBase(
                    session,
                    configService,
                    disposableRegistry,
                    info,
                    resource,
                    identity,
                    this.getDisposedError.bind(this),
                    this.workspaceService,
                    this.appService,
                    this.fs
                );

                // Wait for it to be ready
                traceInfo(`Waiting for idle (session) ${this.id}`);
                const idleTimeout = configService.getSettings().jupyterLaunchTimeout;
                await notebook.waitForIdle(idleTimeout);

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
                traceInfoIf(isCI, `kernelConnection?.kind === 'connectToLiveKernel'`);
                kernelInfo = kernelConnection;
            } else if (!launchInfo.connectionInfo.localLaunch && kernelConnection?.kind === 'startUsingKernelSpec') {
                traceInfoIf(isCI, `kernelConnection?.kind === 'startUsingKernelSpec'`);
                kernelInfo = kernelConnection;
            } else if (launchInfo.connectionInfo.localLaunch && kernelConnection) {
                traceInfoIf(isCI, `launchInfo.connectionInfo.localLaunch && kernelConnection'`);
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
                traceInfoIf(isCI, `kernelInfo found ${kernelInfo?.id}`);
            }
            if (kernelInfo && kernelInfo.id !== launchInfo.kernelConnectionMetadata?.id) {
                // Update kernel info if we found a new one.
                launchInfo.kernelConnectionMetadata = kernelInfo;
                changedKernel = true;
            }
            traceInfo(
                `Compute Launch Info uri = ${resource?.fsPath}, changed ${changedKernel}, ${launchInfo.kernelConnectionMetadata?.id}`
            );
        }
        if (!changedKernel && kernelConnection && kernelConnection.id !== launchInfo.kernelConnectionMetadata?.id) {
            // Update kernel info if its different from what was originally provided.
            traceInfoIf(isCI, `kernelConnection provided is different from launch info ${kernelConnection.id}`);
            launchInfo.kernelConnectionMetadata = kernelConnection;
            changedKernel = true;
        }

        traceInfo(
            `Computed Launch Info uri = ${resource?.fsPath}, changed ${changedKernel}, ${launchInfo.kernelConnectionMetadata?.id}`
        );
        return { info: launchInfo, changedKernel };
    }
}
