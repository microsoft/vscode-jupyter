// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as vscode from 'vscode';
import { Identifiers } from '../webviews/webview-side/common/constants';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonExtensionChecker } from '../platform/api/types';
import { IApplicationEnvironment } from '../platform/common/application/types';
import { JVSC_EXTENSION_ID } from '../platform/common/constants';
import { IDataScienceCommandListener } from '../platform/common/types';
import { ProtocolParser } from '../platform/debugger/extension/helpers/protocolParser.node';
import { IProtocolParser } from '../platform/debugger/extension/types.node';
import { IServiceManager } from '../platform/ioc/types';
import { setSharedProperty } from '../telemetry';
import { InteractiveWindowDebugger } from './debugging/interactiveWindowDebugger.node';
import { JupyterDebugService } from './debugging/jupyterDebugService.node';
import { registerInstallerTypes } from './installer/serviceRegistry.node';
import { KernelCommandListener } from './kernelCommandListener';
import { KernelDependencyService } from './kernelDependencyService.node';
import { JupyterPaths } from './raw/finder/jupyterPaths.node';
import { LocalKernelFinder } from './raw/finder/localKernelFinder.node';
import { LocalKnownPathKernelSpecFinder } from './raw/finder/localKnownPathKernelSpecFinder.node';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './raw/finder/localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { PreferredRemoteKernelIdProvider } from './jupyter/preferredRemoteKernelIdProvider';
import { KernelEnvironmentVariablesService } from './raw/launcher/kernelEnvVarsService.node';
import { KernelLauncher } from './raw/launcher/kernelLauncher.node';
import { HostRawNotebookProvider } from './raw/session/hostRawNotebookProvider.node';
import { RawNotebookSupportedService } from './raw/session/rawNotebookSupportedService.node';
import { IKernelLauncher, ILocalKernelFinder, IRawNotebookProvider, IRawNotebookSupportedService } from './raw/types';
import { DebuggerVariableRegistration } from './variables/debuggerVariableRegistration.node';
import { DebuggerVariables } from './variables/debuggerVariables.node';
import { JupyterVariables } from './variables/jupyterVariables.node';
import { KernelVariables } from './variables/kernelVariables.node';
import { PreWarmActivatedJupyterEnvironmentVariables } from './variables/preWarmVariables.node';
import { PythonVariablesRequester } from './variables/pythonVariableRequester.node';
import { ICellHashListener } from '../interactive-window/editor-integration/types';
import { IInteractiveWindowDebugger } from '../interactive-window/types';
import { MultiplexingDebugService } from '../platform/debugger/multiplexingDebugService.node';
import { JupyterVariableDataProvider } from '../webviews/extension-side/dataviewer/jupyterVariableDataProvider.node';
import { JupyterVariableDataProviderFactory } from '../webviews/extension-side/dataviewer/jupyterVariableDataProviderFactory.node';
import {
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory
} from '../webviews/extension-side/dataviewer/types';
import { IJupyterDebugService } from './debugging/types';
import { IKernelDependencyService, IKernelFinder, IKernelProvider } from './types';
import { IJupyterVariables, IKernelVariableRequester } from './variables/types';
import { KernelCrashMonitor } from './kernelCrashMonitor';
import { KernelAutoRestartMonitor } from './kernelAutoRestartMonitor.node';
import { registerTypes as registerWidgetTypes } from './ipywidgets-message-coordination/serviceRegistry.node';
import { registerTypes as registerJupyterTypes } from './jupyter/serviceRegistry.node';
import { KernelProvider } from './kernelProvider.node';
import { KernelFinder } from './kernelFinder.node';
import { ServerConnectionType } from './jupyter/launcher/serverConnectionType';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
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
    serviceManager.addSingleton<ILocalKernelFinder>(ILocalKernelFinder, LocalKernelFinder);
    serviceManager.addSingleton<JupyterPaths>(JupyterPaths, JupyterPaths);
    serviceManager.addSingleton<LocalKnownPathKernelSpecFinder>(
        LocalKnownPathKernelSpecFinder,
        LocalKnownPathKernelSpecFinder
    );
    serviceManager.addSingleton<LocalPythonAndRelatedNonPythonKernelSpecFinder>(
        LocalPythonAndRelatedNonPythonKernelSpecFinder,
        LocalPythonAndRelatedNonPythonKernelSpecFinder
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        PreWarmActivatedJupyterEnvironmentVariables
    );
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, KernelCommandListener);
    serviceManager.addSingleton<IInteractiveWindowDebugger>(
        IInteractiveWindowDebugger,
        InteractiveWindowDebugger,
        undefined,
        [ICellHashListener]
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        DebuggerVariableRegistration
    );
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, JupyterVariables, Identifiers.ALL_VARIABLES);
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, KernelVariables, Identifiers.KERNEL_VARIABLES);
    serviceManager.addSingleton<IJupyterVariables>(
        IJupyterVariables,
        DebuggerVariables,
        Identifiers.DEBUGGER_VARIABLES
    );
    serviceManager.addSingleton<IKernelVariableRequester>(
        IKernelVariableRequester,
        PythonVariablesRequester,
        Identifiers.PYTHON_VARIABLES_REQUESTER
    );
    serviceManager.addSingleton<IKernelDependencyService>(IKernelDependencyService, KernelDependencyService);
    serviceManager.add<IProtocolParser>(IProtocolParser, ProtocolParser);
    serviceManager.addSingleton<IJupyterDebugService>(
        IJupyterDebugService,
        MultiplexingDebugService,
        Identifiers.MULTIPLEXING_DEBUGSERVICE
    );
    serviceManager.addSingleton<IJupyterDebugService>(
        IJupyterDebugService,
        JupyterDebugService,
        Identifiers.RUN_BY_LINE_DEBUGSERVICE
    );
    serviceManager.add<IJupyterVariableDataProvider>(IJupyterVariableDataProvider, JupyterVariableDataProvider);
    serviceManager.addSingleton<IJupyterVariableDataProviderFactory>(
        IJupyterVariableDataProviderFactory,
        JupyterVariableDataProviderFactory
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelCrashMonitor);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelAutoRestartMonitor
    );
    serviceManager.addSingleton<IKernelProvider>(IKernelProvider, KernelProvider);
    serviceManager.addSingleton<IKernelFinder>(IKernelFinder, KernelFinder);

    // Subdirectories
    registerJupyterTypes(serviceManager, isDevMode);
    registerInstallerTypes(serviceManager);
    registerWidgetTypes(serviceManager, isDevMode);

    const isVSCInsiders = serviceManager.get<IApplicationEnvironment>(IApplicationEnvironment).channel === 'insiders';
    const packageJson: { engines: { vscode: string } } | undefined =
        vscode.extensions.getExtension(JVSC_EXTENSION_ID)?.packageJSON;
    const isInsiderVersion = packageJson?.engines?.vscode?.toLowerCase()?.endsWith('insider');
    setSharedProperty('isInsiderExtension', isVSCInsiders && isInsiderVersion ? 'true' : 'false');

    // This will ensure all subsequent telemetry will get the context of whether it is a custom/native/old notebook editor.
    // This is temporary, and once we ship native editor this needs to be removed.
    setSharedProperty('ds_notebookeditor', 'native');
    const isLocalConnection = serviceManager.get<ServerConnectionType>(ServerConnectionType).isLocalLaunch;
    setSharedProperty('localOrRemoteConnection', isLocalConnection ? 'local' : 'remote');
    const isPythonExtensionInstalled = serviceManager.get<IPythonExtensionChecker>(IPythonExtensionChecker);
    setSharedProperty(
        'isPythonExtensionInstalled',
        isPythonExtensionInstalled.isPythonExtensionInstalled ? 'true' : 'false'
    );
    const rawService = serviceManager.get<IRawNotebookSupportedService>(IRawNotebookSupportedService);
    setSharedProperty('rawKernelSupported', rawService.isSupported ? 'true' : 'false');
}
