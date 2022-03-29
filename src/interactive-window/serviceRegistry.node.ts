// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IExtensionSyncActivationService, IExtensionSingleActivationService } from '../platform/activation/types';
import { IDataScienceCommandListener } from '../platform/common/types';
import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry.node';
import { ExportCommands } from './commands/exportCommands.node';
import { CellHashProviderFactory } from './editor-integration/cellHashProviderFactory.node';
import { CodeLensFactory } from './editor-integration/codeLensFactory.node';
import { DataScienceCodeLensProvider } from './editor-integration/codelensprovider.node';
import { CodeWatcher } from './editor-integration/codewatcher.node';
import { Decorator } from './editor-integration/decorator.node';
import { HoverProvider } from './editor-integration/hoverProvider.node';
import { ICodeWatcher, ICodeLensFactory, IDataScienceCodeLensProvider } from './editor-integration/types';
import { InteractiveWindowCommandListener } from './interactiveWindowCommandListener.node';
import { InteractiveWindowProvider } from './interactiveWindowProvider.node';
import { IInteractiveWindowProvider } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IInteractiveWindowProvider>(IInteractiveWindowProvider, InteractiveWindowProvider);
    serviceManager.addSingleton<IDataScienceCommandListener>(
        IDataScienceCommandListener,
        InteractiveWindowCommandListener
    );
    serviceManager.addSingleton<CommandRegistry>(CommandRegistry, CommandRegistry);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, HoverProvider);
    serviceManager.add<ICodeWatcher>(ICodeWatcher, CodeWatcher);
    serviceManager.addSingleton<ICodeLensFactory>(ICodeLensFactory, CodeLensFactory);
    serviceManager.addSingleton<IDataScienceCodeLensProvider>(
        IDataScienceCodeLensProvider,
        DataScienceCodeLensProvider
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, Decorator);
    serviceManager.addSingleton<ExportCommands>(ExportCommands, ExportCommands);
    serviceManager.addSingleton<CellHashProviderFactory>(CellHashProviderFactory, CellHashProviderFactory);
}
