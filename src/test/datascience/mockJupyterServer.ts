// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { NotebookDocument, Uri } from 'vscode';
import { INotebookServer } from '../../kernels/jupyter/types';
import { IJupyterConnection, INotebook } from '../../kernels/types';
import { TemporaryFile } from '../../platform/common/platform/types';
import { MockJupyterNotebook } from './mockJupyterNotebook';

export class MockJupyterServer implements INotebookServer {
    constructor(public connection: IJupyterConnection) {}
    private notebookFile: TemporaryFile | undefined;

    public async createNotebook(_resource: Uri): Promise<INotebook> {
        return new MockJupyterNotebook(this.connection);
    }

    public async getNotebook(_document: NotebookDocument): Promise<INotebook | undefined> {
        return new MockJupyterNotebook(this.connection);
    }
    public async dispose(): Promise<void> {
        if (this.connection) {
            this.connection.dispose(); // This should kill the process that's running
        }
        if (this.notebookFile) {
            this.notebookFile.dispose(); // This destroy any unwanted kernel specs if necessary
            this.notebookFile = undefined;
        }
    }
}
