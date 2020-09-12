// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService } from '../../activation/types';
import { IServiceManager } from '../../ioc/types';
import { KernelProvider } from '../jupyter/kernels/kernelProvider';
import { IKernelProvider } from '../jupyter/kernels/types';
import { NotebookContentProvider } from './contentProvider';
import { NotebookIntegration } from './integration';
import { VSCodeKernelPickerProvider } from './kernelProvider';
import { NotebookDisposeService } from './notebookDisposeService';
import { NotebookSurveyBanner, NotebookSurveyDataLogger } from './survey';
import { INotebookContentProvider } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<INotebookContentProvider>(INotebookContentProvider, NotebookContentProvider);
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
    serviceManager.addSingleton<NotebookSurveyBanner>(NotebookSurveyBanner, NotebookSurveyBanner);
    serviceManager.addSingleton<VSCodeKernelPickerProvider>(VSCodeKernelPickerProvider, VSCodeKernelPickerProvider);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookSurveyDataLogger
    );
}
