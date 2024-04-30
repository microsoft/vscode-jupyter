// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ITracebackFormatter } from '../kernels/types';
import { IJupyterVariables } from '../kernels/variables/types';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { Identifiers } from '../platform/common/constants';
import { IDataScienceCommandListener } from '../platform/common/types';
import { IServiceManager } from '../platform/ioc/types';
import { LiveKernelSwitcher } from './controllers/liveKernelSwitcher';
import { NotebookIPyWidgetCoordinator } from './controllers/notebookIPyWidgetCoordinator';
import { RemoteKernelConnectionHandler } from './controllers/remoteKernelConnectionHandler';
import { RemoteKernelControllerWatcher } from './controllers/remoteKernelControllerWatcher';
import { registerTypes as registerControllerTypes } from './controllers/serviceRegistry.web';
import { CommandRegistry } from './debugger/commandRegistry';
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
import { MultiplexingDebugService } from './debugger/multiplexingDebugService';
import { ExportBase } from './export/exportBase.web';
import { ExportUtil } from './export/exportUtil.web';
import { FileConverter } from './export/fileConverter.web';
import { IExportBase, IExportUtil, IFileConverter } from './export/types';
import { NotebookCellLanguageService } from './languages/cellLanguageService';
import { EmptyNotebookCellLanguageService } from './languages/emptyNotebookCellLanguageService';
import { NotebookCommandListener } from './notebookCommandListener';
import { NotebookEditorProvider } from './notebookEditorProvider';
import { CellOutputMimeTypeTracker } from './outputs/jupyterCellOutputMimeTypeTracker';
import { NotebookTracebackFormatter } from './outputs/tracebackFormatter';
import { INotebookEditorProvider } from './types';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    registerControllerTypes(serviceManager, isDevMode);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, LiveKernelSwitcher);
    serviceManager.addSingleton<INotebookEditorProvider>(INotebookEditorProvider, NotebookEditorProvider);
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
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, NotebookCommandListener);
    serviceManager.addSingleton<NotebookCellLanguageService>(NotebookCellLanguageService, NotebookCellLanguageService);
    serviceManager.addBinding(NotebookCellLanguageService, IExtensionSyncActivationService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        EmptyNotebookCellLanguageService
    );

    serviceManager.addSingleton<IDebuggingManager>(INotebookDebuggingManager, DebuggingManager, undefined, [
        IExtensionSyncActivationService
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
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, CommandRegistry);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        CellOutputMimeTypeTracker
    );

    serviceManager.addSingleton<IExportBase>(IExportBase, ExportBase);
    serviceManager.addSingleton<IFileConverter>(IFileConverter, FileConverter);
    serviceManager.addSingleton<IExportUtil>(IExportUtil, ExportUtil);
}
