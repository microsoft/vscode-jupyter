// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { injectable, multiInject, optional } from 'inversify';
import {
    IExtensionActivationManager,
    IExtensionSingleActivationService,
    IExtensionSyncActivationService
} from '../../../platform/activation/types';

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
        // Activate all activation services together.
        await Promise.all([this.singleActivationServices.map((item) => item.activate())]);
    }
}
