// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IServiceContainer, IServiceManager } from '../../ioc/types';
import { initializeExternalDependencies } from './fileUtils.node';
import { PlatformService } from './platformService.node';
import { IPlatformService } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IPlatformService>(IPlatformService, PlatformService);
    initializeExternalDependencies(serviceManager.get<IServiceContainer>(IServiceContainer));
}
