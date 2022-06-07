// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { getAssociatedNotebookDocument } from '../kernels/helpers';
import { IKernel, IKernelProvider } from '../kernels/types';
import { InteractiveWindowView } from '../notebooks/constants';
import { INotebookControllerManager } from '../notebooks/types';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { ICodeGeneratorFactory, IGeneratedCodeStorageFactory } from './editor-integration/types';

@injectable()
export class GeneratedCodeStorageManager implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(ICodeGeneratorFactory) private readonly codeGeneratorFactory: ICodeGeneratorFactory,
        @inject(IGeneratedCodeStorageFactory) private readonly storageFactory: IGeneratedCodeStorageFactory,
        @inject(INotebookControllerManager) private readonly controllers: INotebookControllerManager
    ) {
        disposables.push(this);
    }
    dispose() {
        disposeAllDisposables(this.disposables);
    }
    activate(): void {
        this.kernelProvider.onDidCreateKernel(this.onDidCreateKernel, this, this.disposables);
        this.controllers.onNotebookControllerSelected(this.onNotebookControllerSelected, this, this.disposables);
    }
    private onNotebookControllerSelected({ notebook }: { notebook: NotebookDocument }) {
        this.storageFactory.get({ notebook })?.clear();
        this.codeGeneratorFactory.get(notebook)?.reset();
    }
    private onDidCreateKernel(kernel: IKernel) {
        const notebook = getAssociatedNotebookDocument(kernel);
        if (kernel.creator !== 'jupyterExtension' || notebook?.notebookType !== InteractiveWindowView) {
            return;
        }
        // Possible we changed kernels for the same document.
        this.storageFactory.get({ notebook })?.clear();

        kernel.onRestarted(
            () => {
                this.storageFactory.get({ notebook })?.clear();
                this.codeGeneratorFactory.getOrCreate(notebook).reset();
            },
            this,
            this.disposables
        );
    }
}
