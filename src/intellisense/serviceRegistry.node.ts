// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { INotebookLanguageClientProvider } from '../notebooks/types';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { NotebookCellLanguageService } from './cellLanguageService';
import { NotebookCellBangInstallDiagnosticsProvider } from './diagnosticsProvider';
import { EmptyNotebookCellLanguageService } from './emptyNotebookCellLanguageService';
import { IntellisenseProvider } from './intellisenseProvider.node';
import { PythonKernelCompletionProvider } from './pythonKernelCompletionProvider.node';
import { PythonKernelCompletionProviderRegistration } from './pythonKernelCompletionProviderRegistration.node';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<PythonKernelCompletionProvider>(
        PythonKernelCompletionProvider,
        PythonKernelCompletionProvider
    ); // Used in tests
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        PythonKernelCompletionProviderRegistration
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        NotebookCellBangInstallDiagnosticsProvider
    );
    serviceManager.addSingleton<NotebookCellLanguageService>(NotebookCellLanguageService, NotebookCellLanguageService);
    serviceManager.addBinding(NotebookCellLanguageService, IExtensionSingleActivationService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        EmptyNotebookCellLanguageService
    );
    serviceManager.addSingleton<INotebookLanguageClientProvider>(INotebookLanguageClientProvider, IntellisenseProvider);
}
