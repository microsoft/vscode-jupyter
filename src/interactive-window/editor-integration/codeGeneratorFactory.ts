// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IConfigurationService, IDisposableRegistry } from '../../platform/common/types';
import { CodeGenerator } from './codeGenerator';
import { ICodeGeneratorFactory, IGeneratedCodeStorageFactory, IInteractiveWindowCodeGenerator } from './types';
import { NotebookDocument, workspace } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';

/**
 * The CodeGeneratorFactory creates CodeGenerators for a given notebook document.
 */
@injectable()
export class CodeGeneratorFactory implements ICodeGeneratorFactory, IExtensionSyncActivationService {
    private readonly codeGenerators = new WeakMap<NotebookDocument, IInteractiveWindowCodeGenerator>();

    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IGeneratedCodeStorageFactory) private readonly storageFactory: IGeneratedCodeStorageFactory,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    public activate(): void {
        workspace.onDidCloseNotebookDocument(this.onDidCloseNotebook, this, this.disposables);
    }
    public getOrCreate(notebook: NotebookDocument): IInteractiveWindowCodeGenerator {
        const existing = this.get(notebook);
        if (existing) {
            return existing;
        }
        const codeGenerator = new CodeGenerator(
            this.configService,
            this.storageFactory.getOrCreate(notebook),
            notebook,
            this.disposables
        );
        this.codeGenerators.set(notebook, codeGenerator);
        return codeGenerator;
    }
    public get(notebook: NotebookDocument): IInteractiveWindowCodeGenerator | undefined {
        return this.codeGenerators.get(notebook);
    }
    private onDidCloseNotebook(notebook: NotebookDocument): void {
        this.codeGenerators.get(notebook)?.dispose();
        this.codeGenerators.delete(notebook);
    }
}
