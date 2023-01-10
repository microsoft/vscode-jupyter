// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { ControllerDefaultService } from './controllerDefaultService';
import { ControllerPreferredService } from './controllerPreferredService';
import { ControllerRegistration } from './controllerRegistration';
import {
    IControllerDefaultService,
    IControllerPreferredService,
    IControllerRegistration,
    IKernelRankingHelper,
    INotebookKernelSourceSelector
} from './types';
import { registerTypes as registerWidgetTypes } from './ipywidgets/serviceRegistry.web';
import { KernelRankingHelper } from './kernelRanking/kernelRankingHelper';
import { NotebookKernelSourceSelector } from './kernelSource/notebookKernelSourceSelector';
import { ConnectionDisplayDataProvider } from './connectionDisplayData';
import { KernelSourceCommandHandler } from './kernelSource/kernelSourceCommandHandler';
import { ServerConnectionControllerCommands } from './commands/serverConnectionControllerCommands';
import { ControllerPreferredServiceWrapper } from './controllerPreferredServiceWrapper';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IKernelRankingHelper>(IKernelRankingHelper, KernelRankingHelper);
    serviceManager.addSingleton<IControllerRegistration>(IControllerRegistration, ControllerRegistration);
    serviceManager.addBinding(IControllerRegistration, IExtensionSyncActivationService);
    serviceManager.addSingleton<IControllerDefaultService>(IControllerDefaultService, ControllerDefaultService);
    serviceManager.addSingleton<IControllerPreferredService>(
        IControllerPreferredService,
        ControllerPreferredServiceWrapper
    );
    serviceManager.addBinding(IControllerPreferredService, IExtensionSyncActivationService);
    serviceManager.add(ControllerPreferredService, ControllerPreferredService);
    serviceManager.addSingleton<ConnectionDisplayDataProvider>(
        ConnectionDisplayDataProvider,
        ConnectionDisplayDataProvider
    );
    serviceManager.addSingleton<INotebookKernelSourceSelector>(
        INotebookKernelSourceSelector,
        NotebookKernelSourceSelector
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelSourceCommandHandler
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ServerConnectionControllerCommands
    );
    registerWidgetTypes(serviceManager, isDevMode);
}
