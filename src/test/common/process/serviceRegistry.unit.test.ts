// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { instance, mock, verify } from 'ts-mockito';
import { ProcessServiceFactory } from '../../../platform/common/process/processFactory.node';
import { registerTypes } from '../../../platform/common/process/serviceRegistry.node';
import { IProcessServiceFactory } from '../../../platform/common/process/types.node';
import { IServiceManager } from '../../../platform/ioc/types';

suite('Common Process Service Registry', () => {
    let serviceManager: IServiceManager;

    setup(() => {
        serviceManager = mock<IServiceManager>();
    });

    test('Ensure services are registered', async () => {
        registerTypes(instance(serviceManager));
        verify(
            serviceManager.addSingleton<IProcessServiceFactory>(IProcessServiceFactory, ProcessServiceFactory)
        ).once();
    });
});
