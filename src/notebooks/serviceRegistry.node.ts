// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { KernelFilterService } from './controllers/kernelFilter/kernelFilterService';
import { KernelFilterUI } from './controllers/kernelFilter/kernelFilterUI';
import { LiveKernelSwitcher } from './controllers/liveKernelSwitcher';
import { RemoteSwitcher } from './controllers/remoteSwitcher';
import { NotebookCommandListener } from './notebookCommandListener';
import { NotebookEditorProvider } from './notebookEditorProvider';
import { ErrorRendererCommunicationHandler } from './outputs/errorRendererComms';
import { INotebookCompletionProvider, INotebookEditorProvider } from './types';
import { NotebookUsageTracker } from './notebookUsageTracker';
import { IDataScienceCommandListener } from '../platform/common/types';
import { CondaControllerRefresher } from './controllers/condaControllerRefresher.node';
import { RemoteKernelControllerWatcher } from './controllers/remoteKernelControllerWatcher';
import { ITracebackFormatter } from '../kernels/types';
import { NotebookTracebackFormatter } from './outputs/tracebackFormatter';
import {
    IDebuggingManager,
    IDebugLocationTracker,
    IDebugLocationTrackerFactory,
    IJupyterDebugService
} from './debugger/debuggingTypes';
import { Identifiers } from '../platform/common/constants';
import { JupyterDebugService } from './debugger/jupyterDebugService.node';
import { NotebookIPyWidgetCoordinator } from './controllers/notebookIPyWidgetCoordinator';
import { RemoteKernelConnectionHandler } from './controllers/remoteKernelConnectionHandler';
import { JupyterServerSelectorCommand } from './serverSelector';
import { InterpreterPackageTracker } from './telemetry/interpreterPackageTracker';
import { InstallPythonControllerCommands } from './controllers/commands/installPythonControllerCommands';
import { NotebookCellLanguageService } from './languages/cellLanguageService';
import { EmptyNotebookCellLanguageService } from './languages/emptyNotebookCellLanguageService';
import { DebuggingManager } from './debugger/debuggingManager';
import { ExportBase } from './export/exportBase.node';
import { ExportDialog } from './export/exportDialog';
import { ExportFileOpener } from './export/exportFileOpener';
import { ExportInterpreterFinder } from './export/exportInterpreterFinder.node';
import { ExportToHTML } from './export/exportToHTML';
import { ExportToPDF } from './export/exportToPDF';
import { ExportToPython } from './export/exportToPython';
import { ExportToPythonPlain } from './export/exportToPythonPlain';
import { ExportUtil } from './export/exportUtil.node';
import { FileConverter } from './export/fileConverter.node';
import { IFileConverter, INbConvertExport, ExportFormat, IExport, IExportDialog, IExportBase } from './export/types';
import { ExportUtilBase } from './export/exportUtil';
import { registerTypes as registerControllerTypes } from './controllers/serviceRegistry.node';
import { ServerConnectionControllerCommands } from './controllers/commands/serverConnectionControllerCommands';
import { DebuggerVariableRegistration } from './debugger/debuggerVariableRegistration.node';
import { IJupyterVariables } from '../kernels/variables/types';
import { DebuggerVariables } from './debugger/debuggerVariables';
import { MultiplexingDebugService } from './debugger/multiplexingDebugService';
import { DebugLocationTrackerFactory } from './debugger/debugLocationTrackerFactory';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    registerControllerTypes(serviceManager, isDevMode);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, RemoteSwitcher);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelFilterUI);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        CondaControllerRefresher
    );

    serviceManager.addSingleton<KernelFilterService>(KernelFilterService, KernelFilterService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        LiveKernelSwitcher
    );
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, NotebookCommandListener);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ErrorRendererCommunicationHandler
    );
    serviceManager.addSingleton<INotebookEditorProvider>(INotebookEditorProvider, NotebookEditorProvider);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookUsageTracker
    );
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
        JupyterServerSelectorCommand
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        InterpreterPackageTracker
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        InstallPythonControllerCommands
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        ServerConnectionControllerCommands
    );

    serviceManager.addSingleton<NotebookCellLanguageService>(NotebookCellLanguageService, NotebookCellLanguageService);
    serviceManager.addBinding(NotebookCellLanguageService, IExtensionSingleActivationService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        EmptyNotebookCellLanguageService
    );

    // Debugging
    serviceManager.addSingleton<IDebuggingManager>(IDebuggingManager, DebuggingManager, undefined, [
        IExtensionSingleActivationService
    ]);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
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

    // File export/import
    serviceManager.addSingleton<IFileConverter>(IFileConverter, FileConverter);
    serviceManager.addSingleton<ExportInterpreterFinder>(ExportInterpreterFinder, ExportInterpreterFinder);
    serviceManager.addSingleton<ExportFileOpener>(ExportFileOpener, ExportFileOpener);

    serviceManager.addSingleton<IExportBase>(IExportBase, ExportBase);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPDF, ExportFormat.pdf);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToHTML, ExportFormat.html);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPython, ExportFormat.python);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportBase, 'Export Base');
    serviceManager.addSingleton<IExport>(IExport, ExportToPythonPlain, ExportFormat.python);
    serviceManager.addSingleton<ExportUtilBase>(ExportUtilBase, ExportUtilBase);
    serviceManager.addSingleton<ExportUtil>(ExportUtil, ExportUtil);
    serviceManager.addSingleton<IExportDialog>(IExportDialog, ExportDialog);
}
