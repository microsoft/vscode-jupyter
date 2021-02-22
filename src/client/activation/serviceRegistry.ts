// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BANNER_NAME_INTERACTIVE_SHIFTENTER, IJupyterExtensionBanner, ISurveyBanner } from '../common/types';
import { DataScienceSurveyBanner } from '../datascience/dataScienceSurveyBanner';
import { OpenNotebookBanner } from '../datascience/openNotebookBanner';
import { InteractiveShiftEnterBanner } from '../datascience/shiftEnterBanner';
import { IServiceManager } from '../ioc/types';
import { ExtensionActivationManager } from './activationManager';
import { MigrateDataScienceSettingsService } from './migrateDataScienceSettingsService';

import { IExtensionActivationManager, IExtensionActivationService, IExtensionSingleActivationService } from './types';

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.add<IExtensionActivationManager>(IExtensionActivationManager, ExtensionActivationManager);
    serviceManager.addSingleton<IExtensionActivationService>(
        IExtensionActivationService,
        MigrateDataScienceSettingsService
    );
    serviceManager.addSingleton<ISurveyBanner>(ISurveyBanner, DataScienceSurveyBanner);
    serviceManager.addBinding(ISurveyBanner, IExtensionSingleActivationService);
    serviceManager.addSingleton<IJupyterExtensionBanner>(
        IJupyterExtensionBanner,
        InteractiveShiftEnterBanner,
        BANNER_NAME_INTERACTIVE_SHIFTENTER
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        OpenNotebookBanner
    );
}
