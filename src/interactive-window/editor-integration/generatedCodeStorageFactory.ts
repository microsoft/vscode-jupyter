// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { NotebookDocument, Uri, workspace } from 'vscode';
import { GeneratedCodeStorage } from './generatedCodeStorage';
import { IGeneratedCodeStore, IGeneratedCodeStorageFactory } from './types';

/**
 * Creates GeneratedCodeStorages for a given notebook document.
 */
@injectable()
export class GeneratedCodeStorageFactory implements IGeneratedCodeStorageFactory {
    private readonly storages = new WeakMap<NotebookDocument, IGeneratedCodeStore>();
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
            const notebook = workspace.notebookDocuments.find((nb) => {
                const storage = this.storages.get(nb);
                return storage?.all.find((item) => item.uri.toString() === options.fileUri.toString());
            });
            return notebook ? this.storages.get(notebook) : undefined;
        }
    }
}
