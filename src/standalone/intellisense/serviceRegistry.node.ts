// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { NotebookCellBangInstallDiagnosticsProvider } from './diagnosticsProvider';
import { NonPythonKernelCompletionProvider } from './nonPythonKernelCompletionProvider';
import { NotebookPythonPathService } from './notebookPythonPathService.node';

export function registerTypes(serviceManager: IServiceManager) {
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
}
