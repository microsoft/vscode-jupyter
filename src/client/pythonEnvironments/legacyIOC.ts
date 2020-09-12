// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IServiceContainer, IServiceManager } from '../ioc/types';
import { initializeExternalDependencies } from './common/externalDependencies';
import { EnvironmentInfoService, IEnvironmentInfoService } from './info/environmentInfoService';

export function registerForIOC(serviceManager: IServiceManager, serviceContainer: IServiceContainer): void {
    serviceManager.addSingletonInstance<IEnvironmentInfoService>(IEnvironmentInfoService, new EnvironmentInfoService());
    initializeExternalDependencies(serviceContainer);
}
