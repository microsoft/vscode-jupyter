// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IDisposableRegistry } from '../platform/common/types';
import { logger } from '../platform/logging';
import { IKernelPersistenceService } from './kernelPersistenceService';
import { noop } from '../platform/common/utils/misc';

/**
 * Activation service that handles kernel reconnection on extension startup
 */
@injectable()
export class KernelReconnectionActivation implements IExtensionSyncActivationService {
    constructor(
        @inject(IKernelPersistenceService) private readonly persistenceService: IKernelPersistenceService,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry
    ) {}

    activate(): void {
        this.disposableRegistry.push(this.persistenceService);

        // Start kernel reconnection process
        this.attemptKernelReconnection().catch((ex) =>
            logger.error('Failed to attempt kernel reconnection on activation', ex)
        );
    }

    private async attemptKernelReconnection(): Promise<void> {
        try {
            logger.info('Starting kernel reconnection process...');

            const results = await this.persistenceService.reconnectToKernels();

            const successCount = results.filter((r) => r.success).length;
            const totalCount = results.length;

            if (totalCount > 0) {
                logger.info(
                    `Kernel reconnection completed: ${successCount}/${totalCount} kernels reconnected successfully`
                );

                // Log any failures for debugging
                results
                    .filter((r) => !r.success)
                    .forEach((result) => {
                        logger.debug(`Failed to reconnect kernel ${result.kernelId}: ${result.error}`);
                    });
            } else {
                logger.debug('No persisted kernels found for reconnection');
            }
        } catch (ex) {
            logger.error('Error during kernel reconnection process', ex);
        }
    }
}
