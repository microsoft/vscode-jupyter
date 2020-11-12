// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { basename, posix } from 'path';
import { Event, EventEmitter, FileType, TreeDataProvider, TreeItem, Uri } from 'vscode';
import { IDisposable, IDisposableRegistry } from '../../common/types';
import { DataScience } from '../../common/utils/localize';
import { JupyterServerConnectionService } from '../connection/remoteConnectionsService';
import { RemoteFileSystemFactory } from './fileSystemFactory';
import {
    DirectoryNode,
    DirectoryTreeNodeData,
    FileNode,
    FileSystemNode,
    FileTreeNodeData,
    JupyterServerTreeData,
    KernelSessionNode,
    KernelSessionsNode,
    KernelSessionTreeNodeData,
    ServerNode,
    TreeNodeData
} from './treeNodes';
import { IJupyterServerConnectionService } from './types';

export async function getChildrenOfServer(
    item: TreeNodeData<'jupyterServer'>
): Promise<[TreeNodeData<'kernelSessions'>, TreeNodeData<'fileSystem'>]> {
    return [
        {
            connection: item.connection,
            label: 'Kernel Sessions',
            type: 'kernelSessions'
        },
        {
            connection: item.connection,
            label: 'File System',
            type: 'fileSystem'
        }
    ];
}

export async function getContentsOfDirectory(
    item: TreeNodeData<'fileSystem'> | DirectoryTreeNodeData,
    fsFactory: RemoteFileSystemFactory
): Promise<(FileTreeNodeData | DirectoryTreeNodeData)[]> {
    const fs = await fsFactory.getOrCreateRemoteFileSystem(item.connection);
    const rootPath = item.type === 'directory' ? item.path : '/';
    const contents = await fs.readDirectory(Uri.file(rootPath).with({ scheme: item.connection.fileScheme }));
    return contents
        .filter(([_, type]) => type === FileType.File || type === FileType.Directory)
        .map(([name, type]) => {
            return {
                connection: item.connection,
                label: name,
                path: posix.join(rootPath, name),
                type: type === FileType.File ? 'file' : 'directory'
            };
        });
}

export async function getActiveKernels(
    data: TreeNodeData<'kernelSessions'>,
    connectionService: JupyterServerConnectionService
): Promise<KernelSessionTreeNodeData[]> {
    const manager = await connectionService.getServiceManager(data.connection.id);
    const [kernels, sessions] = await Promise.all([manager.getRunningKernels(), manager.getRunningSessions()]);
    return sessions.map((session) => {
        const kernel = kernels.find((item) => item.id === session.kernel.id);
        const tooltip = kernel
            ? DataScience.jupyterSelectURIRunningDetailFormat().format(
                  kernel.lastActivityTime.toLocaleString(),
                  kernel.numberOfConnections.toString()
              )
            : '';
        return {
            session,
            kernel,
            connection: data.connection,
            label: session.name || basename(session.path),
            description: session.path,
            tooltip,
            type: 'kernelSession'
        };
    });
}

function createTreeItem(data: JupyterServerTreeData): TreeItem {
    switch (data.type) {
        case 'jupyterServer':
            return new ServerNode(data);
        case 'kernelSessions':
            return new KernelSessionsNode(data);
        case 'fileSystem':
            return new FileSystemNode(data);
        case 'directory':
            return new DirectoryNode(data);
        case 'file':
            return new FileNode(data);
        case 'kernelSession':
            return new KernelSessionNode(data);
        default:
            throw new Error('Unknown Type');
    }
}
@injectable()
export class JupyterServersTreeDataProvider implements TreeDataProvider<JupyterServerTreeData>, IDisposable {
    private readonly parentNodes = new Map<JupyterServerTreeData, JupyterServerTreeData | undefined>();
    /**
     * An optional event to signal that an element or root has changed.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     * To signal that root has changed, do not pass any argument or pass `undefined` or `null`.
     */
    public get onDidChangeTreeData(): Event<JupyterServerTreeData | undefined | null | void> {
        return this._onDidChangeTreeData.event;
    }
    private serverNodes = new Map<string, TreeNodeData<'jupyterServer'>>();
    private _onDidChangeTreeData = new EventEmitter<JupyterServerTreeData | undefined | null | void>();
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IJupyterServerConnectionService) private readonly connectionService: JupyterServerConnectionService,
        @inject(RemoteFileSystemFactory) private readonly fsFactory: RemoteFileSystemFactory
    ) {
        disposables.push(this);
        connectionService.onDidAddServer(this.refreshServers, this, disposables);
        connectionService.onDidRemoveServer(this.refreshServers, this, disposables);
    }
    public refreshParent(item: JupyterServerTreeData) {
        const parent = this.parentNodes.get(item);
        if (parent) {
            this._onDidChangeTreeData.fire(parent);
        }
    }
    public refreshNode(item: JupyterServerTreeData) {
        this._onDidChangeTreeData.fire(item);
    }
    public dispose() {
        this._onDidChangeTreeData.dispose();
    }
    public getTreeItem(element: JupyterServerTreeData): TreeItem | Thenable<TreeItem> {
        return createTreeItem(element);
    }
    public async getChildren(element?: JupyterServerTreeData): Promise<JupyterServerTreeData[]> {
        const children = await this.getChildrenInternal(element);
        children.forEach((item) => this.parentNodes.set(item, element));
        return children;
    }
    public async getChildrenInternal(element?: JupyterServerTreeData): Promise<JupyterServerTreeData[]> {
        if (!element) {
            return Array.from(this.serverNodes.values());
        }

        switch (element.type) {
            case 'fileSystem':
            case 'directory': {
                return getContentsOfDirectory(element, this.fsFactory);
            }
            case 'file': {
                return [];
            }
            case 'jupyterServer': {
                return getChildrenOfServer(element);
            }
            case 'kernelSessions': {
                return getActiveKernels(element, this.connectionService);
            }
            default: {
                return [];
            }
        }
    }
    private async refreshServers() {
        const connections = await this.connectionService.getConnections();
        const validServers = new Set(connections.map((item) => item.id));
        // Remove servers that are no longer available.
        const serversInTreeView = Array.from(this.serverNodes.keys());
        serversInTreeView
            .filter((server) => !validServers.has(server))
            .forEach((server) => this.serverNodes.delete(server));

        // Add missing servers.
        connections
            .filter((connection) => !this.serverNodes.has(connection.id))
            .forEach((connection) =>
                this.serverNodes.set(connection.id, {
                    connection,
                    label: connection.displayName,
                    type: 'jupyterServer'
                })
            );

        this._onDidChangeTreeData.fire();
    }
}
