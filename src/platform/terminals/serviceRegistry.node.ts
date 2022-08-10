// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { interfaces } from 'inversify';
import { ClassType } from '../ioc/types';
import { CodeExecutionHelper } from './codeExecution/codeExecutionHelper.node';
import { TerminalHelper } from './helper.node';
import { SettingsShellDetector } from './shellDetectors/settingsShellDetector.node';
import { TerminalNameShellDetector } from './shellDetectors/terminalNameShellDetector.node';
import { UserEnvironmentShellDetector } from './shellDetectors/userEnvironmentShellDetector.node';
import { VSCEnvironmentShellDetector } from './shellDetectors/vscEnvironmentShellDetector.node';
import { ICodeExecutionHelper, IShellDetector, ITerminalHelper } from './types';

interface IServiceRegistry {
    addSingleton<T>(
        serviceIdentifier: interfaces.ServiceIdentifier<T>,
        constructor: ClassType<T>,
        name?: string | number | symbol
    ): void;
}

export function registerTypes(serviceManager: IServiceRegistry) {
    serviceManager.addSingleton<ICodeExecutionHelper>(ICodeExecutionHelper, CodeExecutionHelper);
    serviceManager.addSingleton<IShellDetector>(IShellDetector, TerminalNameShellDetector);
    serviceManager.addSingleton<IShellDetector>(IShellDetector, SettingsShellDetector);
    serviceManager.addSingleton<IShellDetector>(IShellDetector, UserEnvironmentShellDetector);
    serviceManager.addSingleton<IShellDetector>(IShellDetector, VSCEnvironmentShellDetector);
    serviceManager.addSingleton<ITerminalHelper>(ITerminalHelper, TerminalHelper);
}
