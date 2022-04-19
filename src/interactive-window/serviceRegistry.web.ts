// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry';
import { CellHashProviderFactory } from './editor-integration/cellHashProviderFactory';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<CellHashProviderFactory>(CellHashProviderFactory, CellHashProviderFactory);
    serviceManager.addSingleton<CommandRegistry>(CommandRegistry, CommandRegistry);
}
