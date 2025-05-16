// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IServiceManager } from '../ioc/types';
import { IPythonChatTools, OldPythonApiProvider, PythonChatTools, PythonExtensionChecker } from './pythonApi';
import { IPythonApiProvider, IPythonExtensionChecker } from './types';

export function registerTypes(serviceManager: IServiceManager): void {
    serviceManager.addSingleton<IPythonApiProvider>(IPythonApiProvider, OldPythonApiProvider);
    serviceManager.addSingleton<IPythonChatTools>(IPythonChatTools, PythonChatTools);
    serviceManager.addSingleton<IPythonExtensionChecker>(IPythonExtensionChecker, PythonExtensionChecker);
}
