// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { nbformat } from '@jupyterlab/coreutils';
import * as vscode from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';

import { IPythonExtensionChecker } from '../../../api/types';
import {
    IApplicationShell,
    ILiveShareApi,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../../common/application/types';
import { traceError, traceInfo } from '../../../common/logger';
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
import { noop } from '../../../common/utils/misc';
import { IServiceContainer } from '../../../ioc/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { Identifiers, Settings, Telemetry } from '../../constants';
import { computeWorkingDirectory } from '../../jupyter/jupyterUtils';
import {
    getDisplayNameOrNameOfKernelConnection,
    getLanguageInNotebookMetadata,
    isPythonKernelConnection
} from '../../jupyter/kernels/helpers';
import { KernelConnectionMetadata } from '../../jupyter/kernels/types';
import { HostJupyterNotebook } from '../../jupyter/liveshare/hostJupyterNotebook';
import { IRoleBasedObject } from '../../jupyter/liveshare/roleBasedFactory';
import { IKernelLauncher, ILocalKernelFinder } from '../../kernel-launcher/types';
import { ProgressReporter } from '../../progress/progressReporter';
import {
    INotebook,
    INotebookExecutionInfo,
    INotebookExecutionLogger,
    IRawNotebookProvider,
    IRawNotebookSupportedService
} from '../../types';
import { calculateWorkingDirectory } from '../../utils';
import { RawJupyterSession } from '../rawJupyterSession';
import { RawNotebookProviderBase } from '../rawNotebookProvider';
import { trackKernelResourceInformation } from '../../telemetry/telemetry';
import { KernelSpecNotFoundError } from './kernelSpecNotFoundError';
import { IPythonExecutionFactory } from '../../../common/process/types';
import { getResourceType } from '../../common';
import { getTelemetrySafeLanguage } from '../../../telemetry/helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
/* eslint-disable @typescript-eslint/no-explicit-any */

export class HostRawNotebookProvider extends RawNotebookProviderBase implements IRoleBasedObject, IRawNotebookProvider {
    private disposed = false;
    constructor(
        private liveShare: ILiveShareApi,
        _t: number,
        private disposableRegistry: IDisposableRegistry,
        asyncRegistry: IAsyncDisposableRegistry,
        private configService: IConfigurationService,
        private workspaceService: IWorkspaceService,
        private appShell: IApplicationShell,
        private fs: IFileSystem,
        private serviceContainer: IServiceContainer,
        private kernelLauncher: IKernelLauncher,
        private localKernelFinder: ILocalKernelFinder,
        private progressReporter: ProgressReporter,
        private outputChannel: IOutputChannel,
        rawNotebookSupported: IRawNotebookSupportedService,
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly vscodeNotebook: IVSCodeNotebook
    ) {
        super(liveShare, asyncRegistry, rawNotebookSupported);
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            await super.dispose();
        }
    }
    protected async createNotebookInstance(
        resource: Resource,
        identity: vscode.Uri,
        disableUI?: boolean,
        notebookMetadata?: nbformat.INotebookMetadata,
        kernelConnection?: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<INotebook> {
        traceInfo(`Creating raw notebook for ${identity.toString()}`);
        const notebookPromise = createDeferred<INotebook>();
        this.setNotebook(identity, notebookPromise.promise);
        let progressDisposable: vscode.Disposable | undefined;
        let rawSession: RawJupyterSession | undefined;

        traceInfo(`Getting preferred kernel for ${identity.toString()}`);
        try {
            const kernelConnectionProvided = !!kernelConnection;
            if (
                kernelConnection &&
                isPythonKernelConnection(kernelConnection) &&
                kernelConnection.kind === 'startUsingKernelSpec'
            ) {
                if (!kernelConnection.interpreter) {
                    sendTelemetryEvent(Telemetry.AttemptedToLaunchRawKernelWithoutInterpreter, undefined, {
                        pythonExtensionInstalled: this.extensionChecker.isPythonExtensionInstalled
                    });
                }
            }
            // We need to locate kernelspec and possible interpreter for this launch based on resource and notebook metadata
            const kernelConnectionMetadata =
                kernelConnection || (await this.localKernelFinder.findKernel(resource, notebookMetadata, cancelToken));

            const displayName = getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata);

            progressDisposable = !disableUI
                ? this.progressReporter.createProgressIndicator(
                      localize.DataScience.connectingToKernel().format(displayName)
                  )
                : undefined;

            traceInfo(`Computing working directory ${identity.toString()}`);
            const workingDirectory = await computeWorkingDirectory(resource, this.workspaceService);
            const launchTimeout = this.configService.getSettings().jupyterLaunchTimeout;

            rawSession = new RawJupyterSession(
                this.kernelLauncher,
                resource,
                this.outputChannel,
                noop,
                noop,
                workingDirectory
            );

            // Interpreter is optional, but we must have a kernel spec for a raw launch if using a kernelspec
            if (
                !kernelConnectionMetadata ||
                (kernelConnectionMetadata?.kind === 'startUsingKernelSpec' && !kernelConnectionMetadata?.kernelSpec)
            ) {
                sendTelemetryEvent(Telemetry.KernelSpecNotFoundError, undefined, {
                    resourceType: getResourceType(resource),
                    language: getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata)),
                    kernelConnectionProvided: !!kernelConnection,
                    notebookMetadataProvided: !!notebookMetadata,
                    hasKernelSpecInMetadata: !!notebookMetadata?.kernelspec,
                    kernelConnectionFound: !!kernelConnectionMetadata
                });
                notebookPromise.reject(new KernelSpecNotFoundError(notebookMetadata));
            } else {
                // If a kernel connection was not provided, then we set it up here.
                if (!kernelConnectionProvided) {
                    trackKernelResourceInformation(resource, { kernelConnection: kernelConnectionMetadata });
                }
                traceInfo(
                    `Connecting to raw session for ${identity.toString()} with connection ${JSON.stringify(
                        kernelConnectionMetadata
                    )}`
                );
                await rawSession.connect(resource, kernelConnectionMetadata, launchTimeout, cancelToken, disableUI);

                // Get the execution info for our notebook
                const info = await this.getExecutionInfo(kernelConnectionMetadata);

                if (rawSession.isConnected) {
                    // Create our notebook
                    const notebook = new HostJupyterNotebook(
                        this.liveShare,
                        rawSession,
                        this.configService,
                        this.disposableRegistry,
                        info,
                        this.serviceContainer.getAll<INotebookExecutionLogger>(INotebookExecutionLogger),
                        resource,
                        identity,
                        this.getDisposedError.bind(this),
                        this.workspaceService,
                        this.appShell,
                        this.fs,
                        this.vscodeNotebook,
                        this.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory)
                    );

                    // Run initial setup
                    await notebook.initialize(cancelToken);

                    traceInfo(`Finished connecting ${this.id}`);

                    notebookPromise.resolve(notebook);
                } else {
                    notebookPromise.reject(this.getDisposedError());
                }
            }
        } catch (ex) {
            // Make sure we shut down our session in case we started a process
            rawSession?.dispose().catch((error) => {
                traceError(`Failed to dispose of raw session on launch error: ${error} `);
            });
            // If there's an error, then reject the promise that is returned.
            // This original promise must be rejected as it is cached (check `setNotebook`).
            notebookPromise.reject(ex);
        } finally {
            progressDisposable?.dispose(); // NOSONAR
        }

        return notebookPromise.promise;
    }

    // Get the notebook execution info for this raw session instance
    private async getExecutionInfo(
        kernelConnectionMetadata: KernelConnectionMetadata
    ): Promise<INotebookExecutionInfo> {
        return {
            connectionInfo: this.getConnection(),
            uri: Settings.JupyterServerLocalLaunch,
            kernelConnectionMetadata,
            workingDir: await calculateWorkingDirectory(this.configService, this.workspaceService, this.fs),
            purpose: Identifiers.RawPurpose
        };
    }
}
