// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as vscode from 'vscode';
import { Identifiers } from '../webviews/webview-side/common/constants';
import { IExtensionSingleActivationService } from '../platform/activation/types';
import { IPythonExtensionChecker } from '../platform/api/types';
import { JupyterCommandLineSelectorCommand } from '../platform/commands/commandLineSelector.node';
import { JupyterServerSelectorCommand } from '../platform/commands/serverSelector.node';
import { IApplicationEnvironment } from '../platform/common/application/types';
import { JVSC_EXTENSION_ID } from '../platform/common/constants';
import { IConfigurationService, IDataScienceCommandListener } from '../platform/common/types';

import { ProtocolParser } from '../platform/debugger/extension/helpers/protocolParser.node';
import { IProtocolParser } from '../platform/debugger/extension/types.node';
import { IServiceManager } from '../platform/ioc/types';
import { setSharedProperty } from '../telemetry';
import { InteractiveWindowDebugger } from './debugging/interactiveWindowDebugger.node';
import { JupyterDebugService } from './debugging/jupyterDebugService.node';
import { isLocalLaunch } from './helpers.node';
import { registerInstallerTypes } from './installer/serviceRegistry.node';
import { IPyWidgetMessageDispatcherFactory } from './ipywidgets-message-coordination/ipyWidgetMessageDispatcherFactory.node';
import { NotebookIPyWidgetCoordinator } from './ipywidgets-message-coordination/notebookIPyWidgetCoordinator.node';
import { JupyterExporter } from './jupyter/import-export/jupyterExporter.node';
import { JupyterImporter } from './jupyter/import-export/jupyterImporter.node';
import { JupyterCommandFactory } from './jupyter/interpreter/jupyterCommand.node';
import { JupyterInterpreterDependencyService } from './jupyter/interpreter/jupyterInterpreterDependencyService.node';
import { JupyterInterpreterOldCacheStateStore } from './jupyter/interpreter/jupyterInterpreterOldCacheStateStore.node';
import { JupyterInterpreterSelectionCommand } from './jupyter/interpreter/jupyterInterpreterSelectionCommand.node';
import { JupyterInterpreterSelector } from './jupyter/interpreter/jupyterInterpreterSelector.node';
import { JupyterInterpreterService } from './jupyter/interpreter/jupyterInterpreterService.node';
import {
    MigrateJupyterInterpreterStateService,
    JupyterInterpreterStateStore
} from './jupyter/interpreter/jupyterInterpreterStateStore.node';
import { JupyterInterpreterSubCommandExecutionService } from './jupyter/interpreter/jupyterInterpreterSubCommandExecutionService.node';
import { NbConvertExportToPythonService } from './jupyter/interpreter/nbconvertExportToPythonService.node';
import { NbConvertInterpreterDependencyChecker } from './jupyter/interpreter/nbconvertInterpreterDependencyChecker.node';
import { CellOutputMimeTypeTracker } from './jupyter/jupyterCellOutputMimeTypeTracker.node';
import { JupyterKernelService } from './jupyter/jupyterKernelService.node';
import { JupyterUriProviderRegistration } from './jupyter/jupyterUriProviderRegistration.node';
import { JupyterCommandLineSelector } from './jupyter/launcher/commandLineSelector.node';
import { JupyterNotebookProvider } from './jupyter/launcher/jupyterNotebookProvider.node';
import { JupyterPasswordConnect } from './jupyter/launcher/jupyterPasswordConnect.node';
import { HostJupyterExecution } from './jupyter/launcher/liveshare/hostJupyterExecution.node';
import { HostJupyterServer } from './jupyter/launcher/liveshare/hostJupyterServer.node';
import { NotebookProvider } from './jupyter/launcher/notebookProvider.node';
import { NotebookServerProvider } from './jupyter/launcher/notebookServerProvider.node';
import { NotebookStarter } from './jupyter/launcher/notebookStarter.node';
import { ServerPreload } from './jupyter/launcher/serverPreload.node';
import { JupyterServerUriStorage } from './jupyter/launcher/serverUriStorage.node';
import { JupyterServerSelector } from './jupyter/serverSelector.node';
import { JupyterSessionManagerFactory } from './jupyter/session/jupyterSessionManagerFactory.node';
import { KernelCommandListener } from './kernelCommandListener.node';
import { KernelDependencyService } from './kernelDependencyService.node';
import { JupyterPaths } from './raw/finder/jupyterPaths.node';
import { LocalKernelFinder } from './raw/finder/localKernelFinder.node';
import { LocalKnownPathKernelSpecFinder } from './raw/finder/localKnownPathKernelSpecFinder.node';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './raw/finder/localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { PreferredRemoteKernelIdProvider } from './raw/finder/preferredRemoteKernelIdProvider.node';
import { RemoteKernelFinder } from './raw/finder/remoteKernelFinder.node';
import { KernelEnvironmentVariablesService } from './raw/launcher/kernelEnvVarsService.node';
import { KernelLauncher } from './raw/launcher/kernelLauncher.node';
import { HostRawNotebookProvider } from './raw/session/hostRawNotebookProvider.node';
import { RawNotebookSupportedService } from './raw/session/rawNotebookSupportedService.node';
import {
    IKernelLauncher,
    ILocalKernelFinder,
    IRawNotebookProvider,
    IRawNotebookSupportedService,
    IRemoteKernelFinder
} from './raw/types';
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
import {
    INotebookExporter,
    INotebookImporter,
    INotebookServer,
    IJupyterNotebookProvider,
    IJupyterExecution,
    IJupyterPasswordConnect,
    IJupyterSessionManagerFactory,
    INbConvertInterpreterDependencyChecker,
    INbConvertExportToPythonService,
    IJupyterServerProvider,
    IJupyterInterpreterDependencyManager,
    IJupyterUriProviderRegistration,
    IJupyterServerUriStorage
} from './jupyter/types';
import { IKernelDependencyService, INotebookProvider } from './types';
import { IJupyterVariables, IKernelVariableRequester } from './variables/types';
import { IJupyterCommandFactory, IJupyterSubCommandExecutionService } from './jupyter/types.node';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IRawNotebookSupportedService>(
        IRawNotebookSupportedService,
        RawNotebookSupportedService
    );
    const isVSCInsiders = serviceManager.get<IApplicationEnvironment>(IApplicationEnvironment).channel === 'insiders';
    const packageJson: { engines: { vscode: string } } | undefined = vscode.extensions.getExtension(JVSC_EXTENSION_ID)
        ?.packageJSON;
    const isInsiderVersion = packageJson?.engines?.vscode?.toLowerCase()?.endsWith('insider');
    setSharedProperty('isInsiderExtension', isVSCInsiders && isInsiderVersion ? 'true' : 'false');

    // This will ensure all subsequent telemetry will get the context of whether it is a custom/native/old notebook editor.
    // This is temporary, and once we ship native editor this needs to be removed.
    setSharedProperty('ds_notebookeditor', 'native');
    const isLocalConnection = isLocalLaunch(serviceManager.get<IConfigurationService>(IConfigurationService));
    setSharedProperty('localOrRemoteConnection', isLocalConnection ? 'local' : 'remote');
    const isPythonExtensionInstalled = serviceManager.get<IPythonExtensionChecker>(IPythonExtensionChecker);
    setSharedProperty(
        'isPythonExtensionInstalled',
        isPythonExtensionInstalled.isPythonExtensionInstalled ? 'true' : 'false'
    );
    const rawService = serviceManager.get<IRawNotebookSupportedService>(IRawNotebookSupportedService);
    setSharedProperty('rawKernelSupported', rawService.isSupported ? 'true' : 'false');

    serviceManager.addSingleton<NotebookIPyWidgetCoordinator>(
        NotebookIPyWidgetCoordinator,
        NotebookIPyWidgetCoordinator
    );
    serviceManager.add<IJupyterCommandFactory>(IJupyterCommandFactory, JupyterCommandFactory);
    serviceManager.add<INotebookExporter>(INotebookExporter, JupyterExporter);
    serviceManager.add<INotebookImporter>(INotebookImporter, JupyterImporter);
    serviceManager.add<INotebookServer>(INotebookServer, HostJupyterServer);
    serviceManager.addSingleton<PreferredRemoteKernelIdProvider>(
        PreferredRemoteKernelIdProvider,
        PreferredRemoteKernelIdProvider
    );
    serviceManager.addSingleton<IRawNotebookProvider>(IRawNotebookProvider, HostRawNotebookProvider);
    serviceManager.addSingleton<IJupyterNotebookProvider>(IJupyterNotebookProvider, JupyterNotebookProvider);
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
    serviceManager.addSingleton<IRemoteKernelFinder>(IRemoteKernelFinder, RemoteKernelFinder);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        CellOutputMimeTypeTracker
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        JupyterInterpreterSelectionCommand
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        PreWarmActivatedJupyterEnvironmentVariables
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        MigrateJupyterInterpreterStateService
    );
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, KernelCommandListener);
    serviceManager.addSingleton<IInteractiveWindowDebugger>(
        IInteractiveWindowDebugger,
        InteractiveWindowDebugger,
        undefined,
        [ICellHashListener]
    );
    serviceManager.addSingleton<IJupyterExecution>(IJupyterExecution, HostJupyterExecution);
    serviceManager.addSingleton<IJupyterPasswordConnect>(IJupyterPasswordConnect, JupyterPasswordConnect);
    serviceManager.addSingleton<IJupyterSessionManagerFactory>(
        IJupyterSessionManagerFactory,
        JupyterSessionManagerFactory
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
    serviceManager.addSingleton<JupyterCommandLineSelector>(JupyterCommandLineSelector, JupyterCommandLineSelector);
    serviceManager.addSingleton<JupyterCommandLineSelectorCommand>(
        JupyterCommandLineSelectorCommand,
        JupyterCommandLineSelectorCommand
    );
    serviceManager.addSingleton<JupyterInterpreterDependencyService>(
        JupyterInterpreterDependencyService,
        JupyterInterpreterDependencyService
    );
    serviceManager.addSingleton<INbConvertInterpreterDependencyChecker>(
        INbConvertInterpreterDependencyChecker,
        NbConvertInterpreterDependencyChecker
    );
    serviceManager.addSingleton<INbConvertExportToPythonService>(
        INbConvertExportToPythonService,
        NbConvertExportToPythonService
    );
    serviceManager.addSingleton<JupyterInterpreterOldCacheStateStore>(
        JupyterInterpreterOldCacheStateStore,
        JupyterInterpreterOldCacheStateStore
    );
    serviceManager.addSingleton<JupyterInterpreterSelector>(JupyterInterpreterSelector, JupyterInterpreterSelector);
    serviceManager.addSingleton<JupyterInterpreterService>(JupyterInterpreterService, JupyterInterpreterService);
    serviceManager.addSingleton<JupyterInterpreterStateStore>(
        JupyterInterpreterStateStore,
        JupyterInterpreterStateStore
    );
    serviceManager.addSingleton<JupyterServerSelector>(JupyterServerSelector, JupyterServerSelector);
    serviceManager.addSingleton<JupyterServerSelectorCommand>(
        JupyterServerSelectorCommand,
        JupyterServerSelectorCommand
    );
    serviceManager.addSingleton<JupyterKernelService>(JupyterKernelService, JupyterKernelService);
    serviceManager.addSingleton<IJupyterServerProvider>(IJupyterServerProvider, NotebookServerProvider);
    serviceManager.addSingleton<IPyWidgetMessageDispatcherFactory>(
        IPyWidgetMessageDispatcherFactory,
        IPyWidgetMessageDispatcherFactory
    );
    serviceManager.addSingleton<IJupyterInterpreterDependencyManager>(
        IJupyterInterpreterDependencyManager,
        JupyterInterpreterSubCommandExecutionService
    );
    serviceManager.addSingleton<IJupyterSubCommandExecutionService>(
        IJupyterSubCommandExecutionService,
        JupyterInterpreterSubCommandExecutionService
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
    serviceManager.addSingleton<IJupyterUriProviderRegistration>(
        IJupyterUriProviderRegistration,
        JupyterUriProviderRegistration
    );
    serviceManager.addSingleton<IJupyterServerUriStorage>(IJupyterServerUriStorage, JupyterServerUriStorage);
    serviceManager.addSingleton<NotebookStarter>(NotebookStarter, NotebookStarter);
    serviceManager.addSingleton<INotebookProvider>(INotebookProvider, NotebookProvider);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, ServerPreload);

    // Subdirectories
    registerInstallerTypes(serviceManager);
}
