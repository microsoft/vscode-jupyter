// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../../platform/activation/types';
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
    IControllerSelection,
    IKernelRankingHelper,
    INotebookKernelSourceSelector,
    IConnectionTracker,
    IConnectionMru
} from './types';
import { registerTypes as registerWidgetTypes } from './ipywidgets/serviceRegistry.web';
import { KernelRankingHelper } from './kernelRanking/kernelRankingHelper';
import { IFeaturesManager } from '../../platform/common/types';
import { NotebookKernelSourceSelector } from './kernelSource/notebookKernelSourceSelector';
import { ConnectionTracker } from './connectionTracker';
import { ConnectionMru } from './connectionMru.web';
import { ConnectionDisplayDataProvider } from './connectionDisplayData';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IKernelRankingHelper>(IKernelRankingHelper, KernelRankingHelper);
    serviceManager.addSingleton<IControllerRegistration>(IControllerRegistration, ControllerRegistration);
    serviceManager.addSingleton<IControllerDefaultService>(IControllerDefaultService, ControllerDefaultService);
    serviceManager.addSingleton<IControllerLoader>(IControllerLoader, ControllerLoader);
    serviceManager.addBinding(IControllerLoader, IExtensionSingleActivationService);
    serviceManager.addSingleton<IControllerPreferredService>(IControllerPreferredService, ControllerPreferredService);
    serviceManager.addBinding(IControllerPreferredService, IExtensionSyncActivationService);
    serviceManager.addSingleton<IControllerSelection>(IControllerSelection, ControllerSelection);
    serviceManager.addSingleton<ConnectionDisplayDataProvider>(
        ConnectionDisplayDataProvider,
        ConnectionDisplayDataProvider
    );

    // Register our kernel source selectors only on the Insiders picker type
    const featureManager = serviceManager.get<IFeaturesManager>(IFeaturesManager);
    if (featureManager.features.kernelPickerType === 'Insiders') {
        serviceManager.addSingleton<INotebookKernelSourceSelector>(
            INotebookKernelSourceSelector,
            NotebookKernelSourceSelector
        );
    }
    serviceManager.addSingleton<IConnectionTracker>(IConnectionTracker, ConnectionTracker);
    serviceManager.addBinding(IConnectionTracker, IExtensionSyncActivationService);
    serviceManager.addSingleton<IConnectionMru>(IConnectionMru, ConnectionMru);

    registerWidgetTypes(serviceManager, isDevMode);
}
