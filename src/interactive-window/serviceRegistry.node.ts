// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { ITracebackFormatter } from '../kernels/types';
import { IExtensionSyncActivationService, IExtensionSingleActivationService } from '../platform/activation/types';
import { IDataScienceCommandListener } from '../platform/common/types';
import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry.node';
import { ExportCommands } from './commands/exportCommands';
import { CellHashProviderFactory } from './editor-integration/cellHashProviderFactory';
import { CodeLensFactory } from './editor-integration/codeLensFactory';
import { DataScienceCodeLensProvider } from './editor-integration/codelensprovider';
import { CodeWatcher } from './editor-integration/codewatcher';
import { Decorator } from './editor-integration/decorator';
import { HoverProvider } from './editor-integration/hoverProvider';
import { ICodeWatcher, ICodeLensFactory, IDataScienceCodeLensProvider } from './editor-integration/types';
import { InteractiveWindowCommandListener } from './interactiveWindowCommandListener.node';
import { InteractiveWindowProvider } from './interactiveWindowProvider.node';
import { InteractiveWindowTracebackFormatter } from './outputs/tracebackFormatter';
import { IExportCommands, IInteractiveWindowProvider } from './types';

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
    serviceManager.addSingleton<CellHashProviderFactory>(CellHashProviderFactory, CellHashProviderFactory);
    serviceManager.addSingleton<ITracebackFormatter>(ITracebackFormatter, InteractiveWindowTracebackFormatter);
}
