// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../client/common/extensions';

import * as vscode from 'vscode';
import * as uuid from 'uuid/v4';
import {
    ConnectNotebookProviderOptions,
    IDisplayOptions,
    INotebook,
    IRawConnection,
    IRawNotebookProvider,
    IRawNotebookSupportedService
} from '../../../client/datascience/types';
import { injectable, inject, named } from 'inversify';
import { IPythonExtensionChecker } from '../../../client/api/types';
import { IWorkspaceService } from '../../../client/common/application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../../client/common/constants';
import { traceInfo, traceVerbose, traceError } from '../../../client/common/logger';
import { getDisplayPath } from '../../../client/common/platform/fs-paths';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IOutputChannel,
    IDisposableRegistry,
    Resource
} from '../../../client/common/types';
import { createDeferred } from '../../../client/common/utils/async';
import { DataScience } from '../../../client/common/utils/localize';
import { trackKernelResourceInformation } from '../../../client/datascience/telemetry/telemetry';
import { captureTelemetry, sendTelemetryEvent } from '../../../client/telemetry';
import { Telemetry } from '../../../datascience-ui/common/constants';
import { isPythonKernelConnection } from '../../helpers';
import { computeWorkingDirectory } from '../../jupyter/jupyterUtils';
import { JupyterNotebook } from '../../jupyter/launcher/jupyterNotebook';
import { KernelConnectionMetadata } from '../../types';
import { IKernelLauncher } from '../types';
import { RawJupyterSession } from './rawJupyterSession';
import { noop } from '../../../client/common/utils/misc';
import { Cancellation } from '../../../client/common/cancellation';

// eslint-disable-next-line @typescript-eslint/no-require-imports
/* eslint-disable @typescript-eslint/no-explicit-any */

class RawConnection implements IRawConnection {
    public readonly type = 'raw';
    public readonly localLaunch = true;
    public readonly displayName = '';
}

@injectable()
export class HostRawNotebookProvider implements IRawNotebookProvider {
    public get id(): string {
        return this._id;
    }
    private notebooks = new Set<Promise<INotebook>>();
    private rawConnection = new RawConnection();
    private _id = uuid();
    private disposed = false;
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IKernelLauncher) private readonly kernelLauncher: IKernelLauncher,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly outputChannel: IOutputChannel,
        @inject(IRawNotebookSupportedService)
        private readonly rawNotebookSupportedService: IRawNotebookSupportedService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        this.asyncRegistry.push(this);
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            traceInfo(`Shutting down notebooks for ${this.id}`);
            const notebooks = await Promise.all([...this.notebooks.values()]);
            await Promise.all(notebooks.map((n) => n?.session.dispose()));
        }
    }

    public async connect(_options: ConnectNotebookProviderOptions): Promise<IRawConnection | undefined> {
        return this.rawConnection;
    }

    // Check to see if we have all that we need for supporting raw kernel launch
    public get isSupported(): boolean {
        return this.rawNotebookSupportedService.isSupported;
    }

    @captureTelemetry(Telemetry.RawKernelCreatingNotebook, undefined, true)
    public async createNotebook(
        document: vscode.NotebookDocument,
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        ui: IDisplayOptions,
        cancelToken: vscode.CancellationToken
    ): Promise<INotebook> {
        traceInfo(`Creating raw notebook for ${getDisplayPath(document.uri)}`);
        const notebookPromise = createDeferred<INotebook>();
        this.trackDisposable(notebookPromise.promise);
        let rawSession: RawJupyterSession | undefined;

        traceInfo(`Getting preferred kernel for ${getDisplayPath(document.uri)}`);
        try {
            const kernelConnectionProvided = !!kernelConnection;
            if (
                kernelConnection &&
                isPythonKernelConnection(kernelConnection) &&
                kernelConnection.kind === 'startUsingLocalKernelSpec'
            ) {
                if (!kernelConnection.interpreter) {
                    sendTelemetryEvent(Telemetry.AttemptedToLaunchRawKernelWithoutInterpreter, undefined, {
                        pythonExtensionInstalled: this.extensionChecker.isPythonExtensionInstalled
                    });
                }
            }
            traceInfo(`Computing working directory ${getDisplayPath(document.uri)}`);
            const workingDirectory = await computeWorkingDirectory(resource, this.workspaceService);
            Cancellation.throwIfCanceled(cancelToken);
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
                `Connecting to raw session for ${getDisplayPath(document.uri)} with connection ${kernelConnection.id}`
            );
            await rawSession.connect({ token: cancelToken, ui });
            if (cancelToken.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            if (rawSession.isConnected) {
                // Create our notebook
                const notebook = new JupyterNotebook(rawSession, this.rawConnection);

                traceInfo(`Finished connecting ${this.id}`);

                notebookPromise.resolve(notebook);
            } else {
                notebookPromise.reject(new Error(DataScience.rawConnectionBrokenError()));
            }
        } catch (ex) {
            // Make sure we shut down our session in case we started a process
            rawSession?.dispose().catch((error) => {
                traceError(`Failed to dispose of raw session on launch error: ${error} `);
            });
            // If there's an error, then reject the promise that is returned.
            // This original promise must be rejected as it is cached (check `setNotebook`).
            notebookPromise.reject(ex);
        }

        return notebookPromise.promise;
    }

    private trackDisposable(notebook: Promise<INotebook>) {
        void notebook.then((nb) => {
            nb.session.onDidDispose(
                () => {
                    this.notebooks.delete(notebook);
                },
                this,
                this.disposables
            );
        });

        // Save the notebook
        this.notebooks.add(notebook);
    }
}
