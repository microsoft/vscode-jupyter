// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { NotebookContentProvider as VSCNotebookContentProvider } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IServiceManager } from '../../ioc/types';
import { GitHubIssueCodeLensProvider } from '../../logging/gitHubIssueCodeLensProvider';
import { NotebookIPyWidgetCoordinator } from '../ipywidgets/notebookIPyWidgetCoordinator';
import { KernelProvider } from '../jupyter/kernels/kernelProvider';
import { IKernelProvider } from '../jupyter/kernels/types';
import { NotebookContentProvider } from './contentProvider';
import { NotebookCellLanguageService } from './defaultCellLanguageService';
import { EmptyNotebookCellLanguageService } from './emptyNotebookCellLanguageService';
import { NotebookIntegration } from './integration';
import { NotebookCompletionProvider } from './intellisense/completionProvider';
import { IntroduceNativeNotebookStartPage } from './introStartPage';
import { VSCodeKernelPickerProvider } from './kernelProvider';
import { NotebookDisposeService } from './notebookDisposeService';
import { RemoteSwitcher } from './remoteSwitcher';
import { RendererExtensionDownloader } from './rendererExtensionDownloader';
import { INotebookContentProvider, INotebookKernelProvider, INotebookKernelResolver } from './types';

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
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, RemoteSwitcher);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        IntroduceNativeNotebookStartPage
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        EmptyNotebookCellLanguageService
    );
    serviceManager.addSingleton<RendererExtensionDownloader>(RendererExtensionDownloader, RendererExtensionDownloader);
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
    serviceManager.addSingleton<INotebookKernelResolver>(INotebookKernelResolver, NotebookIPyWidgetCoordinator);
    serviceManager.addSingleton<NotebookCellLanguageService>(NotebookCellLanguageService, NotebookCellLanguageService);
    serviceManager.addSingleton<NotebookCompletionProvider>(NotebookCompletionProvider, NotebookCompletionProvider);
}
