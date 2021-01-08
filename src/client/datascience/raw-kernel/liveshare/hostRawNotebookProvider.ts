// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import * as vscode from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import * as vsls from 'vsls/vscode';

import { IApplicationShell, ILiveShareApi, IWorkspaceService } from '../../../common/application/types';
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
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { Identifiers, LiveShare, LiveShareCommands, Settings, Telemetry } from '../../constants';
import { computeWorkingDirectory } from '../../jupyter/jupyterUtils';
import { getDisplayNameOrNameOfKernelConnection, isPythonKernelConnection } from '../../jupyter/kernels/helpers';
import { KernelSelector } from '../../jupyter/kernels/kernelSelector';
import { KernelConnectionMetadata } from '../../jupyter/kernels/types';
import { HostJupyterNotebook } from '../../jupyter/liveshare/hostJupyterNotebook';
import { LiveShareParticipantHost } from '../../jupyter/liveshare/liveShareParticipantMixin';
import { IRoleBasedObject } from '../../jupyter/liveshare/roleBasedFactory';
import { IKernelLauncher } from '../../kernel-launcher/types';
import { ProgressReporter } from '../../progress/progressReporter';
import {
    IKernelDependencyService,
    INotebook,
    INotebookExecutionInfo,
    INotebookExecutionLogger,
    IRawNotebookProvider,
    IRawNotebookSupportedService,
    KernelInterpreterDependencyResponse
} from '../../types';
import { calculateWorkingDirectory } from '../../utils';
import { RawJupyterSession } from '../rawJupyterSession';
import { RawNotebookProviderBase } from '../rawNotebookProvider';
import { KernelService } from '../../jupyter/kernels/kernelService';
import { sendTelemetryEvent } from '../../../telemetry';
import { IPythonExtensionChecker } from '../../../api/types';

// tslint:disable-next-line: no-require-imports
// tslint:disable:no-any

export class HostRawNotebookProvider
    extends LiveShareParticipantHost(RawNotebookProviderBase, LiveShare.RawNotebookProviderService)
    implements IRoleBasedObject, IRawNotebookProvider {
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
        private kernelSelector: KernelSelector,
        private progressReporter: ProgressReporter,
        private outputChannel: IOutputChannel,
        rawNotebookSupported: IRawNotebookSupportedService,
        private readonly kernelDependencyService: IKernelDependencyService,
        private readonly kernelService: KernelService,
        private readonly extensionChecker: IPythonExtensionChecker
    ) {
        super(liveShare, asyncRegistry, rawNotebookSupported);
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            await super.dispose();
        }
    }

    public async onAttach(api: vsls.LiveShare | null): Promise<void> {
        await super.onAttach(api);
        if (api && !this.disposed) {
            const service = await this.waitForService();
            // Attach event handlers to different requests
            if (service) {
                service.onRequest(LiveShareCommands.syncRequest, (_args: any[], _cancellation: CancellationToken) =>
                    this.onSync()
                );
                service.onRequest(
                    LiveShareCommands.rawKernelSupported,
                    (_args: any[], _cancellation: CancellationToken) => this.supported()
                );
                service.onRequest(
                    LiveShareCommands.createRawNotebook,
                    async (args: any[], _cancellation: CancellationToken) => {
                        const resource = this.parseUri(args[0]);
                        const identity = this.parseUri(args[1]);
                        const kernelConnection = JSON.parse(args[2]) as KernelConnectionMetadata;
                        // Don't return the notebook. We don't want it to be serialized. We just want its live share server to be started.
                        const notebook = (await this.createNotebook(
                            identity!,
                            resource,
                            true, // Disable UI for this creation
                            kernelConnection,
                            undefined
                        )) as HostJupyterNotebook;
                        await notebook.onAttach(api);
                    }
                );
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
    }

    public async waitForServiceName(): Promise<string> {
        return LiveShare.RawNotebookProviderService;
    }

    protected async createNotebookInstance(
        resource: Resource,
        identity: vscode.Uri,
        disableUI?: boolean,
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
            if (
                kernelConnection &&
                isPythonKernelConnection(kernelConnection) &&
                kernelConnection.kind === 'startUsingKernelSpec'
            ) {
                if (!kernelConnection.interpreter) {
                    sendTelemetryEvent(Telemetry.AttemptedToLaunchRawKernelWithoutInterpreter, undefined, {
                        pythonExtensionInstalled: this.extensionChecker.isPythonExtensionInstalled
                    });
                    // Temporary, if there's no telemetry for this, then its safe to remove
                    // this code as well as the code where we initialize the interpreter via a hack.
                    // This is used to check if there are situations under which this is possible & to safeguard against it.
                    // The only real world scenario is when users do not install Python (which we cannot prevent).
                    (kernelConnection as any).interpreter = this.kernelService.findMatchingInterpreter(
                        kernelConnection.kernelSpec,
                        cancelToken
                    );
                }
                if (kernelConnection.interpreter) {
                    // Install missing dependencies only if we're dealing with a Python kernel.
                    await this.installDependenciesIntoInterpreter(kernelConnection.interpreter, false, cancelToken);
                } else {
                    traceError('No interpreter fetched to start a raw kernel');
                }
            }
            // We need to locate kernelspec and possible interpreter for this launch based on resource and notebook metadata
            // Confirm this logic is valid.
            const kernelConnectionMetadata =
                kernelConnection ||
                (await this.kernelSelector.getPreferredKernelForLocalConnection(
                    resource,
                    'raw',
                    undefined,
                    undefined,
                    disableUI,
                    cancelToken
                ));

            const displayName = getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata);

            progressDisposable = !disableUI
                ? this.progressReporter.createProgressIndicator(
                      localize.DataScience.connectingToKernel().format(displayName)
                  )
                : undefined;

            traceInfo(`Computing working directory ${identity.toString()}`);
            const workingDirectory = await computeWorkingDirectory(resource, this.workspaceService);

            rawSession = new RawJupyterSession(
                this.kernelLauncher,
                resource,
                this.outputChannel,
                noop,
                noop,
                workingDirectory
            );

            const launchTimeout = this.configService.getSettings().jupyterLaunchTimeout;

            // Interpreter is optional, but we must have a kernel spec for a raw launch if using a kernelspec
            if (
                !kernelConnectionMetadata ||
                (kernelConnectionMetadata?.kind === 'startUsingKernelSpec' && !kernelConnectionMetadata?.kernelSpec)
            ) {
                notebookPromise.reject('Failed to find a kernelspec to use for ipykernel launch');
            } else {
                traceInfo(`Connecting to raw session for ${identity.toString()}`);
                await rawSession.connect(kernelConnectionMetadata, launchTimeout, cancelToken);

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
                        this.fs
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

    // If we need to install our dependencies now (for non-native scenarios)
    // then install ipykernel into the interpreter or throw error
    private async installDependenciesIntoInterpreter(
        interpreter: PythonEnvironment,
        ignoreDependencyCheck?: boolean,
        cancelToken?: CancellationToken
    ) {
        if (!ignoreDependencyCheck) {
            if (
                (await this.kernelDependencyService.installMissingDependencies(interpreter, cancelToken)) !==
                KernelInterpreterDependencyResponse.ok
            ) {
                throw new Error(
                    localize.DataScience.ipykernelNotInstalled().format(
                        `${interpreter.displayName || interpreter.path}:${interpreter.path}`
                    )
                );
            }
        }
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

    private parseUri(uri: string | undefined): Resource {
        const parsed = uri ? vscode.Uri.parse(uri) : undefined;
        return parsed &&
            parsed.scheme &&
            parsed.scheme !== Identifiers.InteractiveWindowIdentityScheme &&
            parsed.scheme === 'vsls'
            ? this.finishedApi!.convertSharedUriToLocal(parsed)
            : parsed;
    }

    private onSync(): Promise<any> {
        return Promise.resolve(true);
    }
}
