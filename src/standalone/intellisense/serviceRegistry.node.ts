// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { INotebookCompletionProvider } from '../../notebooks/types';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { NotebookCellBangInstallDiagnosticsProvider } from './diagnosticsProvider';
import { IntellisenseProvider } from './intellisenseProvider.node';
import { LogReplayService } from './logReplayService.node';
import { NotebookPythonPathService } from './notebookPythonPathService.node';
import { PythonKernelCompletionProvider } from './pythonKernelCompletionProvider';
import { PythonKernelCompletionProviderRegistration } from './pythonKernelCompletionProviderRegistration';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    if (isDevMode) {
        serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, LogReplayService);
    }

    serviceManager.addSingleton<PythonKernelCompletionProvider>(
        PythonKernelCompletionProvider,
        PythonKernelCompletionProvider
    ); // Used in tests
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        PythonKernelCompletionProviderRegistration
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        NotebookCellBangInstallDiagnosticsProvider
    );

    serviceManager.addSingleton<NotebookPythonPathService>(NotebookPythonPathService, NotebookPythonPathService);
    serviceManager.addBinding(NotebookPythonPathService, IExtensionSingleActivationService);
    serviceManager.addSingleton<INotebookCompletionProvider>(INotebookCompletionProvider, IntellisenseProvider);
}
