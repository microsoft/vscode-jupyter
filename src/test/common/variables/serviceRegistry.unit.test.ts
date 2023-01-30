// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { instance, mock, verify } from 'ts-mockito';
import { EnvironmentVariablesService } from '../../../platform/common/variables/environment.node';
import { CustomEnvironmentVariablesProvider } from '../../../platform/common/variables/customEnvironmentVariablesProvider.node';
import { registerTypes } from '../../../platform/common/variables/serviceRegistry.node';
import {
    ICustomEnvironmentVariablesProvider,
    IEnvironmentVariablesService
} from '../../../platform/common/variables/types';
import { ServiceManager } from '../../../platform/ioc/serviceManager';
import { IServiceManager } from '../../../platform/ioc/types';

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
