// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, multiInject, optional } from 'inversify';
import { IExtensionActivationManager, IExtensionSyncActivationService } from '../../platform/activation/types';
import { traceError } from '../../platform/logging';

/**
 * Responsible for calling the 'activate' method on all of the IExtensionSyncActivationServices.
 */
@injectable()
export class ExtensionActivationManager implements IExtensionActivationManager {
    constructor(
        @optional()
        @multiInject(IExtensionSyncActivationService)
        private readonly syncActivationServices: IExtensionSyncActivationService[]
    ) {}

    public activate(): void {
        this.syncActivationServices.map((item) => {
            try {
                item.activate();
            } catch (ex) {
                traceError(`Error in activating extension, failed in ${(item as Object).constructor.name}`, ex);
            }
        });
    }
}
