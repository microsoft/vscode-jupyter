// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { ITracebackFormatter } from '../kernels/types';
import { IExtensionSingleActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry.web';
import { ExportCommands } from './commands/exportCommands';
import { CellHashProviderFactory } from './editor-integration/cellHashProviderFactory';
import { InteractiveWindowTracebackFormatter } from './outputs/tracebackFormatter';
import { IExportCommands } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<CellHashProviderFactory>(CellHashProviderFactory, CellHashProviderFactory);
    serviceManager.addSingleton<IExportCommands>(IExportCommands, ExportCommands);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, CommandRegistry);
    serviceManager.addSingleton<ITracebackFormatter>(ITracebackFormatter, InteractiveWindowTracebackFormatter);
}
