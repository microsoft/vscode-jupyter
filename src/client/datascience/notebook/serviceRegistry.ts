// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { NotebookContentProvider as VSCNotebookContentProvider } from '../../../../types/vscode-proposed';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IServiceManager } from '../../ioc/types';
import { GitHubIssueCodeLensProvider } from '../../logging/gitHubIssueCodeLensProvider';
import { NotebookIPyWidgetCoordinator } from '../ipywidgets/notebookIPyWidgetCoordinator';
import { KernelProvider } from '../jupyter/kernels/kernelProvider';
import { IKernelProvider } from '../jupyter/kernels/types';
import { NotebookContentProvider } from './contentProvider';
import { NotebookCellLanguageService } from './defaultCellLanguageService';
import { NotebookIntegration } from './integration';
import { VSCodeKernelPickerProvider } from './kernelProvider';
import { NotebookDisposeService } from './notebookDisposeService';
import { INotebookContentProvider, INotebookKernelProvider } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<VSCNotebookContentProvider>(INotebookContentProvider, NotebookContentProvider);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookIntegration
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookDisposeService
    );
    serviceManager.addSingleton<NotebookIntegration>(NotebookIntegration, NotebookIntegration);
    serviceManager.addSingleton<IKernelProvider>(IKernelProvider, KernelProvider);
    serviceManager.addSingleton<INotebookKernelProvider>(INotebookKernelProvider, VSCodeKernelPickerProvider);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        GitHubIssueCodeLensProvider
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookCellLanguageService
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookIPyWidgetCoordinator
    );
    serviceManager.addSingleton<NotebookCellLanguageService>(NotebookCellLanguageService, NotebookCellLanguageService);
}
