// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { NotebookCellBangInstallDiagnosticsProvider } from './diagnosticsProvider';
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
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        NonPythonKernelCompletionProvider
    );

    serviceManager.addSingleton<NotebookPythonPathService>(NotebookPythonPathService, NotebookPythonPathService);
    serviceManager.addBinding(NotebookPythonPathService, IExtensionSyncActivationService);
}
