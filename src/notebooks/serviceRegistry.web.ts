// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { KernelFilterService } from './controllers/kernelFilter/kernelFilterService';
import { KernelFilterUI } from './controllers/kernelFilter/kernelFilterUI';
import { LiveKernelSwitcher } from './controllers/liveKernelSwitcher';
import { RemoteSwitcher } from './controllers/remoteSwitcher';
import { INotebookEditorProvider } from './types';
import { NotebookUsageTracker } from './notebookUsageTracker';
import { NotebookEditorProvider } from './notebookEditorProvider';
import { RemoteKernelControllerWatcher } from './controllers/remoteKernelControllerWatcher';
import { ITracebackFormatter } from '../kernels/types';
import { NotebookTracebackFormatter } from './outputs/tracebackFormatter';
import { NotebookIPyWidgetCoordinator } from './controllers/notebookIPyWidgetCoordinator';
import { RemoteKernelConnectionHandler } from './controllers/remoteKernelConnectionHandler';
import { JupyterServerSelectorCommand } from './serverSelector';
import { IDataScienceCommandListener } from '../platform/common/types';
import { NotebookCommandListener } from './notebookCommandListener';
import { InterpreterPackageTracker } from './telemetry/interpreterPackageTracker';
import { NotebookCellLanguageService } from './languages/cellLanguageService';
import { EmptyNotebookCellLanguageService } from './languages/emptyNotebookCellLanguageService';
import {
    IDebuggingManager,
    IDebugLocationTracker,
    IDebugLocationTrackerFactory,
    IJupyterDebugService
} from './debugger/debuggingTypes';
import { DebuggingManager } from './debugger/debuggingManager';
import { ErrorRendererCommunicationHandler } from './outputs/errorRendererComms';
import { ExportDialog } from './export/exportDialog';
import { ExportFormat, IExport, IExportBase, IExportDialog, IFileConverter, INbConvertExport } from './export/types';
import { FileConverter } from './export/fileConverter';
import { ExportFileOpener } from './export/exportFileOpener';
import { ExportToPythonPlain } from './export/exportToPythonPlain';
import { ExportBase } from './export/exportBase.web';
import { ExportUtilBase } from './export/exportUtil';
import { ExportToHTML } from './export/exportToHTML';
import { ExportToPDF } from './export/exportToPDF';
import { ExportToPython } from './export/exportToPython';
import { registerTypes as registerControllerTypes } from './controllers/serviceRegistry.web';
import { ServerConnectionControllerCommands } from './controllers/commands/serverConnectionControllerCommands';
import { MultiplexingDebugService } from './debugger/multiplexingDebugService';
import { Identifiers } from '../platform/common/constants';
import { DebugLocationTrackerFactory } from './debugger/debugLocationTrackerFactory';
import { IJupyterVariables } from '../kernels/variables/types';
import { DebuggerVariables } from './debugger/debuggerVariables';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    registerControllerTypes(serviceManager, isDevMode);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, RemoteSwitcher);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelFilterUI);

    serviceManager.addSingleton<KernelFilterService>(KernelFilterService, KernelFilterService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        LiveKernelSwitcher
    );
    serviceManager.addSingleton<INotebookEditorProvider>(INotebookEditorProvider, NotebookEditorProvider);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookUsageTracker
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RemoteKernelControllerWatcher
    );
    serviceManager.addSingleton<ITracebackFormatter>(ITracebackFormatter, NotebookTracebackFormatter);
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
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, NotebookCommandListener);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        InterpreterPackageTracker
    );
    serviceManager.addSingleton<NotebookCellLanguageService>(NotebookCellLanguageService, NotebookCellLanguageService);
    serviceManager.addBinding(NotebookCellLanguageService, IExtensionSingleActivationService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        EmptyNotebookCellLanguageService
    );

    serviceManager.addSingleton<IDebuggingManager>(IDebuggingManager, DebuggingManager, undefined, [
        IExtensionSingleActivationService
    ]);
    serviceManager.addSingleton<IJupyterDebugService>(
        IJupyterDebugService,
        MultiplexingDebugService,
        Identifiers.MULTIPLEXING_DEBUGSERVICE
    );
    serviceManager.addSingleton<IDebugLocationTracker>(IDebugLocationTracker, DebugLocationTrackerFactory, undefined, [
        IDebugLocationTrackerFactory
    ]);
    serviceManager.addSingleton<IJupyterVariables>(
        IJupyterVariables,
        DebuggerVariables,
        Identifiers.DEBUGGER_VARIABLES
    );

    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ErrorRendererCommunicationHandler
    );

    serviceManager.addSingleton<ExportFileOpener>(ExportFileOpener, ExportFileOpener);
    serviceManager.addSingleton<IExportBase>(IExportBase, ExportBase);
    serviceManager.addSingleton<IExportDialog>(IExportDialog, ExportDialog);
    serviceManager.addSingleton<IFileConverter>(IFileConverter, FileConverter);
    serviceManager.addSingleton<IExport>(IExport, ExportToPythonPlain, ExportFormat.python);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToHTML, ExportFormat.html);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPDF, ExportFormat.pdf);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPython, ExportFormat.python);
    serviceManager.addSingleton<ExportUtilBase>(ExportUtilBase, ExportUtilBase);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        ServerConnectionControllerCommands
    );
}
