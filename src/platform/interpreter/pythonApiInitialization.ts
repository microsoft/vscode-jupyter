// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import type { IExtensionSyncActivationService } from '../activation/types';
import { IInterpreterService } from './contracts';

@injectable()
export class PythonApiInitialization implements IExtensionSyncActivationService {
    constructor(@inject(IInterpreterService) private readonly interpreterService: IInterpreterService) {}
    activate(): void {
        // This will hook up the necessary events and trigger the discovery of interpreters.
        // Without this, we will never know about Python envs
        void this.interpreterService.initialize();
    }
}
