// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IServiceManager } from '../../ioc/types';
import { CondaService } from './condaService';
import { CurrentProcess } from './currentProcess';
import { BufferDecoder } from './decoder';
import { ProcessServiceFactory } from './processFactory';
import { PythonExecutionFactory } from './pythonExecutionFactory';
import { IBufferDecoder, IProcessServiceFactory, IPythonExecutionFactory } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IBufferDecoder>(IBufferDecoder, BufferDecoder);
    serviceManager.addSingleton<IProcessServiceFactory>(IProcessServiceFactory, ProcessServiceFactory);
    serviceManager.addSingleton<IPythonExecutionFactory>(IPythonExecutionFactory, PythonExecutionFactory);
    serviceManager.addSingleton<CondaService>(CondaService, CondaService);
    serviceManager.addSingleton<CurrentProcess>(CurrentProcess, CurrentProcess);
}
