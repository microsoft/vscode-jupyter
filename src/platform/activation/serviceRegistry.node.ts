// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ISurveyBanner } from '../common/types';
import { DataScienceSurveyBanner } from '../common/dataScienceSurveyBanner.node';
import { IServiceManager } from '../ioc/types';
import { ExtensionActivationManager } from './activationManager';

import { IExtensionActivationManager, IExtensionSingleActivationService } from './types';

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.add<IExtensionActivationManager>(IExtensionActivationManager, ExtensionActivationManager);
    serviceManager.addSingleton<ISurveyBanner>(ISurveyBanner, DataScienceSurveyBanner);
    serviceManager.addBinding(ISurveyBanner, IExtensionSingleActivationService);
}
