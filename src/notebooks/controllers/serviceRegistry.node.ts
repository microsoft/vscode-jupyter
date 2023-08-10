// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IPythonKernelFinder } from '../../kernels/jupyter/types';
import { LocalPythonKernelFinder } from '../../kernels/raw/finder/localPythonKernelFinder.node';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { ConnectionDisplayDataProvider } from './connectionDisplayData.node';
import { ControllerRegistration } from './controllerRegistration';
import { registerTypes as registerWidgetTypes } from './ipywidgets/serviceRegistry.node';
import { KernelSourceCommandHandler } from './kernelSource/kernelSourceCommandHandler';
import { LocalNotebookKernelSourceSelector } from './kernelSource/localNotebookKernelSourceSelector.node';
import { LocalPythonKernelSelector } from './kernelSource/localPythonKernelSelector.node';
import { RemoteNotebookKernelSourceSelector } from './kernelSource/remoteNotebookKernelSourceSelector';
import {
    IConnectionDisplayDataProvider,
    IControllerRegistration,
    ILocalNotebookKernelSourceSelector,
    ILocalPythonNotebookKernelSourceSelector,
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
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelSourceCommandHandler
    );
    serviceManager.addSingleton<ILocalPythonNotebookKernelSourceSelector>(
        ILocalPythonNotebookKernelSourceSelector,
        LocalPythonKernelSelector
    );
    serviceManager.addSingleton<IPythonKernelFinder>(IPythonKernelFinder, LocalPythonKernelFinder);
    serviceManager.addBinding(IPythonKernelFinder, IExtensionSyncActivationService);
    registerWidgetTypes(serviceManager, isDevMode);
}
