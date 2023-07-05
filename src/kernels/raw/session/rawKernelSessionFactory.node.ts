// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { injectable, inject } from 'inversify';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { traceVerbose, traceError } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry } from '../../../platform/common/types';
import { createDeferred } from '../../../platform/common/utils/async';
import { trackKernelResourceInformation } from '../../telemetry/helper';
import {
    IRawKernelSession,
    KernelSessionCreationOptions,
    LocaLKernelSessionCreationOptions,
    LocalKernelConnectionMetadata
} from '../../types';
import { IKernelLauncher, INewRawKernelSessionFactory, IRawKernelSessionFactory } from '../types';
import { OldRawJupyterSession, RawJupyterSessionWrapper } from './rawJupyterSession.node';
import { Cancellation, isCancellationError, raceCancellationError } from '../../../platform/common/cancellation';
import { noop } from '../../../platform/common/utils/misc';
import { RawSessionConnection } from './rawSession.node';

// eslint-disable-next-line @typescript-eslint/no-require-imports
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Implements IRawNotebookProvider for raw kernel connections.
 */
@injectable()
export class RawKernelSessionFactory implements IRawKernelSessionFactory {
    private sessions = new Set<Promise<IRawKernelSession>>();
    private disposed = false;
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IKernelLauncher) private readonly kernelLauncher: IKernelLauncher,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        this.asyncRegistry.push(this);
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            const notebooks = await Promise.all([...this.sessions.values()]);
            await Promise.all(
                notebooks.map((session) =>
                    session
                        .shutdown()
                        .catch(noop)
                        .finally(() => session.dispose())
                )
            );
        }
    }

    public async create(options: LocaLKernelSessionCreationOptions): Promise<IRawKernelSession> {
        traceVerbose(`Creating raw notebook for resource '${getDisplayPath(options.resource)}'`);
        const sessionPromise = createDeferred<IRawKernelSession>();
        this.trackDisposable(sessionPromise.promise);
        let rawSession: RawJupyterSessionWrapper | undefined;

        try {
            const [workingDirectory] = await Promise.all([
                this.workspaceService.computeWorkingDirectory(options.resource).then((dir) => vscode.Uri.file(dir)),
                trackKernelResourceInformation(options.resource, { kernelConnection: options.kernelConnection })
            ]);
            Cancellation.throwIfCanceled(options.token);
            const launchTimeout = this.configService.getSettings(options.resource).jupyterLaunchTimeout;
            const session = new RawSessionConnection(
                options.resource,
                this.kernelLauncher,
                workingDirectory,
                options.kernelConnection as LocalKernelConnectionMetadata,
                launchTimeout,
                (options.resource?.path || '').toLowerCase().endsWith('.ipynb') ? 'notebook' : 'console'
            );
            try {
                await raceCancellationError(options.token, session.startKernel(options));
            } catch (error) {
                if (isCancellationError(error) || options.token.isCancellationRequested) {
                    traceVerbose('Starting of raw session cancelled by user');
                } else {
                    traceError(`Failed to connect raw kernel session: ${error}`);
                }
                throw error;
            }

            rawSession = new RawJupyterSessionWrapper(session, options.resource, options.kernelConnection);

            if (options.token.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            sessionPromise.resolve(rawSession);
        } catch (ex) {
            // Make sure we shut down our session in case we started a process
            rawSession
                ?.shutdown()
                .catch((error) => {
                    traceError(`Failed to dispose of raw session on launch error: ${error} `);
                })
                .finally(() => rawSession?.dispose());
            // If there's an error, then reject the promise that is returned.
            // This original promise must be rejected as it is cached (check `setNotebook`).
            sessionPromise.reject(ex);
        }

        return sessionPromise.promise;
    }

    private trackDisposable(sessionPromise: Promise<IRawKernelSession>) {
        sessionPromise
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

/**
 * Implements IRawNotebookProvider for raw kernel connections.
 */
@injectable()
export class NewRawKernelSessionFactory implements INewRawKernelSessionFactory {
    private sessions = new Set<Promise<IRawKernelSession>>();
    private disposed = false;
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IKernelLauncher) private readonly kernelLauncher: IKernelLauncher,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        this.asyncRegistry.push(this);
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            const notebooks = await Promise.all([...this.sessions.values()]);
            await Promise.all(
                notebooks.map((session) =>
                    session
                        .shutdown()
                        .catch(noop)
                        .finally(() => session.dispose())
                )
            );
        }
    }

    public async create(options: LocaLKernelSessionCreationOptions): Promise<IRawKernelSession> {
        traceVerbose(`Creating raw notebook for resource '${getDisplayPath(options.resource)}'`);
        const sessionPromise = createDeferred<IRawKernelSession>();
        this.trackDisposable(sessionPromise.promise);
        let rawSession: RawJupyterSessionWrapper | undefined;

        try {
            const [workingDirectory] = await Promise.all([
                this.workspaceService.computeWorkingDirectory(options.resource).then((dir) => vscode.Uri.file(dir)),
                trackKernelResourceInformation(options.resource, { kernelConnection: options.kernelConnection })
            ]);
            Cancellation.throwIfCanceled(options.token);
            const launchTimeout = this.configService.getSettings(options.resource).jupyterLaunchTimeout;
            const session = new RawSessionConnection(
                options.resource,
                this.kernelLauncher,
                workingDirectory,
                options.kernelConnection as LocalKernelConnectionMetadata,
                launchTimeout,
                (options.resource?.path || '').toLowerCase().endsWith('.ipynb') ? 'notebook' : 'console'
            );
            try {
                await raceCancellationError(options.token, session.startKernel(options));
            } catch (error) {
                if (isCancellationError(error) || options.token.isCancellationRequested) {
                    traceVerbose('Starting of raw session cancelled by user');
                } else {
                    traceError(`Failed to connect raw kernel session: ${error}`);
                }
                throw error;
            }

            rawSession = new RawJupyterSessionWrapper(session, options.resource, options.kernelConnection);

            if (options.token.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            sessionPromise.resolve(rawSession);
        } catch (ex) {
            // Make sure we shut down our session in case we started a process
            rawSession
                ?.shutdown()
                .catch((error) => {
                    traceError(`Failed to dispose of raw session on launch error: ${error} `);
                })
                .finally(() => rawSession?.dispose());
            // If there's an error, then reject the promise that is returned.
            // This original promise must be rejected as it is cached (check `setNotebook`).
            sessionPromise.reject(ex);
        }

        return sessionPromise.promise;
    }

    private trackDisposable(sessionPromise: Promise<IRawKernelSession>) {
        sessionPromise
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
