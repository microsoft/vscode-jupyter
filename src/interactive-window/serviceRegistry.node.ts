// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ITracebackFormatter } from '../kernels/types';
import { IJupyterExtensionBanner } from '../platform/common/types';
import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry';
import { CodeGeneratorFactory } from './editor-integration/codeGeneratorFactory';
import { CodeLensFactory } from './editor-integration/codeLensFactory';
import { DataScienceCodeLensProvider } from './editor-integration/codelensprovider';
import { CodeWatcher } from './editor-integration/codewatcher';
import { Decorator } from './editor-integration/decorator';
import { GeneratedCodeStorageFactory } from './editor-integration/generatedCodeStorageFactory';
import { HoverProvider } from './editor-integration/hoverProvider';
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
import {
    IInteractiveControllerHelper,
    IInteractiveWindowDebugger,
    IInteractiveWindowDebuggingManager,
    IInteractiveWindowProvider
} from './types';
import { InteractiveWindowDebugger } from './debugger/interactiveWindowDebugger.node';
import { InteractiveWindowDebuggingManager } from './debugger/jupyter/debuggingManager';
import { BANNER_NAME_INTERACTIVE_SHIFTENTER, InteractiveShiftEnterBanner } from './shiftEnterBanner';
import { InteractiveWindowDebuggingStartupCodeProvider } from './debugger/startupCodeProvider';
import { PythonCellFoldingProvider } from './editor-integration/pythonCellFoldingProvider';
import { CodeLensProviderActivator } from './editor-integration/codelensProviderActivator';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { InteractiveControllerHelper } from './InteractiveControllerHelper';
import { KernelStartupCodeProvider } from './kernelStartupCodeProvider.node';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IInteractiveWindowProvider>(IInteractiveWindowProvider, InteractiveWindowProvider);
    serviceManager.addSingleton<IInteractiveControllerHelper>(
        IInteractiveControllerHelper,
        InteractiveControllerHelper
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, CommandRegistry);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, HoverProvider);
    serviceManager.add<ICodeWatcher>(ICodeWatcher, CodeWatcher);
    serviceManager.addSingleton<ICodeLensFactory>(ICodeLensFactory, CodeLensFactory);
    serviceManager.addSingleton<IDataScienceCodeLensProvider>(
        IDataScienceCodeLensProvider,
        DataScienceCodeLensProvider
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        CodeLensProviderActivator
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        PythonCellFoldingProvider
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, Decorator);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        GeneratedCodeStorageManager
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelStartupCodeProvider
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        InteractiveWindowDebuggingStartupCodeProvider
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
    serviceManager.addSingleton<IInteractiveWindowDebuggingManager>(
        IInteractiveWindowDebuggingManager,
        InteractiveWindowDebuggingManager,
        undefined,
        [IExtensionSyncActivationService]
    );
    serviceManager.addSingleton<IJupyterExtensionBanner>(
        IJupyterExtensionBanner,
        InteractiveShiftEnterBanner,
        BANNER_NAME_INTERACTIVE_SHIFTENTER
    );
}
