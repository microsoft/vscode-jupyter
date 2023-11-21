// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { NotebookCellBangInstallDiagnosticsProvider } from './diagnosticsProvider';
import { NonPythonKernelCompletionProvider } from './nonPythonKernelCompletionProvider';
import { PythonKernelCompletionProvider } from './pythonKernelCompletionProvider';
import { PythonKernelCompletionProviderRegistration } from './pythonKernelCompletionProviderRegistration';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        NotebookCellBangInstallDiagnosticsProvider
    );
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
        NonPythonKernelCompletionProvider
    );
}
