// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { NotebookCellBangInstallDiagnosticsProvider } from './diagnosticsProvider';
import { KernelCompletionProvider } from './kernelCompletionProvider';
import { NotebookPythonPathService } from './notebookPythonPathService.node';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        NotebookCellBangInstallDiagnosticsProvider
    );
    serviceManager.addSingleton<KernelCompletionProvider>(KernelCompletionProvider, KernelCompletionProvider);
    serviceManager.addBinding(KernelCompletionProvider, IExtensionSyncActivationService);

    serviceManager.addSingleton<NotebookPythonPathService>(NotebookPythonPathService, NotebookPythonPathService);
    serviceManager.addBinding(NotebookPythonPathService, IExtensionSyncActivationService);
}
