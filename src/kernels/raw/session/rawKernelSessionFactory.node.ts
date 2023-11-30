// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { injectable, inject } from 'inversify';
import { traceVerbose, traceError } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IConfigurationService } from '../../../platform/common/types';
import { trackKernelResourceInformation } from '../../telemetry/helper';
import { IRawKernelSession, LocaLKernelSessionCreationOptions, LocalKernelConnectionMetadata } from '../../types';
import { IKernelLauncher, IRawKernelSessionFactory } from '../types';
import { isCancellationError, raceCancellationError } from '../../../platform/common/cancellation';
import { noop } from '../../../platform/common/utils/misc';
import { RawJupyterSessionWrapper } from './rawJupyterSession.node';
import { RawSessionConnection } from './rawSessionConnection.node';
import { computeWorkingDirectory } from '../../../platform/common/application/workspace.node';

@injectable()
export class RawKernelSessionFactory implements IRawKernelSessionFactory {
    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IKernelLauncher) private readonly kernelLauncher: IKernelLauncher
    ) {}

    public async create(options: LocaLKernelSessionCreationOptions): Promise<IRawKernelSession> {
        traceVerbose(`Creating raw notebook for resource '${getDisplayPath(options.resource)}'`);
        let session: RawSessionConnection | undefined;

        const [workingDirectory] = await Promise.all([
            raceCancellationError(
                options.token,
                computeWorkingDirectory(options.resource).then((dir) => vscode.Uri.file(dir))
            ),
            raceCancellationError(
                options.token,
                trackKernelResourceInformation(options.resource, { kernelConnection: options.kernelConnection })
            )
        ]);
        const launchTimeout = this.configService.getSettings(options.resource).jupyterLaunchTimeout;
        session = new RawSessionConnection(
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
            // Make sure we shut down our session in case we started a process
            session
                ?.shutdown()
                .catch((error) => traceError(`Failed to dispose of raw session on launch error: ${error} `))
                .finally(() => session?.dispose())
                .catch(noop);
            throw error;
        }

        return new RawJupyterSessionWrapper(session, options.resource, options.kernelConnection);
    }
}
