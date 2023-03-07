// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { instance, mock, verify } from 'ts-mockito';
import { EnvironmentVariablesService } from './environment.node';
import { CustomEnvironmentVariablesProvider } from './customEnvironmentVariablesProvider.node';
import { registerTypes } from './serviceRegistry.node';
import { ICustomEnvironmentVariablesProvider, IEnvironmentVariablesService } from './types';
import { ServiceManager } from '../../ioc/serviceManager';
import { IServiceManager } from '../../ioc/types';

suite('Common variables Service Registry', () => {
    let serviceManager: IServiceManager;

    setup(() => {
        serviceManager = mock(ServiceManager);
    });

    test('Ensure services are registered', async () => {
        registerTypes(instance(serviceManager));
        verify(
            serviceManager.addSingleton<IEnvironmentVariablesService>(
                IEnvironmentVariablesService,
                EnvironmentVariablesService
            )
        ).once();
        verify(
            serviceManager.addSingleton<ICustomEnvironmentVariablesProvider>(
                ICustomEnvironmentVariablesProvider,
                CustomEnvironmentVariablesProvider
            )
        ).once();
    });
});
