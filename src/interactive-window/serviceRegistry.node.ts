// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { ITracebackFormatter } from '../kernels/types';
import { IExtensionSyncActivationService, IExtensionSingleActivationService } from '../platform/activation/types';
import { IDataScienceCommandListener } from '../platform/common/types';
import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry';
import { ExportCommands } from './commands/exportCommands';
import { CodeGeneratorFactory } from './editor-integration/codeGeneratorFactory';
import { CodeLensFactory } from './editor-integration/codeLensFactory';
import { DataScienceCodeLensProvider } from './editor-integration/codelensprovider';
import { CodeWatcher } from './editor-integration/codewatcher';
import { Decorator } from './editor-integration/decorator';
import { GeneratedCodeStorageFactory } from './editor-integration/generatedCodeStorageFactory';
import { HoverProvider } from './editor-integration/hoverProvider';
import { InteractiveWindowCommandListener } from './interactiveWindowCommandListener';
import { InteractiveWindowProvider } from './interactiveWindowProvider';
import {
    ICodeWatcher,
    ICodeLensFactory,
    IDataScienceCodeLensProvider,
    IGeneratedCodeStorageFactory,
    ICodeGeneratorFactory
} from './editor-integration/types';
import { GeneratedCodeStorageManager } from './generatedCodeStoreManager';
import { InteractiveWindowTracebackFormatter } from './outputs/tracebackFormatter';
import { IExportCommands, IInteractiveWindowDebugger, IInteractiveWindowProvider } from './types';
import { InteractiveWindowDebugger } from './debugger/interactiveWindowDebugger.node';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IInteractiveWindowProvider>(IInteractiveWindowProvider, InteractiveWindowProvider);
    serviceManager.addSingleton<IDataScienceCommandListener>(
        IDataScienceCommandListener,
        InteractiveWindowCommandListener
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, CommandRegistry);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, HoverProvider);
    serviceManager.add<ICodeWatcher>(ICodeWatcher, CodeWatcher);
    serviceManager.addSingleton<ICodeLensFactory>(ICodeLensFactory, CodeLensFactory);
    serviceManager.addSingleton<IDataScienceCodeLensProvider>(
        IDataScienceCodeLensProvider,
        DataScienceCodeLensProvider
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, Decorator);
    serviceManager.addSingleton<IExportCommands>(IExportCommands, ExportCommands);
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
    serviceManager.addSingleton<IInteractiveWindowDebugger>(IInteractiveWindowDebugger, InteractiveWindowDebugger);
}
