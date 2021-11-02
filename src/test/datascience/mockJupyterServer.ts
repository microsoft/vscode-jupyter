// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { NotebookDocument, Uri } from 'vscode';
import { TemporaryFile } from '../../client/common/platform/types';
import {
    IJupyterConnection,
    INotebook,
    INotebookServer,
    INotebookServerLaunchInfo
} from '../../client/datascience/types';
import { MockJupyterNotebook } from './mockJupyterNotebook';

export class MockJupyterServer implements INotebookServer {
    private launchInfo: INotebookServerLaunchInfo | undefined;
    private notebookFile: TemporaryFile | undefined;
    public async connect(launchInfo: INotebookServerLaunchInfo): Promise<void> {
        this.launchInfo = launchInfo;

        // Validate connection info and kernel spec
        if (!launchInfo.connectionInfo.baseUrl) {
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
        return this.launchInfo ? this.launchInfo.connectionInfo : undefined;
    }
    public waitForConnect(): Promise<INotebookServerLaunchInfo | undefined> {
        throw new Error('Method not implemented');
    }
    public async dispose(): Promise<void> {
        if (this.launchInfo) {
            this.launchInfo.connectionInfo.dispose(); // This should kill the process that's running
            this.launchInfo = undefined;
        }
        if (this.notebookFile) {
            this.notebookFile.dispose(); // This destroy any unwanted kernel specs if necessary
            this.notebookFile = undefined;
        }
    }
}
