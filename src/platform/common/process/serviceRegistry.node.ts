// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IServiceManager } from '../../ioc/types';
import { ProcessServiceFactory } from './processFactory.node';
import { IProcessServiceFactory } from './types.node';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IProcessServiceFactory>(IProcessServiceFactory, ProcessServiceFactory);
}
