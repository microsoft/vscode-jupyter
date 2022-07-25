// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { ControllerDefaultService } from './controllerDefaultService';
import { ControllerLoader } from './controllerLoader';
import { ControllerPreferredService } from './controllerPreferredService';
import { ControllerRegistration } from './controllerRegistration';
import { ControllerSelection } from './controllerSelection';
import {
    IControllerDefaultService,
    IControllerLoader,
    IControllerPreferredService,
    IControllerRegistration,
    IControllerSelection
} from './types';
import { registerTypes as registerWidgetTypes } from './ipywidgets/serviceRegistry.web';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IControllerRegistration>(IControllerRegistration, ControllerRegistration);
    serviceManager.addSingleton<IControllerDefaultService>(IControllerDefaultService, ControllerDefaultService);
    serviceManager.addSingleton<IControllerLoader>(IControllerLoader, ControllerLoader);
    serviceManager.addBinding(IControllerLoader, IExtensionSingleActivationService);
    serviceManager.addSingleton<IControllerPreferredService>(IControllerPreferredService, ControllerPreferredService);
    serviceManager.addBinding(IControllerPreferredService, IExtensionSingleActivationService);
    serviceManager.addSingleton<IControllerSelection>(IControllerSelection, ControllerSelection);

    registerWidgetTypes(serviceManager, isDevMode);
}
