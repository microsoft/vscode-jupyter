// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri, window } from 'vscode';
import { DataScience } from '../../common/utils/localize';
import { INotebookEditorProvider } from '../../datascience/types';
import { JupyterServerConnectionService } from '../connection/remoteConnectionsService';
import { RemoteFileSystemFactory } from './fileSystemFactory';
import { IJupyterServerConnectionService, JupyterServerConnection } from './types';

/**
 * Creates new notebooks.
 */
@injectable()
export class NotebookCreator {
    constructor(
        @inject(IJupyterServerConnectionService) private readonly connectionService: JupyterServerConnectionService,
        @inject(INotebookEditorProvider) private notebookEditorProvider: INotebookEditorProvider,
        @inject(RemoteFileSystemFactory) private readonly fsFactory: RemoteFileSystemFactory
    ) {}
    public async createNewNotebook(): Promise<void> {
        const connections = await this.connectionService.getConnections();
        if (connections.length === 0) {
            await this.createBlankNotebookLocally();
            return;
        }

        const connection = await this.connectionService.selectConnection();
        if (connection) {
            await this.createBlankOnRemote(connection);
        }
    }
    private async createBlankNotebookLocally() {
        await this.notebookEditorProvider.createNew();
    }
    private async createBlankOnRemote(connection: JupyterServerConnection) {
        const remoteFolders = await window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: Uri.file('/').with({ scheme: connection.fileScheme }),
            openLabel: DataScience.labelToSelectFolderForCreationOfNotebookOnRemote(),
            title: DataScience.titleFormatToSelectFolderForCreationOfNotebookOnRemote().format(connection.displayName)
        });
        if (!remoteFolders || remoteFolders.length === 0) {
            return;
        }
        const remotePath = remoteFolders[0];
        const fileSystem = await this.fsFactory.getOrCreateRemoteFileSystem(connection);
        if (!fileSystem) {
            return;
        }
        await fileSystem.createNew(remotePath, 'notebook');
    }
}
