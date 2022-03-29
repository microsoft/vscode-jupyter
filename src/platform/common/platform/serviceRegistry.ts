// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IServiceContainer, IServiceManager } from '../../ioc/types';
import { initializeExternalDependencies } from './fileUtils';
import { PlatformService } from './platformService';
import { IPlatformService } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IPlatformService>(IPlatformService, PlatformService);
    initializeExternalDependencies(serviceManager.get<IServiceContainer>(IServiceContainer));
}
