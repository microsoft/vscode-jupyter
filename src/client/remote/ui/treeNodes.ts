// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Session } from '@jupyterlab/services';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { Commands } from '../../datascience/constants';
import { IJupyterKernel } from '../../datascience/types';
import { JupyterServerConnection } from './types';

// tslint:disable: max-classes-per-file

export type JupyterServerTreeNodeType = 'jupyterServer' | 'fileSystem' | 'directory' | 'file' | 'kernelSessions';
export type JupyterServerTreeData =
    | TreeNodeData<'jupyterServer'>
    | TreeNodeData<'fileSystem'>
    | TreeNodeData<'kernelSessions'>
    | DirectoryTreeNodeData
    | KernelSessionTreeNodeData
    | FileTreeNodeData;
export type TreeNodeData<T> = {
    readonly connection: JupyterServerConnection;
    readonly type: T;
    readonly label: string;
    readonly description?: string;
    readonly tooltip?: string;
};
export type DirectoryTreeNodeData = TreeNodeData<'directory'> & {
    readonly path: string;
};
export type FileTreeNodeData = TreeNodeData<'file'> & {
    readonly path: string;
};

export type KernelSessionTreeNodeData = TreeNodeData<'kernelSession'> & {
    readonly session: Session.IModel;
    readonly kernel?: IJupyterKernel;
};

export abstract class BaseTreeNode extends TreeItem {
    constructor(public readonly data: JupyterServerTreeData, collapsibleState?: TreeItemCollapsibleState) {
        super(data.label, collapsibleState);
        this.contextValue = data.type;
        this.id = `${data.connection.id}-${this.label || ''}-${data.type}`;
        this.description = data.description;
        this.tooltip = data.tooltip;
    }
}

export class ServerNode extends BaseTreeNode {
    constructor(data: TreeNodeData<'jupyterServer'>) {
        super(data, TreeItemCollapsibleState.Expanded);
        this.iconPath = new ThemeIcon('server');
    }
}
export class DirectoryNode extends BaseTreeNode {
    public readonly uri: Uri;
    constructor(data: DirectoryTreeNodeData) {
        super(data, TreeItemCollapsibleState.Collapsed);
        this.uri = Uri.file(data.path).with({ scheme: data.connection.fileScheme });
        this.iconPath = ThemeIcon.Folder;
        this.id = `${this.id}${this.uri.fsPath}`;
    }
}
export class FileNode extends BaseTreeNode {
    public readonly uri: Uri;
    constructor(data: FileTreeNodeData) {
        super(data, TreeItemCollapsibleState.None);
        this.uri = Uri.file(data.path).with({ scheme: data.connection.fileScheme });
        this.iconPath = ThemeIcon.File;
        this.resourceUri = this.uri;
        this.command = {
            command: data.path.toLowerCase().endsWith('.ipynb') ? Commands.OpenNotebookInPreviewEditor : 'vscode.open',
            arguments: [this.uri],
            title: 'Open File'
        };
        this.id = `${this.id}${this.uri.fsPath}`;
    }
}
export class FileSystemNode extends BaseTreeNode {
    public readonly uri: Uri;
    constructor(data: TreeNodeData<'fileSystem'>) {
        super(data, TreeItemCollapsibleState.Collapsed);
        this.uri = Uri.file('/').with({ scheme: data.connection.fileScheme });
        this.iconPath = new ThemeIcon('remote-explorer');
    }
}

export class KernelSessionsNode extends BaseTreeNode {
    constructor(data: TreeNodeData<'kernelSessions'>) {
        super(data, TreeItemCollapsibleState.Collapsed);
        this.iconPath = new ThemeIcon('remote-explorer');
    }
}

export class KernelSessionNode extends BaseTreeNode {
    public readonly uri: Uri;
    constructor(data: KernelSessionTreeNodeData) {
        super(data, TreeItemCollapsibleState.None);
        this.uri = Uri.file(data.session.path).with({ scheme: data.connection.fileScheme });
        this.iconPath = ThemeIcon.File;
        this.resourceUri = this.uri;
        this.command = {
            command: data.session.path.toLowerCase().endsWith('.ipynb')
                ? Commands.OpenNotebookInPreviewEditor
                : 'vscode.open',
            arguments: [this.uri],
            title: 'Open File'
        };
        this.id = `${this.id}${this.uri.fsPath}`;
    }
}
