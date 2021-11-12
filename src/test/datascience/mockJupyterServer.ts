// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { NotebookDocument, Uri } from 'vscode';
import { TemporaryFile } from '../../client/common/platform/types';
import { IJupyterConnection, INotebook, INotebookServer } from '../../client/datascience/types';
import { MockJupyterNotebook } from './mockJupyterNotebook';

export class MockJupyterServer implements INotebookServer {
    private connection: IJupyterConnection | undefined;
    private notebookFile: TemporaryFile | undefined;
    public async connect(connection: IJupyterConnection): Promise<void> {
        this.connection = connection;

        // Validate connection info and kernel spec
        if (!connection.baseUrl) {
            throw new Error('invalid server startup');
        }
    }

    public async createNotebook(_resource: Uri): Promise<INotebook> {
        return new MockJupyterNotebook(this.getConnectionInfo());
    }

    public async getNotebook(_document: NotebookDocument): Promise<INotebook | undefined> {
        return new MockJupyterNotebook(this.getConnectionInfo());
    }
    public getConnectionInfo(): IJupyterConnection | undefined {
        return this.connection;
    }
    public async dispose(): Promise<void> {
        if (this.connection) {
            this.connection.dispose(); // This should kill the process that's running
            this.connection = undefined;
        }
        if (this.notebookFile) {
            this.notebookFile.dispose(); // This destroy any unwanted kernel specs if necessary
            this.notebookFile = undefined;
        }
    }
}
