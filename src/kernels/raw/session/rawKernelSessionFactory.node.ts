// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { logger } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IConfigurationService } from '../../../platform/common/types';
import { trackKernelResourceInformation } from '../../telemetry/helper';
import {
    IKernelWorkingDirectory,
    IRawKernelSession,
    LocaLKernelSessionCreationOptions,
    LocalKernelConnectionMetadata
} from '../../types';
import { IKernelLauncher, IRawKernelSessionFactory } from '../types';
import { isCancellationError, raceCancellationError } from '../../../platform/common/cancellation';
import { noop } from '../../../platform/common/utils/misc';
import { RawJupyterSessionWrapper } from './rawJupyterSession.node';
import { RawSessionConnection } from './rawSessionConnection.node';
import { getNotebookTelemetryTracker } from '../../telemetry/notebookTelemetry';

@injectable()
export class RawKernelSessionFactory implements IRawKernelSessionFactory {
    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IKernelLauncher) private readonly kernelLauncher: IKernelLauncher,
        @inject(IKernelWorkingDirectory) private readonly workingDirectoryComputer: IKernelWorkingDirectory
    ) {}

    public async create(options: LocaLKernelSessionCreationOptions): Promise<IRawKernelSession> {
        logger.trace(`Creating raw notebook for resource '${getDisplayPath(options.resource)}'`);
        const cwdTracker = getNotebookTelemetryTracker(options.resource)?.computeCwd();
        const [workingDirectory] = await Promise.all([
            this.workingDirectoryComputer.computeWorkingDirectory(
                options.kernelConnection,
                options.resource,
                options.token
            ),
            raceCancellationError(
                options.token,
                trackKernelResourceInformation(options.resource, { kernelConnection: options.kernelConnection })
            )
        ]);
        cwdTracker?.stop();
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
                logger.debug('Starting of raw session cancelled by user');
            } else {
                logger.error(`Failed to connect raw kernel session: ${error}`);
            }
            // Make sure we shut down our session in case we started a process
            session
                ?.shutdown()
                .catch((error) => logger.error(`Failed to dispose of raw session on launch error: ${error} `))
                .finally(() => session?.dispose())
                .catch(noop);
            throw error;
        }

        return new RawJupyterSessionWrapper(session, options.resource, options.kernelConnection);
    }
}
