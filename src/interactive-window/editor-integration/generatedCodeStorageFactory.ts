// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookDocument, Uri } from 'vscode';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { GeneratedCodeStorage } from './generatedCodeStorage';
import { IGeneratedCodeStore, IGeneratedCodeStorageFactory } from './types';

/**
 * Creates GeneratedCodeStorages for a given notebook document.
 */
@injectable()
export class GeneratedCodeStorageFactory implements IGeneratedCodeStorageFactory {
    private readonly storages = new WeakMap<NotebookDocument, IGeneratedCodeStore>();
    constructor(@inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook) {}
    getOrCreate(notebook: NotebookDocument): IGeneratedCodeStore {
        if (!this.storages.has(notebook)) {
            this.storages.set(notebook, new GeneratedCodeStorage());
        }
        return this.storages.get(notebook)!;
    }
    get(options: { notebook: NotebookDocument } | { fileUri: Uri }): IGeneratedCodeStore | undefined {
        if ('notebook' in options) {
            return this.storages.get(options.notebook)!;
        } else {
            const notebook = this.notebook.notebookDocuments.find((nb) => {
                const storage = this.storages.get(nb);
                return storage?.all.find((item) => item.uri.toString() === options.fileUri.toString());
            });
            return notebook ? this.storages.get(notebook) : undefined;
        }
    }
}
