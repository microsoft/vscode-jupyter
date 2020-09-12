// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IServiceManager } from '../ioc/types';
import { IInterpreterService } from './contracts';
import { InterpreterService } from './interpreterService';

/**
 * Register all the new types inside this method.
 * This method is created for testing purposes. Registers all interpreter types except `IInterpreterAutoSeletionProxyService`, `IEnvironmentActivationService`.
 * See use case in `src\test\serviceRegistry.ts` for details
 * @param serviceManager
 */
// tslint:disable-next-line: max-func-body-length
export function registerInterpreterTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IInterpreterService>(IInterpreterService, InterpreterService);
}

export function registerTypes(serviceManager: IServiceManager) {
    registerInterpreterTypes(serviceManager);
}
