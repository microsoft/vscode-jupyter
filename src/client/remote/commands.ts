// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../activation/types';
import { IApplicationShell, ICommandManager } from '../common/application/types';
import { IDisposableRegistry } from '../common/types';
import { Common } from '../common/utils/localize';
import { RemoteFileSystemFactory } from './ui/fileSystem';
import {
    DirectoryNode,
    FileNode,
    FileSystemNode,
    JupyterServersTreeDataProvider,
    ServerNode
} from './ui/serversTreeDataProvider';
import { IJupyterServerAuthServiceProvider } from './ui/types';
import { getRemoteConnection } from './connection/jupyterServerAuthService';

@injectable()
export class CommandRegistry implements IExtensionSingleActivationService {
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IJupyterServerAuthServiceProvider) private readonly authService: IJupyterServerAuthServiceProvider,
        @inject(RemoteFileSystemFactory) private readonly fsFactory: RemoteFileSystemFactory,
        @inject(JupyterServersTreeDataProvider) private readonly dataProvider: JupyterServersTreeDataProvider,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell
    ) {}
    public async activate(): Promise<void> {
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.add', () => this.authService.addServer())
        );
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.refresh', (item) => this.refreshServer(item))
        );
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.logout', (item) =>
                this.authService.logout(item.connectionId)
            )
        );
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.directory.new', (item) =>
                this.createNew(item, 'directory')
            )
        );
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.file.new', (item) => this.createNew(item, 'file'))
        );
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.notebook.new', (item) =>
                this.createNew(item, 'notebook')
            )
        );
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.file.delete', (item) => this.delete(item))
        );
    }
    private async createNew(item: FileSystemNode | DirectoryNode, type: 'file' | 'directory' | 'notebook') {
        const connection = getRemoteConnection(item.connectionId);
        if (!connection) {
            return;
        }
        const remoteFs = this.fsFactory.getOrCreateRemoteFileSystem(connection);
        await remoteFs.createNew(item.uri, type);
        this.dataProvider.refreshNode(item);
    }
    private async refreshServer(item: ServerNode) {
        const connection = getRemoteConnection(item.connectionId);
        if (!connection) {
            return;
        }
        this.dataProvider.refreshNode(item);
    }
    private async delete(item: FileNode) {
        const message = `Are you sure you want to delete ${item.label!}?`;
        const yesNo = await this.appShell.showWarningMessage(message, { modal: true }, Common.bannerLabelYes());
        if (yesNo !== Common.bannerLabelYes()) {
            return;
        }
        const connection = getRemoteConnection(item.connectionId);
        if (!connection) {
            return;
        }
        const remoteFs = this.fsFactory.getOrCreateRemoteFileSystem(connection);
        await remoteFs.delete(item.uri);
        this.dataProvider.refreshParent(item);
    }
}
