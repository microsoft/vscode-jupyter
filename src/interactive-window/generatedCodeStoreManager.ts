// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { IKernel, IKernelProvider } from '../kernels/types';
import { IControllerRegistration } from '../notebooks/controllers/types';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { dispose } from '../platform/common/utils/lifecycle';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { ICodeGeneratorFactory, IGeneratedCodeStorageFactory } from './editor-integration/types';
import { IReplNotebookTrackerService } from '../platform/notebooks/replNotebookTrackerService';

/**
 * Responsible for updating the GenerateCodeStorage when kernels reload
 */
@injectable()
export class GeneratedCodeStorageManager implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(ICodeGeneratorFactory) private readonly codeGeneratorFactory: ICodeGeneratorFactory,
        @inject(IGeneratedCodeStorageFactory) private readonly storageFactory: IGeneratedCodeStorageFactory,
        @inject(IControllerRegistration) private readonly controllers: IControllerRegistration,
        @inject(IReplNotebookTrackerService) private readonly replTracker: IReplNotebookTrackerService
    ) {
        disposables.push(this);
    }
    dispose() {
        dispose(this.disposables);
    }
    activate(): void {
        this.kernelProvider.onDidCreateKernel(this.onDidCreateKernel, this, this.disposables);
        this.controllers.onControllerSelected(this.onNotebookControllerSelected, this, this.disposables);
    }
    private onNotebookControllerSelected({ notebook }: { notebook: NotebookDocument }) {
        this.storageFactory.get({ notebook })?.clear();
        this.codeGeneratorFactory.get(notebook)?.reset();
    }
    private onDidCreateKernel(kernel: IKernel) {
        const notebook = kernel.notebook;
        if (kernel.creator !== 'jupyterExtension' || this.replTracker.isForReplEditor(notebook)) {
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
