// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../activation/types';
import { IServiceManager } from '../ioc/types';
import { PythonEnvironmentFilter } from './filter/filterService';
import { PythonEnvFilterSettingMigration } from './filter/settingsMigration';
import { PythonFilterUICommandDeprecation } from './filter/uiDeprecationHandler';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        PythonEnvFilterSettingMigration
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        PythonFilterUICommandDeprecation
    );
    serviceManager.addSingleton<PythonEnvironmentFilter>(PythonEnvironmentFilter, PythonEnvironmentFilter);
}
