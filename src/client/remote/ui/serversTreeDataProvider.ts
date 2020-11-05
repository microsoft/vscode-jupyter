// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { posix } from 'path';
import {
    Event,
    EventEmitter,
    FileType,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    Uri
} from 'vscode';
import { traceError } from '../../common/logger';
import { IDisposable, IDisposableRegistry } from '../../common/types';
import { Commands } from '../../datascience/constants';
import { getRemoteConnection } from '../connection/jupyterServerAuthService';
import { RemoteFileSystemFactory } from './fileSystem';
import { IJupyterServerAuthServiceProvider, IJupyterServerConnectionInfo, JupyterServerConnectionId } from './types';

export type JupyterServerTreeNodeType = 'jupyterServer' | 'fileSystem' | 'directory' | 'file' | 'kernelSessions';

export abstract class BaseTreeNode<T extends JupyterServerTreeNodeType> extends TreeItem {
    public readonly connectionId: JupyterServerConnectionId;
    constructor(
        connectionInfo: IJupyterServerConnectionInfo,
        public readonly type: T,
        item: string | Uri,
        collapsibleState?: TreeItemCollapsibleState
    ) {
        // tslint:disable-next-line: no-any
        super(item as any, collapsibleState);
        this.contextValue = type;
        this.connectionId = connectionInfo.id;
    }
}

export class ServerNode extends BaseTreeNode<'jupyterServer'> {
    constructor(info: IJupyterServerConnectionInfo) {
        super(info, 'jupyterServer', info.settings.baseUrl, TreeItemCollapsibleState.Expanded);
        this.iconPath = new ThemeIcon('server');
    }
}
// tslint:disable: max-classes-per-file
export class DirectoryNode extends BaseTreeNode<'directory'> {
    constructor(info: IJupyterServerConnectionInfo, name: string, public readonly uri: Uri) {
        super(info, 'directory', name, TreeItemCollapsibleState.Collapsed);
        this.iconPath = ThemeIcon.Folder;
    }
}
export class FileNode extends BaseTreeNode<'file'> {
    constructor(info: IJupyterServerConnectionInfo, name: string, public readonly uri: Uri) {
        super(info, 'file', name, TreeItemCollapsibleState.None);
        this.iconPath = ThemeIcon.File;
        this.resourceUri = uri;
        this.command = {
            command: name.toLocaleLowerCase().endsWith('.ipynb') ? Commands.OpenNotebookInPreviewEditor : 'vscode.open',
            arguments: [uri],
            title: 'Open File'
        };
    }
}
export class FileSystemNode extends BaseTreeNode<'fileSystem'> {
    public readonly uri: Uri;
    constructor(info: IJupyterServerConnectionInfo) {
        super(info, 'fileSystem', 'File System', TreeItemCollapsibleState.Collapsed);
        this.uri = Uri.file('/').with({ scheme: info.fileScheme });
        this.iconPath = new ThemeIcon('remote-explorer');
    }
}

export class KernelSessionsNode extends BaseTreeNode<'kernelSessions'> {
    constructor(info: IJupyterServerConnectionInfo) {
        super(info, 'kernelSessions', 'Kernel Sessions', TreeItemCollapsibleState.Collapsed);
        this.iconPath = new ThemeIcon('remote-explorer');
    }
}

export type JupyterServerTreeItem = ServerNode | FileSystemNode | DirectoryNode | FileNode;

export async function getChildrenOfServer(item: ServerNode) {
    const connectionInfo = getRemoteConnection(item.connectionId);
    if (!connectionInfo) {
        traceError(`Got a connection that is no longer valid, id = ${item.connectionId}`);
        return [];
    }
    return [new FileSystemNode(connectionInfo)];
}

export async function getContentsOfDirectory(item: FileSystemNode | DirectoryNode, fsFactory: RemoteFileSystemFactory) {
    const connectionInfo = getRemoteConnection(item.connectionId);
    if (!connectionInfo) {
        traceError(`Got a connection that is no longer valid, id = ${item.connectionId}`);
        return [];
    }
    const fs = fsFactory.getOrCreateRemoteFileSystem(connectionInfo);
    const contents = await fs.readDirectory(item.uri);
    return contents
        .filter(([_, type]) => type === FileType.File || type === FileType.Directory)
        .map(([name, type]) => {
            const uri = Uri.file(posix.join(item.uri.fsPath, name)).with({ scheme: connectionInfo.fileScheme });
            return type === FileType.File
                ? new FileNode(connectionInfo, name, uri)
                : new DirectoryNode(connectionInfo, name, uri);
        });
}

// tslint:disable-next-line: max-classes-per-file
@injectable()
export class JupyterServersTreeDataProvider implements TreeDataProvider<JupyterServerTreeItem>, IDisposable {
    private readonly parentNodes = new WeakMap<JupyterServerTreeItem, JupyterServerTreeItem | undefined>();
    /**
     * An optional event to signal that an element or root has changed.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     * To signal that root has changed, do not pass any argument or pass `undefined` or `null`.
     */
    public get onDidChangeTreeData(): Event<JupyterServerTreeItem | undefined | null | void> {
        return this._onDidChangeTreeData.event;
    }
    private serverNodes = new Map<IJupyterServerConnectionInfo, ServerNode>();
    private _onDidChangeTreeData = new EventEmitter<JupyterServerTreeItem | undefined | null | void>();
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IJupyterServerAuthServiceProvider) private readonly authService: IJupyterServerAuthServiceProvider,
        @inject(RemoteFileSystemFactory) private readonly fsFactory: RemoteFileSystemFactory
    ) {
        disposables.push(this);
        authService.onDidAddServer(this.refreshServers, this, disposables);
        authService.onDidRemoveServer(this.refreshServers, this, disposables);
    }
    public refreshParent(item: JupyterServerTreeItem) {
        const parent = this.parentNodes.get(item);
        if (parent) {
            this._onDidChangeTreeData.fire(parent);
        }
    }
    public refreshNode(item: JupyterServerTreeItem) {
        this._onDidChangeTreeData.fire(item);
    }
    public dispose() {
        this._onDidChangeTreeData.dispose();
    }
    /**
     * Get [TreeItem](#TreeItem) representation of the `element`
     *
     * @param element The element for which [TreeItem](#TreeItem) representation is asked for.
     * @return [TreeItem](#TreeItem) representation of the element
     */
    public getTreeItem(element: JupyterServerTreeItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    /**
     * Get the children of `element` or root if no element is passed.
     *
     * @param element The element from which the provider gets children. Can be `undefined`.
     * @return Children of `element` or root if no element is passed.
     */
    public async getChildren(element?: JupyterServerTreeItem): Promise<JupyterServerTreeItem[]> {
        const children = await this.getChildrenInternal(element);
        children.forEach((item) => this.parentNodes.set(item, element));
        return children;
    }
    public async getChildrenInternal(element?: JupyterServerTreeItem): Promise<JupyterServerTreeItem[]> {
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
            default: {
                return [];
            }
        }
    }
    private async refreshServers() {
        const servers = await this.authService.getRemoteConnections();
        const validServers = new Set(servers);
        // Remove servers that are no longer available.
        const serversInTreeView = Array.from(this.serverNodes.keys());
        serversInTreeView.filter((item) => !validServers.has(item)).forEach((item) => this.serverNodes.delete(item));

        // Add missing servers.
        servers
            .filter((item) => !this.serverNodes.has(item))
            .map((item) => this.serverNodes.set(item, new ServerNode(item)));

        this._onDidChangeTreeData.fire();
    }
}
