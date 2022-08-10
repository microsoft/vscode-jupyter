// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IServiceManager } from '../../ioc/types';
import { PlatformService } from './platformService.web';
import { IPlatformService } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IPlatformService>(IPlatformService, PlatformService);
}
