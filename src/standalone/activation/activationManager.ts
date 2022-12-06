// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable, multiInject, optional } from 'inversify';
import {
    IExtensionActivationManager,
    IExtensionSingleActivationService,
    IExtensionSyncActivationService
} from '../../platform/activation/types';
import { traceError } from '../../platform/logging';

/**
 * Responsbile for calling the 'activate' method on all of the IExtensionSingleActivationServices and IExtensionSyncActivationServices.
 */
@injectable()
export class ExtensionActivationManager implements IExtensionActivationManager {
    constructor(
        @optional()
        @multiInject(IExtensionSingleActivationService)
        private readonly singleActivationServices: IExtensionSingleActivationService[],
        @optional()
        @multiInject(IExtensionSyncActivationService)
        private readonly syncActivationServices: IExtensionSyncActivationService[]
    ) {}

    public dispose() {
        // Nothing to dispose
    }
    public activateSync(): void {
        this.syncActivationServices.map((item) => item.activate());
    }
    public async activate(): Promise<void> {
        // Activate all activation services together. Don't fail them all if one fails.
        await Promise.all([
            this.singleActivationServices.map(async (item) => {
                const promise = item.activate();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if (promise && (promise as any).then) {
                    return promise.catch(traceError);
                }
            })
        ]);
    }
}
