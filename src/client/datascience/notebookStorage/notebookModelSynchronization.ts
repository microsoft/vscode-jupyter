// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';

import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { INotebookEditor, INotebookEditorProvider, INotebookModel, INotebookModelSynchronization } from '../types';

@injectable()
export class NotebookModelSynchronization implements INotebookModelSynchronization {
    constructor(
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}
    public async syncAllCells(model: INotebookModel): Promise<void> {
        // Find the owner of this model and ask it to do the sync (this is inherently a UI operation as we need to pull the data from the UI)
        const owner = this.getOwner(model);
        if (owner) {
            return owner.syncAllCells();
        } else {
            traceError(`Sync all not possible for ${model.file.toString()}`);
        }
    }

    private getOwner(model: INotebookModel): INotebookEditor | undefined {
        return this.notebookEditorProvider.editors.find((e) => this.fs.arePathsSame(e.model.file, model.file));
    }
}
