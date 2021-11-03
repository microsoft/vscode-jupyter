// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import * as vscode from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';

import { IPythonExtensionChecker } from '../../../api/types';
import { IWorkspaceService } from '../../../common/application/types';
import { traceError, traceInfo, traceVerbose } from '../../../common/logger';
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
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { computeWorkingDirectory } from '../../jupyter/jupyterUtils';
import { getDisplayNameOrNameOfKernelConnection, isPythonKernelConnection } from '../../jupyter/kernels/helpers';
import { KernelConnectionMetadata } from '../../jupyter/kernels/types';
import { IKernelLauncher } from '../../kernel-launcher/types';
import { ProgressReporter } from '../../progress/progressReporter';
import { INotebook, IRawNotebookProvider, IRawNotebookSupportedService } from '../../types';
import { RawJupyterSession } from '../rawJupyterSession';
import { RawNotebookProviderBase } from '../rawNotebookProvider';
import { trackKernelResourceInformation } from '../../telemetry/telemetry';
import { inject, injectable, named } from 'inversify';
import { STANDARD_OUTPUT_CHANNEL } from '../../../common/constants';
import { getDisplayPath } from '../../../common/platform/fs-paths';
import { JupyterNotebook } from '../../jupyter/jupyterNotebook';

// eslint-disable-next-line @typescript-eslint/no-require-imports
/* eslint-disable @typescript-eslint/no-explicit-any */

@injectable()
export class HostRawNotebookProvider extends RawNotebookProviderBase implements IRawNotebookProvider {
    private disposed = false;
    constructor(
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IKernelLauncher) private readonly kernelLauncher: IKernelLauncher,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly outputChannel: IOutputChannel,
        @inject(IRawNotebookSupportedService) rawNotebookSupported: IRawNotebookSupportedService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        super(asyncRegistry, rawNotebookSupported, disposables);
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            await super.dispose();
        }
    }
    protected async createNotebookInstance(
        resource: Resource,
        document: vscode.NotebookDocument,
        kernelConnection: KernelConnectionMetadata,
        disableUI?: boolean,
        cancelToken?: CancellationToken
    ): Promise<INotebook> {
        traceInfo(`Creating raw notebook for ${getDisplayPath(document.uri)}`);
        const notebookPromise = createDeferred<INotebook>();
        this.setNotebook(document, notebookPromise.promise);
        let progressDisposable: vscode.Disposable | undefined;
        let rawSession: RawJupyterSession | undefined;

        traceInfo(`Getting preferred kernel for ${getDisplayPath(document.uri)}`);
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
            const displayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);

            progressDisposable = !disableUI
                ? this.progressReporter.createProgressIndicator(
                      localize.DataScience.connectingToKernel().format(displayName)
                  )
                : undefined;

            traceInfo(`Computing working directory ${getDisplayPath(document.uri)}`);
            const workingDirectory = await computeWorkingDirectory(resource, this.workspaceService);
            const launchTimeout = this.configService.getSettings(resource).jupyterLaunchTimeout;
            const interruptTimeout = this.configService.getSettings(resource).jupyterInterruptTimeout;
            rawSession = new RawJupyterSession(
                this.kernelLauncher,
                resource,
                this.outputChannel,
                noop,
                workingDirectory,
                interruptTimeout,
                kernelConnection,
                launchTimeout
            );

            // Interpreter is optional, but we must have a kernel spec for a raw launch if using a kernelspec
            // If a kernel connection was not provided, then we set it up here.
            if (!kernelConnectionProvided) {
                trackKernelResourceInformation(resource, { kernelConnection });
            }
            traceVerbose(
                `Connecting to raw session for ${getDisplayPath(document.uri)} with connection ${JSON.stringify(
                    kernelConnection
                )}`
            );
            await rawSession.connect(cancelToken, disableUI);

            // Get the execution info for our notebook
            const info = this.getConnection();

            if (rawSession.isConnected) {
                // Create our notebook
                const notebook = new JupyterNotebook(rawSession, info);

                traceInfo(`Finished connecting ${this.id}`);

                notebookPromise.resolve(notebook);
            } else {
                notebookPromise.reject(this.getDisposedError());
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
}
