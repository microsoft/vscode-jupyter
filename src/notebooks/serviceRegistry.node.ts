// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ITracebackFormatter } from '../kernels/types';
import { IJupyterVariables } from '../kernels/variables/types';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { Identifiers } from '../platform/common/constants';
import { IDataScienceCommandListener } from '../platform/common/types';
import { IServiceManager } from '../platform/ioc/types';
import { InstallPythonControllerCommands } from './controllers/commands/installPythonControllerCommands';
import { LiveKernelSwitcher } from './controllers/liveKernelSwitcher';
import { NotebookIPyWidgetCoordinator } from './controllers/notebookIPyWidgetCoordinator';
import { RemoteKernelConnectionHandler } from './controllers/remoteKernelConnectionHandler';
import { RemoteKernelControllerWatcher } from './controllers/remoteKernelControllerWatcher';
import { registerTypes as registerControllerTypes } from './controllers/serviceRegistry.node';
import { CommandRegistry } from './debugger/commandRegistry';
import { DebuggerVariableRegistration } from './debugger/debuggerVariableRegistration.node';
import { DebuggerVariables } from './debugger/debuggerVariables';
import { DebuggingManager } from './debugger/debuggingManager';
import {
    IDebuggingManager,
    IDebugLocationTracker,
    IDebugLocationTrackerFactory,
    IJupyterDebugService,
    INotebookDebuggingManager
} from './debugger/debuggingTypes';
import { DebugLocationTrackerFactory } from './debugger/debugLocationTrackerFactory';
import { JupyterDebugService } from './debugger/jupyterDebugService.node';
import { MultiplexingDebugService } from './debugger/multiplexingDebugService';
import { ExportBase } from './export/exportBase.node';
import { ExportInterpreterFinder } from './export/exportInterpreterFinder.node';
import { ExportUtil } from './export/exportUtil.node';
import { FileConverter } from './export/fileConverter.node';
import { IExportBase, IExportUtil, IFileConverter } from './export/types';
import { KernelStartupCodeProvider } from './kernelStartupCodeProvider.node';
import { NotebookCellLanguageService } from './languages/cellLanguageService';
import { EmptyNotebookCellLanguageService } from './languages/emptyNotebookCellLanguageService';
import { NotebookCommandListener } from './notebookCommandListener';
import { NotebookEditorProvider } from './notebookEditorProvider';
import { CellOutputMimeTypeTracker } from './outputs/jupyterCellOutputMimeTypeTracker';
import { NotebookTracebackFormatter } from './outputs/tracebackFormatter';
import { InterpreterPackageTracker } from './telemetry/interpreterPackageTracker.node';
import { INotebookCompletionProvider, INotebookEditorProvider } from './types';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    registerControllerTypes(serviceManager, isDevMode);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, LiveKernelSwitcher);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, NotebookCommandListener);
    serviceManager.addSingleton<INotebookEditorProvider>(INotebookEditorProvider, NotebookEditorProvider);
    serviceManager.addBinding(INotebookCompletionProvider, IExtensionSyncActivationService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RemoteKernelControllerWatcher
    );
    serviceManager.addSingleton<ITracebackFormatter>(ITracebackFormatter, NotebookTracebackFormatter);
    serviceManager.addSingleton<IJupyterDebugService>(
        IJupyterDebugService,
        JupyterDebugService,
        Identifiers.RUN_BY_LINE_DEBUGSERVICE
    );
    serviceManager.addSingleton<NotebookIPyWidgetCoordinator>(
        NotebookIPyWidgetCoordinator,
        NotebookIPyWidgetCoordinator
    );
    serviceManager.addBinding(NotebookIPyWidgetCoordinator, IExtensionSyncActivationService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RemoteKernelConnectionHandler
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        InterpreterPackageTracker
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        InstallPythonControllerCommands
    );

    serviceManager.addSingleton<NotebookCellLanguageService>(NotebookCellLanguageService, NotebookCellLanguageService);
    serviceManager.addBinding(NotebookCellLanguageService, IExtensionSyncActivationService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        EmptyNotebookCellLanguageService
    );

    // Debugging
    serviceManager.addSingleton<IDebuggingManager>(INotebookDebuggingManager, DebuggingManager, undefined, [
        IExtensionSyncActivationService
    ]);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        DebuggerVariableRegistration
    );
    serviceManager.addSingleton<IJupyterVariables>(
        IJupyterVariables,
        DebuggerVariables,
        Identifiers.DEBUGGER_VARIABLES
    );
    serviceManager.addSingleton<IJupyterDebugService>(
        IJupyterDebugService,
        MultiplexingDebugService,
        Identifiers.MULTIPLEXING_DEBUGSERVICE
    );
    serviceManager.addSingleton<IDebugLocationTracker>(IDebugLocationTracker, DebugLocationTrackerFactory, undefined, [
        IDebugLocationTrackerFactory
    ]);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, CommandRegistry);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        CellOutputMimeTypeTracker
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelStartupCodeProvider
    );

    // File export/import
    serviceManager.addSingleton<IFileConverter>(IFileConverter, FileConverter);
    serviceManager.addSingleton<ExportInterpreterFinder>(ExportInterpreterFinder, ExportInterpreterFinder);

    serviceManager.addSingleton<IExportBase>(IExportBase, ExportBase);
    serviceManager.addSingleton<IExportUtil>(IExportUtil, ExportUtil);
}
