// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { ConnectionDisplayDataProvider } from './connectionDisplayData.node';
import { ControllerRegistration } from './controllerRegistration';
import { registerTypes as registerWidgetTypes } from './ipywidgets/serviceRegistry.node';
import { KernelSourceCommandHandler } from './kernelSource/kernelSourceCommandHandler';
import { LocalNotebookKernelSourceSelector } from './kernelSource/localNotebookKernelSourceSelector.node';
import { LocalPythonEnvNotebookKernelSourceSelector } from './kernelSource/localPythonEnvKernelSourceSelector.node';
import { RemoteNotebookKernelSourceSelector } from './kernelSource/remoteNotebookKernelSourceSelector';
import { NotebookCellExecutionStateService } from './notebookCellExecutionStateService';
import {
    IConnectionDisplayDataProvider,
    IControllerRegistration,
    ILocalNotebookKernelSourceSelector,
    ILocalPythonNotebookKernelSourceSelector,
    INotebookCellExecutionStateService,
    IRemoteNotebookKernelSourceSelector
} from './types';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IControllerRegistration>(IControllerRegistration, ControllerRegistration);
    serviceManager.addBinding(IControllerRegistration, IExtensionSyncActivationService);
    serviceManager.addSingleton<IConnectionDisplayDataProvider>(
        IConnectionDisplayDataProvider,
        ConnectionDisplayDataProvider
    );
    serviceManager.addSingleton<IRemoteNotebookKernelSourceSelector>(
        IRemoteNotebookKernelSourceSelector,
        RemoteNotebookKernelSourceSelector
    );
    serviceManager.addSingleton<ILocalNotebookKernelSourceSelector>(
        ILocalNotebookKernelSourceSelector,
        LocalNotebookKernelSourceSelector
    );
    serviceManager.addSingleton<ILocalPythonNotebookKernelSourceSelector>(
        ILocalPythonNotebookKernelSourceSelector,
        LocalPythonEnvNotebookKernelSourceSelector
    );
    serviceManager.addSingleton<INotebookCellExecutionStateService>(
        INotebookCellExecutionStateService,
        NotebookCellExecutionStateService
    );
    serviceManager.addBinding(ILocalPythonNotebookKernelSourceSelector, IExtensionSyncActivationService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelSourceCommandHandler
    );
    registerWidgetTypes(serviceManager, isDevMode);
}
