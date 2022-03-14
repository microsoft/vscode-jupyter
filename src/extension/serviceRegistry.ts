// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IServiceManager } from '../client/ioc/types';
import { CommandRegistry } from './commands/commandRegistry';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<CommandRegistry>(CommandRegistry, CommandRegistry);
}
