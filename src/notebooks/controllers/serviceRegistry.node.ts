// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { ServerConnectionControllerCommands } from './commands/serverConnectionControllerCommands';
import { ConnectionDisplayDataProvider } from './connectionDisplayData';
import { ControllerDefaultService } from './controllerDefaultService';
import { ControllerRegistration } from './controllerRegistration';
import { registerTypes as registerWidgetTypes } from './ipywidgets/serviceRegistry.node';
import { KernelRankingHelper } from './kernelRanking/kernelRankingHelper';
import { KernelSourceCommandHandler } from './kernelSource/kernelSourceCommandHandler';
import { NotebookKernelSourceSelector } from './kernelSource/notebookKernelSourceSelector';
import {
    IControllerDefaultService,
    IControllerRegistration,
    IKernelRankingHelper,
    INotebookKernelSourceSelector
} from './types';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IKernelRankingHelper>(IKernelRankingHelper, KernelRankingHelper);
    serviceManager.addSingleton<IControllerRegistration>(IControllerRegistration, ControllerRegistration);
    serviceManager.addBinding(IControllerRegistration, IExtensionSyncActivationService);
    serviceManager.addSingleton<IControllerDefaultService>(IControllerDefaultService, ControllerDefaultService);
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
