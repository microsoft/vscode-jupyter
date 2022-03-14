// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IExtensionSyncActivationService, IExtensionSingleActivationService } from '../client/activation/types';
import {
    IInteractiveWindowProvider,
    IDataScienceCommandListener,
    ICodeLensFactory,
    ICodeWatcher,
    IDataScienceCodeLensProvider
} from '../client/datascience/types';
import { IServiceManager } from '../client/ioc/types';
import { CommandRegistry } from './commands/commandRegistry';
import { ExportCommands } from './commands/exportCommands';
import { CellHashProviderFactory } from './editor-integration/cellHashProviderFactory';
import { CodeLensFactory } from './editor-integration/codeLensFactory';
import { DataScienceCodeLensProvider } from './editor-integration/codelensprovider';
import { CodeWatcher } from './editor-integration/codewatcher';
import { Decorator } from './editor-integration/decorator';
import { HoverProvider } from './editor-integration/hoverProvider';
import { InteractiveWindowCommandListener } from './interactiveWindowCommandListener';
import { InteractiveWindowProvider } from './interactiveWindowProvider';

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
