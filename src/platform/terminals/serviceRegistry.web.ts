// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { interfaces } from 'inversify';
import { ClassType } from '../ioc/types';
import { CodeExecutionHelper } from './codeExecution/codeExecutionHelper.web';
import { ICodeExecutionHelper } from './types';

interface IServiceRegistry {
    addSingleton<T>(
        serviceIdentifier: interfaces.ServiceIdentifier<T>,
        constructor: ClassType<T>,
        name?: string | number | symbol
    ): void;
}

export function registerTypes(serviceManager: IServiceRegistry) {
    serviceManager.addSingleton<ICodeExecutionHelper>(ICodeExecutionHelper, CodeExecutionHelper);
}
