// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BANNER_NAME_INTERACTIVE_SHIFTENTER, IJupyterExtensionBanner, ISurveyBanner } from '../common/types';
import { DataScienceSurveyBanner } from '../common/dataScienceSurveyBanner.node';
import { IServiceManager } from '../ioc/types';
import { ExtensionActivationManager } from './activationManager';

import { IExtensionActivationManager, IExtensionSingleActivationService } from './types';
import { InteractiveShiftEnterBanner } from '../../interactive-window/shiftEnterBanner.node';
import { WorkspaceActivation } from './workspaceActivation.node';

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.add<IExtensionActivationManager>(IExtensionActivationManager, ExtensionActivationManager);
    serviceManager.addSingleton<ISurveyBanner>(ISurveyBanner, DataScienceSurveyBanner);
    serviceManager.addBinding(ISurveyBanner, IExtensionSingleActivationService);
    serviceManager.addSingleton<IJupyterExtensionBanner>(
        IJupyterExtensionBanner,
        InteractiveShiftEnterBanner,
        BANNER_NAME_INTERACTIVE_SHIFTENTER
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        WorkspaceActivation
    );
}
