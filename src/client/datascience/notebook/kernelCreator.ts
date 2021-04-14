// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { NotebookKernelOptions } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../../common/constants';
import { traceInfo } from '../../common/logger';
import { IConfigurationService } from '../../common/types';
import { isLocalLaunch } from '../jupyter/kernels/helpers';

// This class is responsible at activation for registering all the kernels that we
// provide for native notebooks
@injectable()
export class KernelCreator implements IExtensionSingleActivationService {
    private isLocalLaunch: boolean;
    constructor(
        @inject(UseVSCodeNotebookEditorApi) private readonly useNativeNb: boolean,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook
    ) {
        this.isLocalLaunch = isLocalLaunch(this.configuration);
    }
    public async activate(): Promise<void> {
        if (this.useNativeNb) {
            const notebookKernelOptions = await this.getNotebookKernelOptions();
            await this.createNotebookKernels(notebookKernelOptions);
        }
    }

    // Get our list of NotebookKernelOptions that we need to use to create kernels
    private async getNotebookKernelOptions(): Promise<NotebookKernelOptions[]> {
        return [
            {
                id: 'testid',
                label: 'testlabel',
                selector: { viewType: 'jupyter-notebook' },
                executeHandler: (executions) => {
                    for (let exec of executions) {
                        traceInfo(exec.document.uri.toString());
                    }
                }
            },
            {
                id: 'testid2',
                label: 'testlabel2',
                selector: { viewType: 'jupyter-notebook' },
                executeHandler: (executions) => {
                    for (let exec of executions) {
                        traceInfo(exec.document.uri.toString());
                    }
                }
            }
        ];
    }

    private async createNotebookKernels(notebookKernelOptions: NotebookKernelOptions[]) {
        const kernels = notebookKernelOptions.map(this.notebook.createNotebookKernel);
        kernels.forEach((kernel) => {
            traceInfo(kernel.label);
        });
    }
}
