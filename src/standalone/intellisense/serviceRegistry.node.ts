// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { INotebookCompletionProvider } from '../../notebooks/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { NotebookCellBangInstallDiagnosticsProvider } from './diagnosticsProvider';
import { IntellisenseProvider } from './intellisenseProvider.node';
import { LogReplayService } from './logReplayService.node';
import { NonPythonKernelCompletionProvider } from './nonPythonKernelCompletionProvider';
import { NotebookPythonPathService } from './notebookPythonPathService.node';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    if (isDevMode) {
        serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, LogReplayService);
    }

    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        NotebookCellBangInstallDiagnosticsProvider
    );
    serviceManager.addSingleton<NonPythonKernelCompletionProvider>(
        NonPythonKernelCompletionProvider,
        NonPythonKernelCompletionProvider
    );
    serviceManager.addBinding(NonPythonKernelCompletionProvider, IExtensionSyncActivationService);

    serviceManager.addSingleton<NotebookPythonPathService>(NotebookPythonPathService, NotebookPythonPathService);
    serviceManager.addBinding(NotebookPythonPathService, IExtensionSyncActivationService);
    serviceManager.addSingleton<INotebookCompletionProvider>(INotebookCompletionProvider, IntellisenseProvider);
}
