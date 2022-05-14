// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IExtensionSingleActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry.web';
import { ExportCommands } from './commands/exportCommands';
import { CellHashProviderFactory } from './editor-integration/cellHashProviderFactory';
import { IExportCommands } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<CellHashProviderFactory>(CellHashProviderFactory, CellHashProviderFactory);
    serviceManager.addSingleton<IExportCommands>(IExportCommands, ExportCommands);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, CommandRegistry);
}
