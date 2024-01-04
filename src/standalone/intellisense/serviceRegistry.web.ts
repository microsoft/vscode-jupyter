// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { NotebookCellBangInstallDiagnosticsProvider } from './diagnosticsProvider';
import { NonPythonKernelCompletionProvider } from './nonPythonKernelCompletionProvider';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        NotebookCellBangInstallDiagnosticsProvider
    );
    serviceManager.addSingleton<NonPythonKernelCompletionProvider>(
        NonPythonKernelCompletionProvider,
        NonPythonKernelCompletionProvider
    );
    serviceManager.addBinding(NonPythonKernelCompletionProvider, IExtensionSyncActivationService);
}
