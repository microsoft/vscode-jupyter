// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IServiceManager } from '../../ioc/types';
import { CondaService } from './condaService.node';
import { BufferDecoder } from './decoder.node';
import { ProcessServiceFactory } from './processFactory.node';
import { PythonExecutionFactory } from './pythonExecutionFactory.node';
import { IBufferDecoder, IProcessServiceFactory, IPythonExecutionFactory } from './types.node';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IBufferDecoder>(IBufferDecoder, BufferDecoder);
    serviceManager.addSingleton<IProcessServiceFactory>(IProcessServiceFactory, ProcessServiceFactory);
    serviceManager.addSingleton<IPythonExecutionFactory>(IPythonExecutionFactory, PythonExecutionFactory);
    serviceManager.addSingleton<CondaService>(CondaService, CondaService);
}
