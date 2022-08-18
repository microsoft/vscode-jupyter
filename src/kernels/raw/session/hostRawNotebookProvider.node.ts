// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import '../../../platform/common/extensions';

import * as vscode from 'vscode';
import uuid from 'uuid/v4';
import { injectable, inject } from 'inversify';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { traceInfo, traceVerbose, traceError } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    Resource,
    IDisplayOptions
} from '../../../platform/common/types';
import { createDeferred } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { trackKernelResourceInformation } from '../../telemetry/helper';
import { captureTelemetry, Telemetry } from '../../../telemetry';
import { isPythonKernelConnection } from '../../helpers';
import { IRawKernelConnectionSession, KernelConnectionMetadata } from '../../types';
import { IKernelLauncher, IRawNotebookProvider, IRawNotebookSupportedService } from '../types';
import { RawJupyterSession } from './rawJupyterSession.node';
import { Cancellation } from '../../../platform/common/cancellation';
import { noop } from '../../../platform/common/utils/misc';
import { sendKernelTelemetryEvent } from '../../telemetry/sendKernelTelemetryEvent';

// eslint-disable-next-line @typescript-eslint/no-require-imports
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Implements IRawNotebookProvider for raw kernel connections.
 */
@injectable()
export class HostRawNotebookProvider implements IRawNotebookProvider {
    public get id(): string {
        return this._id;
    }
    private sessions = new Set<Promise<IRawKernelConnectionSession>>();
    private _id = uuid();
    private disposed = false;
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IKernelLauncher) private readonly kernelLauncher: IKernelLauncher,
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
            const notebooks = await Promise.all([...this.sessions.values()]);
            await Promise.all(notebooks.map((session) => session.dispose()));
        }
    }

    // Check to see if we have all that we need for supporting raw kernel launch
    public get isSupported(): boolean {
        return this.rawNotebookSupportedService.isSupported;
    }

    @captureTelemetry(Telemetry.RawKernelCreatingNotebook, undefined, true)
    public async createNotebook(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        ui: IDisplayOptions,
        cancelToken: vscode.CancellationToken
    ): Promise<IRawKernelConnectionSession> {
        traceInfo(`Creating raw notebook for resource '${getDisplayPath(resource)}'`);
        const sessionPromise = createDeferred<IRawKernelConnectionSession>();
        this.trackDisposable(sessionPromise.promise);
        let rawSession: RawJupyterSession | undefined;

        traceVerbose(`Getting preferred kernel for resource '${getDisplayPath(resource)}'`);
        try {
            const kernelConnectionProvided = !!kernelConnection;
            if (
                kernelConnection &&
                isPythonKernelConnection(kernelConnection) &&
                kernelConnection.kind === 'startUsingLocalKernelSpec'
            ) {
                if (!kernelConnection.interpreter) {
                    sendKernelTelemetryEvent(
                        resource,
                        Telemetry.AttemptedToLaunchRawKernelWithoutInterpreter,
                        undefined,
                        {
                            pythonExtensionInstalled: this.extensionChecker.isPythonExtensionInstalled
                        }
                    );
                }
            }
            traceInfo(`Computing working directory for resource '${getDisplayPath(resource)}'`);
            const workingDirectory = await this.workspaceService.computeWorkingDirectory(resource);
            Cancellation.throwIfCanceled(cancelToken);
            const launchTimeout = this.configService.getSettings(resource).jupyterLaunchTimeout;
            const interruptTimeout = this.configService.getSettings(resource).jupyterInterruptTimeout;
            rawSession = new RawJupyterSession(
                this.kernelLauncher,
                resource,
                vscode.Uri.file(workingDirectory),
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
                `Connecting to raw session for ${getDisplayPath(resource)} with connection ${kernelConnection.id}`
            );
            await rawSession.connect({ token: cancelToken, ui });
            if (cancelToken.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            if (rawSession.isConnected) {
                traceInfo(`Finished connecting ${this.id}`);

                sessionPromise.resolve(rawSession);
            } else {
                sessionPromise.reject(new Error(DataScience.rawConnectionBrokenError()));
            }
        } catch (ex) {
            // Make sure we shut down our session in case we started a process
            rawSession?.dispose().catch((error) => {
                traceError(`Failed to dispose of raw session on launch error: ${error} `);
            });
            // If there's an error, then reject the promise that is returned.
            // This original promise must be rejected as it is cached (check `setNotebook`).
            sessionPromise.reject(ex);
        }

        return sessionPromise.promise;
    }

    private trackDisposable(sessionPromise: Promise<IRawKernelConnectionSession>) {
        void sessionPromise
            .then((session) => {
                session.onDidDispose(
                    () => {
                        this.sessions.delete(sessionPromise);
                    },
                    this,
                    this.disposables
                );
            })
            .catch(noop);

        // Save the session
        this.sessions.add(sessionPromise);
    }
}
