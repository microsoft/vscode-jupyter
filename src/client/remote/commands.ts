// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../activation/types';
import { IApplicationShell, ICommandManager } from '../common/application/types';
import { IDisposableRegistry } from '../common/types';
import { Common } from '../common/utils/localize';
import { JupyterServerConnectionService } from './connection/remoteConnectionsService';
import { RemoteFileSystemFactory } from './ui/fileSystemFactory';
import { JupyterServersTreeDataProvider } from './ui/serversTreeDataProvider';
import { DirectoryNode, FileNode, FileSystemNode, KernelSessionsNode, ServerNode } from './ui/treeNodes';
import { IJupyterServerConnectionService } from './ui/types';

@injectable()
export class CommandRegistry implements IExtensionSingleActivationService {
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IJupyterServerConnectionService) private readonly connectionService: JupyterServerConnectionService,
        @inject(RemoteFileSystemFactory) private readonly fsFactory: RemoteFileSystemFactory,
        @inject(JupyterServersTreeDataProvider) private readonly dataProvider: JupyterServersTreeDataProvider,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell
    ) {}
    public async activate(): Promise<void> {
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.add', () => this.connectionService.addServer())
        );
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.refresh', (item) => this.refreshServer(item))
        );
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.kernelSessions.refresh', (item) =>
                this.refreshKernelSessions(item)
            )
        );
        this.disposables.push(
            this.commandManager.registerCommand('jupyter.server.logout', (item) =>
                this.connectionService.logout(item.data.connection.id)
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
        const remoteFs = await this.fsFactory.getOrCreateRemoteFileSystem(item.data.connection);
        await remoteFs.createNew(item.uri, type);
        this.dataProvider.refreshNode(item.data);
    }
    private async refreshServer(item: ServerNode) {
        this.dataProvider.refreshNode(item.data);
    }
    private async refreshKernelSessions(item: KernelSessionsNode) {
        this.dataProvider.refreshNode(item.data);
    }
    private async delete(item: FileNode) {
        const message = `Are you sure you want to delete ${item.label!}?`;
        const remoteFsPromise = this.fsFactory.getOrCreateRemoteFileSystem(item.data.connection);
        const yesNo = await this.appShell.showWarningMessage(message, { modal: true }, Common.bannerLabelYes());
        if (yesNo !== Common.bannerLabelYes()) {
            return;
        }
        const remoteFs = await remoteFsPromise;
        await remoteFs.delete(item.uri);
        this.dataProvider.refreshParent(item.data);
    }
}
