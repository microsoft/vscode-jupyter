// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { instance, mock, verify } from 'ts-mockito';
import { BufferDecoder } from '../../../client/common/process/decoder';
import { ProcessServiceFactory } from '../../../client/common/process/processFactory';
import { PythonExecutionFactory } from '../../../client/common/process/pythonExecutionFactory';
import { registerTypes } from '../../../client/common/process/serviceRegistry';
import { IBufferDecoder, IProcessServiceFactory, IPythonExecutionFactory } from '../../../client/common/process/types';
import { ServiceManager } from '../../../client/ioc/serviceManager';
import { IServiceManager } from '../../../client/ioc/types';

suite('Common Process Service Registry', () => {
    let serviceManager: IServiceManager;

    setup(() => {
        serviceManager = mock(ServiceManager);
    });

    test('Ensure services are registered', async () => {
        registerTypes(instance(serviceManager));
        verify(serviceManager.addSingleton<IBufferDecoder>(IBufferDecoder, BufferDecoder)).once();
        verify(
            serviceManager.addSingleton<IProcessServiceFactory>(IProcessServiceFactory, ProcessServiceFactory)
        ).once();
        verify(
            serviceManager.addSingleton<IPythonExecutionFactory>(IPythonExecutionFactory, PythonExecutionFactory)
        ).once();
    });
});
