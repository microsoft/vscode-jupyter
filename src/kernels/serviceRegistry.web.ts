// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonExtensionChecker } from '../platform/api/types';
import { Identifiers, isPreReleaseVersion } from '../platform/common/constants';

import { IServiceManager } from '../platform/ioc/types';
import { setSharedProperty } from '../telemetry';
import { IRawNotebookSupportedService } from './raw/types';
import { KernelCrashMonitor } from './kernelCrashMonitor';
import { registerTypes as registerJupyterTypes } from './jupyter/serviceRegistry.web';
import { injectable } from 'inversify';
import { IKernelDependencyService, IKernelFinder, IKernelProvider, IThirdPartyKernelProvider } from './types';
import { KernelProvider, ThirdPartyKernelProvider } from './kernelProvider.web';
import { KernelFinder } from './kernelFinder';
import { PreferredRemoteKernelIdProvider } from './jupyter/preferredRemoteKernelIdProvider';
import { IJupyterVariables, IKernelVariableRequester } from './variables/types';
import { KernelVariables } from './variables/kernelVariables';
import { JupyterVariables } from './variables/jupyterVariables';
import { PythonVariablesRequester } from './variables/pythonVariableRequester';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';
import { KernelAutoReconnectMonitor } from './kernelAutoReConnectMonitor';
import { TrustedKernelPaths } from './raw/finder/trustedKernelPaths.web';
import { ITrustedKernelPaths } from './raw/finder/types';
import { KernelStatusProvider } from './kernelStatusProvider';
import { KernelCompletionsPreWarmer } from './execution/kernelCompletionPreWarmer';
import { KernelRefreshIndicator } from './kernelRefreshIndicator.web';
import { RemoteJupyterServerMruUpdate } from './remoteJupyterServerMruUpdate';
import { KernelDependencyService } from './kernelDependencyService.web';

@injectable()
class RawNotebookSupportedService implements IRawNotebookSupportedService {
    isSupported: boolean = false;
}

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IRawNotebookSupportedService>(
        IRawNotebookSupportedService,
        RawNotebookSupportedService
    );
    setSharedProperty('isInsiderExtension', isPreReleaseVersion());

    const isPythonExtensionInstalled = serviceManager.get<IPythonExtensionChecker>(IPythonExtensionChecker);
    setSharedProperty(
        'isPythonExtensionInstalled',
        isPythonExtensionInstalled.isPythonExtensionInstalled ? 'true' : 'false'
    );
    const rawService = serviceManager.get<IRawNotebookSupportedService>(IRawNotebookSupportedService);
    setSharedProperty('rawKernelSupported', rawService.isSupported ? 'true' : 'false');

    serviceManager.addSingleton<IKernelVariableRequester>(
        IKernelVariableRequester,
        PythonVariablesRequester,
        Identifiers.PYTHON_VARIABLES_REQUESTER
    );
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, JupyterVariables, Identifiers.ALL_VARIABLES);
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, KernelVariables, Identifiers.KERNEL_VARIABLES);

    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelCrashMonitor);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelRefreshIndicator
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelStatusProvider);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelAutoReconnectMonitor
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelCompletionsPreWarmer
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RemoteJupyterServerMruUpdate
    );

    serviceManager.addSingleton<IKernelProvider>(IKernelProvider, KernelProvider);
    serviceManager.addSingleton<ITrustedKernelPaths>(ITrustedKernelPaths, TrustedKernelPaths);
    serviceManager.addSingleton<IThirdPartyKernelProvider>(IThirdPartyKernelProvider, ThirdPartyKernelProvider);
    serviceManager.addSingleton<PreferredRemoteKernelIdProvider>(
        PreferredRemoteKernelIdProvider,
        PreferredRemoteKernelIdProvider
    );
    serviceManager.addSingleton<IKernelFinder>(IKernelFinder, KernelFinder);
    serviceManager.addSingleton<IKernelDependencyService>(IKernelDependencyService, KernelDependencyService);
    // Subdirectories
    registerJupyterTypes(serviceManager, isDevMode);

    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        CellOutputDisplayIdTracker
    );
}
