// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IServiceManager } from '../../ioc/types';
import { EnvironmentVariablesService } from './environment.node';
import { EnvironmentVariablesProvider } from './environmentVariablesProvider.node';
import { IEnvironmentVariablesProvider, IEnvironmentVariablesService } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IEnvironmentVariablesService>(
        IEnvironmentVariablesService,
        EnvironmentVariablesService
    );
    serviceManager.addSingleton<IEnvironmentVariablesProvider>(
        IEnvironmentVariablesProvider,
        EnvironmentVariablesProvider
    );
}
