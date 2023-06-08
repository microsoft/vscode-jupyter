// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { ConnectionDisplayDataProvider } from './connectionDisplayData.node';
import { ControllerRegistration } from './controllerRegistration';
import { registerTypes as registerWidgetTypes } from './ipywidgets/serviceRegistry.node';
import { KernelSourceCommandHandler } from './kernelSource/kernelSourceCommandHandler';
import { NotebookKernelSourceSelector } from './kernelSource/notebookKernelSourceSelector';
import { IConnectionDisplayDataProvider, IControllerRegistration, INotebookKernelSourceSelector } from './types';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IControllerRegistration>(IControllerRegistration, ControllerRegistration);
    serviceManager.addBinding(IControllerRegistration, IExtensionSyncActivationService);
    serviceManager.addSingleton<IConnectionDisplayDataProvider>(
        IConnectionDisplayDataProvider,
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
    registerWidgetTypes(serviceManager, isDevMode);
}
