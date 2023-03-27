// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonExtensionChecker } from '../platform/api/types';
import { Identifiers, isPreReleaseVersion } from '../platform/common/constants';
import { IServiceManager } from '../platform/ioc/types';
import { setSharedProperty } from '../telemetry';
import { KernelDependencyService } from './kernelDependencyService.node';
import { JupyterPaths } from './raw/finder/jupyterPaths.node';
import { LocalKnownPathKernelSpecFinder } from './raw/finder/localKnownPathKernelSpecFinder.node';
import { PreferredRemoteKernelIdProvider } from './jupyter/connection/preferredRemoteKernelIdProvider';
import { KernelEnvironmentVariablesService } from './raw/launcher/kernelEnvVarsService.node';
import { KernelLauncher } from './raw/launcher/kernelLauncher.node';
import { HostRawNotebookProvider } from './raw/session/hostRawNotebookProvider.node';
import { RawNotebookSupportedService } from './raw/session/rawNotebookSupportedService.node';
import { IKernelLauncher, IRawNotebookProvider, IRawNotebookSupportedService } from './raw/types';
import { JupyterVariables } from './variables/jupyterVariables';
import { KernelVariables } from './variables/kernelVariables';
import { PreWarmActivatedJupyterEnvironmentVariables } from './variables/preWarmVariables.node';
import { PythonVariablesRequester } from './variables/pythonVariableRequester';
import {
    IKernelDependencyService,
    IKernelFinder,
    IKernelProvider,
    IStartupCodeProvider,
    IThirdPartyKernelProvider
} from './types';
import { IJupyterVariables, IKernelVariableRequester } from './variables/types';
import { KernelCrashMonitor } from './kernelCrashMonitor';
import { KernelAutoRestartMonitor } from './kernelAutoRestartMonitor.node';
import { registerTypes as registerJupyterTypes } from './jupyter/serviceRegistry.node';
import { KernelProvider, ThirdPartyKernelProvider } from './kernelProvider.node';
import { KernelFinder } from './kernelFinder';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';
import { Activation } from './activation.node';
import { PortAttributesProviders } from './portAttributeProvider.node';
import { ServerPreload } from './jupyter/launcher/serverPreload.node';
import { KernelStartupCodeProvider } from './kernelStartupCodeProvider.node';
import { KernelAutoReconnectMonitor } from './kernelAutoReConnectMonitor';
import { PythonKernelInterruptDaemon } from './raw/finder/pythonKernelInterruptDaemon.node';
import { KernelWorkingFolder } from './kernelWorkingFolder.node';
import { TrustedKernelPaths } from './raw/finder/trustedKernelPaths.node';
import { ITrustedKernelPaths } from './raw/finder/types';
import { KernelStatusProvider } from './kernelStatusProvider';
import { KernelStartupTelemetry } from './kernelStartupTelemetry.node';
import { KernelCompletionsPreWarmer } from './execution/kernelCompletionPreWarmer';
import { ContributedLocalKernelSpecFinder } from './raw/finder/contributedLocalKernelSpecFinder.node';
import { ContributedLocalPythonEnvFinder } from './raw/finder/contributedLocalPythonEnvFinder.node';
import { KernelRefreshIndicator } from './kernelRefreshIndicator.node';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './raw/finder/localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { RemoteJupyterServerMruUpdate } from './jupyter/connection/remoteJupyterServerMruUpdate';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, Activation);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, ServerPreload);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        PortAttributesProviders
    );
    serviceManager.addSingleton<IRawNotebookSupportedService>(
        IRawNotebookSupportedService,
        RawNotebookSupportedService
    );
    serviceManager.addSingleton<PreferredRemoteKernelIdProvider>(
        PreferredRemoteKernelIdProvider,
        PreferredRemoteKernelIdProvider
    );
    serviceManager.addSingleton<IRawNotebookProvider>(IRawNotebookProvider, HostRawNotebookProvider);
    serviceManager.addSingleton<IKernelLauncher>(IKernelLauncher, KernelLauncher);
    serviceManager.addSingleton<KernelEnvironmentVariablesService>(
        KernelEnvironmentVariablesService,
        KernelEnvironmentVariablesService
    );
    serviceManager.addSingleton<IKernelFinder>(IKernelFinder, KernelFinder);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ContributedLocalKernelSpecFinder
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ContributedLocalPythonEnvFinder
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RemoteJupyterServerMruUpdate
    );

    serviceManager.addSingleton<JupyterPaths>(JupyterPaths, JupyterPaths);
    serviceManager.addSingleton<ITrustedKernelPaths>(ITrustedKernelPaths, TrustedKernelPaths);
    serviceManager.addSingleton<LocalKnownPathKernelSpecFinder>(
        LocalKnownPathKernelSpecFinder,
        LocalKnownPathKernelSpecFinder
    );
    serviceManager.addBinding(LocalKnownPathKernelSpecFinder, IExtensionSyncActivationService);

    serviceManager.addSingleton<LocalPythonAndRelatedNonPythonKernelSpecFinder>(
        LocalPythonAndRelatedNonPythonKernelSpecFinder,
        LocalPythonAndRelatedNonPythonKernelSpecFinder
    );

    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelStatusProvider);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        PreWarmActivatedJupyterEnvironmentVariables
    );
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, JupyterVariables, Identifiers.ALL_VARIABLES);
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, KernelVariables, Identifiers.KERNEL_VARIABLES);
    serviceManager.addSingleton<IKernelVariableRequester>(
        IKernelVariableRequester,
        PythonVariablesRequester,
        Identifiers.PYTHON_VARIABLES_REQUESTER
    );
    serviceManager.addSingleton<IKernelDependencyService>(IKernelDependencyService, KernelDependencyService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelCrashMonitor);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelRefreshIndicator
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelAutoReconnectMonitor
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelAutoRestartMonitor
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelStartupTelemetry
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelCompletionsPreWarmer
    );
    serviceManager.addSingleton<IKernelProvider>(IKernelProvider, KernelProvider);
    serviceManager.addSingleton<IThirdPartyKernelProvider>(IThirdPartyKernelProvider, ThirdPartyKernelProvider);

    // Subdirectories
    registerJupyterTypes(serviceManager, isDevMode);
    setSharedProperty('isInsiderExtension', isPreReleaseVersion());

    const isPythonExtensionInstalled = serviceManager.get<IPythonExtensionChecker>(IPythonExtensionChecker);
    setSharedProperty(
        'isPythonExtensionInstalled',
        isPythonExtensionInstalled.isPythonExtensionInstalled ? 'true' : 'false'
    );
    const rawService = serviceManager.get<IRawNotebookSupportedService>(IRawNotebookSupportedService);
    setSharedProperty('rawKernelSupported', rawService.isSupported ? 'true' : 'false');
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        CellOutputDisplayIdTracker
    );

    serviceManager.addSingleton<IStartupCodeProvider>(IStartupCodeProvider, KernelStartupCodeProvider);
    serviceManager.addSingleton<PythonKernelInterruptDaemon>(PythonKernelInterruptDaemon, PythonKernelInterruptDaemon);
    serviceManager.addSingleton(KernelWorkingFolder, KernelWorkingFolder);
}
