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
    INotebookKernelSourceSelector
} from './types';
import { registerTypes as registerWidgetTypes } from './ipywidgets/serviceRegistry.web';
import { KernelRankingHelper } from './kernelRanking/kernelRankingHelper';
import { NotebookKernelSourceSelector } from './kernelSource/notebookKernelSourceSelector';
import { ConnectionDisplayDataProvider } from './connectionDisplayData';
import { KernelSourceCommandHandler } from './kernelSource/kernelSourceCommandHandler';
import { ServerConnectionControllerCommands } from './commands/serverConnectionControllerCommands';

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
    serviceManager.addSingleton<INotebookKernelSourceSelector>(
        INotebookKernelSourceSelector,
        NotebookKernelSourceSelector
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelSourceCommandHandler
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSingleActivationService,
        ServerConnectionControllerCommands
    );
    registerWidgetTypes(serviceManager, isDevMode);
}
