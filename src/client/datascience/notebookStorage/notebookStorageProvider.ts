// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { EventEmitter, Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { IWorkspaceService } from '../../common/application/types';
import { IDisposable, IDisposableRegistry } from '../../common/types';
import { IServiceContainer } from '../../ioc/types';
import { generateNewNotebookUri } from '../common';
import { IModelLoadOptions, INotebookModel, INotebookModelSynchronization, INotebookStorage } from '../types';
import { getNextUntitledCounter } from './nativeEditorStorage';
import { VSCodeNotebookModel } from './vscNotebookModel';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires

export const INotebookStorageProvider = Symbol.for('INotebookStorageProvider');
export interface INotebookStorageProvider extends INotebookStorage {
    createNew(
        options?: { contents?: string; defaultCellLanguage: string },
        forVSCodeNotebook?: boolean
    ): Promise<INotebookModel>;
}
@injectable()
export class NotebookStorageProvider implements INotebookStorageProvider {
    public get onSavedAs() {
        return this._savedAs.event;
    }
    private static untitledCounter = 1;
    private readonly _savedAs = new EventEmitter<{ new: Uri; old: Uri }>();
    private readonly storageAndModels = new Map<string, Promise<INotebookModel>>();
    private readonly resolvedStorageAndModels = new Map<string, INotebookModel>();
    private models = new Set<INotebookModel>();
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(INotebookStorage) private readonly storage: INotebookStorage,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer
    ) {
        disposables.push(this);
    }
    public async save(model: INotebookModel, cancellation: CancellationToken) {
        // When saving, make sure to sync the model first
        await this.syncModel(model);

        // Then actually save the model.
        await this.storage.save(model, cancellation);
    }
    public async saveAs(model: INotebookModel, targetResource: Uri) {
        // When saving, make sure to sync the model first
        await this.syncModel(model);

        const oldUri = model.file;
        await this.storage.saveAs(model, targetResource);
        if (model instanceof VSCodeNotebookModel) {
            return;
        }
        this.trackModel(model);
        this.storageAndModels.delete(oldUri.toString());
        this.storageAndModels.set(targetResource.toString(), Promise.resolve(model));
    }
    public generateBackupId(model: INotebookModel): string {
        return this.storage.generateBackupId(model);
    }
    public backup(model: INotebookModel, cancellation: CancellationToken, backupId?: string) {
        return this.storage.backup(model, cancellation, backupId);
    }
    public revert(model: INotebookModel, cancellation: CancellationToken) {
        return this.storage.revert(model, cancellation);
    }
    public deleteBackup(model: INotebookModel, backupId?: string) {
        return this.storage.deleteBackup(model, backupId);
    }
    public get(file: Uri): INotebookModel | undefined {
        return this.resolvedStorageAndModels.get(file.toString());
    }

    public getOrCreateModel(options: IModelLoadOptions): Promise<INotebookModel> {
        const key = options.file.toString();
        if (!this.storageAndModels.has(key)) {
            // Every time we load a new untitled file, up the counter past the max value for this counter
            NotebookStorageProvider.untitledCounter = getNextUntitledCounter(
                options.file,
                NotebookStorageProvider.untitledCounter
            );
            const promise = this.storage.getOrCreateModel(options);
            this.storageAndModels.set(key, promise.then(this.trackModel.bind(this)));
        }
        return this.storageAndModels.get(key)!;
    }
    public dispose() {
        while (this.disposables.length) {
            this.disposables.shift()?.dispose(); // NOSONAR
        }
    }

    public async createNew(
        options?: { contents?: string; defaultCellLanguage: string },
        forVSCodeNotebooks?: boolean
    ): Promise<INotebookModel> {
        // Create a new URI for the dummy file using our root workspace path
        const uri = this.getNextNewNotebookUri(forVSCodeNotebooks);

        // Always skip loading from the hot exit file. When creating a new file we want a new file.
        return this.getOrCreateModel({
            file: uri,
            possibleContents: options?.contents,
            defaultCellLanguage: options?.defaultCellLanguage,
            skipLoadingDirtyContents: true,
            isNative: forVSCodeNotebooks
        });
    }

    private getNextNewNotebookUri(forVSCodeNotebooks?: boolean): Uri {
        return generateNewNotebookUri(
            NotebookStorageProvider.untitledCounter,
            this.workspace.rootPath,
            forVSCodeNotebooks
        );
    }

    private trackModel(model: INotebookModel): INotebookModel {
        this.disposables.push(model);
        this.models.add(model);
        this.resolvedStorageAndModels.set(model.file.toString(), model);
        // When a model is no longer used, ensure we remove it from the cache.
        model.onDidDispose(
            () => {
                this.models.delete(model);
                this.storageAndModels.delete(model.file.toString());
                this.resolvedStorageAndModels.delete(model.file.toString());
            },
            this,
            this.disposables
        );
        return model;
    }

    private async syncModel(model: INotebookModel): Promise<void> {
        // Because the sync stuff is circular, don't ask for it until needed (it depends upon something that depends upon storage)
        const modelSync = this.serviceContainer.tryGet<INotebookModelSynchronization>(INotebookModelSynchronization);
        if (modelSync) {
            // When saving, we should make sure to sync the model with the UI (edits seem to be being droppped randomly in hard to repro situations)
            return modelSync.syncAllCells(model);
        }
    }
}
