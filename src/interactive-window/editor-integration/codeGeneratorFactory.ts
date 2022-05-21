// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IDocumentManager } from '../../platform/common/application/types';
import { IConfigurationService } from '../../platform/common/types';
import { CodeGenerator } from './codeGenerator';
import { IGeneratedCodeStorageFactory, IInteractiveWindowCodeGenerator } from './types';
import { NotebookDocument } from 'vscode';

@injectable()
export class CodeGeneratorFactory {
    private readonly cellHashProvidersIndexedByNotebooks = new WeakMap<
        NotebookDocument,
        IInteractiveWindowCodeGenerator
    >();

    constructor(
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IGeneratedCodeStorageFactory) private readonly storageFactory: IGeneratedCodeStorageFactory
    ) {}
    public getOrCreate(notebook: NotebookDocument): IInteractiveWindowCodeGenerator {
        const existing = this.get(notebook);
        if (existing) {
            return existing;
        }
        const cellHashProvider = new CodeGenerator(
            this.documentManager,
            this.configService,
            this.storageFactory.getOrCreate(notebook),
            notebook
        );
        this.cellHashProvidersIndexedByNotebooks.set(notebook, cellHashProvider);
        return cellHashProvider;
    }
    public get(notebook: NotebookDocument): IInteractiveWindowCodeGenerator | undefined {
        return this.cellHashProvidersIndexedByNotebooks.get(notebook);
    }
}
