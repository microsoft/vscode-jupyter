// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry';
import { registerTypes as registerApiTypes } from './api/serviceRegistry';
import { registerTypes as commonRegisterTypes } from './common/serviceRegistry';
import { registerTypes as dataScienceRegisterTypes } from './datascience/serviceRegistry';
import { registerLoggerTypes } from './logging/serviceRegistry';
import { registerTypes as commonRegisterTerminalTypes } from './terminals/serviceRegistry';
import { registerTypes as activationRegisterTypes } from './activation/serviceRegistry';
import { registerTypes as telemetryRegisterTypes } from './telemetry/serviceRegistry';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    // Logging should be done first so we get logging going asap
    registerLoggerTypes(serviceManager);
    serviceManager.addSingleton<CommandRegistry>(CommandRegistry, CommandRegistry);
    activationRegisterTypes(serviceManager);
    registerApiTypes(serviceManager);
    commonRegisterTypes(serviceManager);
    dataScienceRegisterTypes(serviceManager, isDevMode);
    commonRegisterTerminalTypes(serviceManager);
    telemetryRegisterTypes(serviceManager);
}
