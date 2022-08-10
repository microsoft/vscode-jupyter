// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IStartupCodeProvider, ITracebackFormatter } from '../kernels/types';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry';
import { CodeLensFactory } from './editor-integration/codeLensFactory';
import { DataScienceCodeLensProvider } from './editor-integration/codelensprovider';
import { CodeWatcher } from './editor-integration/codewatcher';
import { Decorator } from './editor-integration/decorator';
import {
    ICodeWatcher,
    ICodeLensFactory,
    IDataScienceCodeLensProvider,
    ICodeGeneratorFactory
} from './editor-integration/types';
import { InteractiveWindowProvider } from './interactiveWindowProvider';
import { IInteractiveWindowDebuggingManager, IInteractiveWindowProvider } from './types';
import { CodeGeneratorFactory } from './editor-integration/codeGeneratorFactory';
import { GeneratedCodeStorageFactory } from './editor-integration/generatedCodeStorageFactory';
import { IGeneratedCodeStorageFactory } from './editor-integration/types';
import { GeneratedCodeStorageManager } from './generatedCodeStoreManager';
import { InteractiveWindowTracebackFormatter } from './outputs/tracebackFormatter';
import { InteractiveWindowDebuggingManager } from './debugger/jupyter/debuggingManager';
import { InteractiveWindowDebuggingStartupCodeProvider } from './debugger/startupCodeProvider';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IInteractiveWindowProvider>(IInteractiveWindowProvider, InteractiveWindowProvider);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, CommandRegistry);
    serviceManager.add<ICodeWatcher>(ICodeWatcher, CodeWatcher);
    serviceManager.addSingleton<ICodeLensFactory>(ICodeLensFactory, CodeLensFactory);
    serviceManager.addSingleton<IDataScienceCodeLensProvider>(
        IDataScienceCodeLensProvider,
        DataScienceCodeLensProvider
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, Decorator);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        GeneratedCodeStorageManager
    );
    serviceManager.addSingleton<ICodeGeneratorFactory>(ICodeGeneratorFactory, CodeGeneratorFactory, undefined, [
        IExtensionSyncActivationService
    ]);
    serviceManager.addSingleton<IGeneratedCodeStorageFactory>(
        IGeneratedCodeStorageFactory,
        GeneratedCodeStorageFactory
    );
    serviceManager.addSingleton<ITracebackFormatter>(ITracebackFormatter, InteractiveWindowTracebackFormatter);
    serviceManager.addSingleton<IInteractiveWindowDebuggingManager>(
        IInteractiveWindowDebuggingManager,
        InteractiveWindowDebuggingManager,
        undefined,
        [IExtensionSingleActivationService]
    );
    serviceManager.addSingleton<IStartupCodeProvider>(
        IStartupCodeProvider,
        InteractiveWindowDebuggingStartupCodeProvider
    );
}
