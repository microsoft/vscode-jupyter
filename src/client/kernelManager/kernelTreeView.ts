import * as path from 'path';
import { ConnectionStatus, IKernelConnection, Status } from '@jupyterlab/services/lib/kernel/kernel';
import {
    Disposable,
    EventEmitter,
    NotebookDocument,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    window
} from 'vscode';
import {
    IExportedKernelService,
    IKernelConnectionInfo,
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../api/extension';
import { getDisplayPath } from '../common/platform/fs-paths';

type Node =
    | IServerTreeNode
    | IKernelSpecRootTreeNode
    | IKernelSpecTreeNode
    | IActiveKernelRootTreeNode
    | IActiveLocalKernelTreeNode
    | IActiveRemoteKernelTreeNode;
interface IServerTreeNode {
    type: 'host';
    baseUrl?: string;
}

interface IKernelSpecRootTreeNode {
    type: 'kernelSpecRoot';
    baseUrl?: string;
}
interface IActiveKernelRootTreeNode {
    type: 'activeKernelRoot';
    baseUrl: string;
}
interface IKernelSpecTreeNode {
    type: 'kernelSpec';
    kernelConnectionMetadata: KernelConnectionMetadata;
}
interface IActiveLocalKernelTreeNode {
    type: 'activeLocalKernel';
    kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata;
    notebook: NotebookDocument;
    connection: IKernelConnectionInfo;
}
interface IActiveRemoteKernelTreeNode {
    type: 'activeRemoteKernel';
    kernelConnectionMetadata: LiveRemoteKernelConnectionMetadata;
    notebook?: NotebookDocument;
    connection?: IKernelConnectionInfo;
}

function getConnectionTitle(baseUrl?: string) {
    return baseUrl ? `Remote Kernels (${baseUrl})` : 'Local Connections';
}
class HostTreeItem extends TreeItem {
    constructor(public readonly data: IServerTreeNode) {
        super(
            getConnectionTitle(data.baseUrl) ? 'Local Kernels' : `Remote Kernels (${data.baseUrl})`,
            TreeItemCollapsibleState.Collapsed
        );
        this.contextValue = this.data.type;
    }
}
class KernelSpecifications extends TreeItem {
    constructor(public readonly data: IKernelSpecRootTreeNode) {
        super('Kernels', TreeItemCollapsibleState.Collapsed);
        this.contextValue = this.data.type;
    }
}
class ActiveKernels extends TreeItem {
    constructor(public readonly data: IActiveKernelRootTreeNode) {
        super('Active Kernels', TreeItemCollapsibleState.Collapsed);
        this.contextValue = this.data.type;
    }
}
function getKernelConnectionLabel(connection: KernelConnectionMetadata) {
    switch (connection.kind) {
        case 'connectToLiveKernel': {
            const suffix = connection.kernelModel.notebook ? ` (${connection.kernelModel.notebook})` : '';
            return `${connection.kernelModel.display_name || connection.kernelModel.name}${suffix}`;
        }
        case 'startUsingRemoteKernelSpec': {
            return connection.kernelSpec.display_name || connection.kernelSpec.name;
        }
        case 'startUsingLocalKernelSpec': {
            return connection.kernelSpec.display_name || connection.kernelSpec.name;
        }
        case 'startUsingPythonInterpreter': {
            return connection.interpreter.displayName || connection.interpreter.path;
        }
        default:
            return '';
    }
}
class KernelSpecTreeItem extends TreeItem {
    constructor(public readonly data: IKernelSpecTreeNode) {
        super(getKernelConnectionLabel(data.kernelConnectionMetadata), TreeItemCollapsibleState.None);
        switch (data.kernelConnectionMetadata.kind) {
            case 'startUsingLocalKernelSpec':
                this.description = data.kernelConnectionMetadata.kernelSpec.specFile
                    ? getDisplayPath(data.kernelConnectionMetadata.kernelSpec.specFile)
                    : '';
                break;
            case 'startUsingPythonInterpreter':
                this.description = getDisplayPath(data.kernelConnectionMetadata.interpreter.path);
                break;
            default:
                break;
        }
        this.contextValue = `${this.data.type}:${this.data.kernelConnectionMetadata.kind}`;
    }
}
class ActiveLocalOrRemoteKernelConnectionTreeItem extends TreeItem {
    constructor(public readonly data: IActiveLocalKernelTreeNode | IActiveRemoteKernelTreeNode) {
        super(getKernelConnectionLabel(data.kernelConnectionMetadata), TreeItemCollapsibleState.None);
        this.trackKernelState();
        if (this.data.connection) {
            if (this.data.connection.connection.connectionStatus !== 'connected') {
                this.updateIcon(this.data.connection.connection.connectionStatus);
            } else {
                this.updateIcon(this.data.connection.connection.status);
            }
        }
        if (data.notebook) {
            this.description = path.basename(data.notebook.uri.fsPath);
        }
        this.contextValue = `${this.data.type}:${this.data.kernelConnectionMetadata.kind}`;
    }
    dispose() {
        if (this.data.connection) {
            this.data.connection.connection.connectionStatusChanged.disconnect(this.onConnectionStatusChanged, this);
            this.data.connection.connection.statusChanged.disconnect(this.onStatusChanged, this);
        }
    }
    private trackKernelState() {
        if (this.data.connection) {
            this.data.connection.connection.connectionStatusChanged.connect(this.onConnectionStatusChanged, this);
            this.data.connection.connection.statusChanged.connect(this.onStatusChanged, this);
        }
    }
    private onConnectionStatusChanged(_sender: IKernelConnection, status: ConnectionStatus) {
        if (status === 'disconnected' || status === 'connecting') {
            this.updateIcon(status);
        }
    }
    private onStatusChanged(_sender: IKernelConnection, status: Status) {
        this.updateIcon(status);
    }
    private updateIcon(state: 'disconnected' | 'connecting' | Status) {
        this.iconPath = new ThemeIcon(state);
    }
}
export class KernelTreeView implements TreeDataProvider<Node> {
    public readonly _onDidChangeTreeData = new EventEmitter<void | Node | null | undefined>();
    private cachedKernels?: KernelConnectionMetadata[];
    private readonly disposables: Disposable[] = [];

    public get onDidChangeTreeData() {
        return this._onDidChangeTreeData.event;
    }

    constructor(private readonly kernelService: IExportedKernelService) {
        this.kernelService.onDidChangeKernelSpecifications(
            () => {
                this.cachedKernels = undefined;
                this._onDidChangeTreeData.fire();
            },
            this,
            this.disposables
        );
        this.kernelService.onDidChangeKernels(
            () => {
                this.cachedKernels = undefined;
                this._onDidChangeTreeData.fire();
            },
            this,
            this.disposables
        );
        this.kernelService.getKernel;
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
    getTreeItem(element: Node): TreeItem | Thenable<TreeItem> {
        switch (element.type) {
            case 'host':
                return new HostTreeItem(element);
            case 'kernelSpecRoot':
                return new KernelSpecifications(element);
            case 'activeKernelRoot':
                return new ActiveKernels(element);
            case 'kernelSpec':
                return new KernelSpecTreeItem(element);
            case 'activeLocalKernel':
            case 'activeRemoteKernel': {
                const item = new ActiveLocalOrRemoteKernelConnectionTreeItem(element);
                this.disposables.push(item);
                return item;
            }
            default:
                break;
        }
        throw new Error(`${element}`);
    }
    public async getChildren(element?: Node): Promise<Node[]> {
        if (!element) {
            this.cachedKernels = await this.kernelService.getKernelSpecifications();
            const remoteBaseUrls = new Set<string>();
            this.cachedKernels.forEach((item) => {
                if (!isLocalKernelConnection(item)) {
                    remoteBaseUrls.add(item.baseUrl);
                }
            });
            const remoteHosts = Array.from(remoteBaseUrls).map((baseUrl) => <IServerTreeNode>{ type: 'host', baseUrl });
            return [<IServerTreeNode>{ type: 'host' }, ...remoteHosts];
        }
        switch (element.type) {
            case 'host': {
                if (!this.cachedKernels) {
                    return [];
                }
                return [
                    <IKernelSpecRootTreeNode>{ type: 'kernelSpecRoot', baseUrl: element.baseUrl },
                    <IActiveKernelRootTreeNode>{ type: 'activeKernelRoot', baseUrl: element.baseUrl }
                ];
            }
            case 'kernelSpecRoot': {
                if (!this.cachedKernels) {
                    return [];
                }
                return this.cachedKernels
                    .filter((item) => item.kind !== 'connectToLiveKernel')
                    .filter((item) => {
                        if (isLocalKernelConnection(item)) {
                            return element.baseUrl ? false : true;
                        } else {
                            return element.baseUrl === item.baseUrl;
                        }
                    })
                    .map((item) => {
                        return <IKernelSpecTreeNode>{
                            type: 'kernelSpec',
                            kernelConnectionMetadata: item
                        };
                    });
            }
            case 'activeKernelRoot': {
                if (!this.cachedKernels) {
                    return [];
                }
                const activeKernels = await this.kernelService.getActiveKernels();
                if (element.baseUrl) {
                    const remoteActiveKernels = activeKernels.filter((item) => !isLocalKernelConnection(item.metadata));
                    return Promise.all(
                        this.cachedKernels
                            .filter((item) => item.kind === 'connectToLiveKernel')
                            .filter((item) => !isLocalKernelConnection(item))
                            .map((item) => item as LiveRemoteKernelConnectionMetadata)
                            .filter((item) => item.baseUrl === element.baseUrl)
                            .map(async (item) => {
                                const activeInfo = remoteActiveKernels.find(
                                    (activeKernel) => activeKernel.metadata === item
                                );
                                const info = activeInfo
                                    ? await this.kernelService.getKernel(activeInfo?.notebook)
                                    : undefined;
                                if (info) {
                                    return <IActiveRemoteKernelTreeNode>{
                                        type: 'activeRemoteKernel',
                                        kernelConnectionMetadata: item,
                                        ...info
                                    };
                                } else {
                                    // This happens if we have a remote kernel, but we haven't connected to it.
                                    // E.g. we connect to a remote server, and there are kernels running there.
                                    return <IActiveRemoteKernelTreeNode>{
                                        type: 'activeRemoteKernel',
                                        kernelConnectionMetadata: item
                                    };
                                }
                            })
                    );
                } else {
                    const localActiveKernelSpecs = activeKernels.filter((item) =>
                        isLocalKernelConnection(item.metadata)
                    );
                    const localActiveKernelsWithInfo = await Promise.all(
                        localActiveKernelSpecs.map(async (item) => {
                            const info = await this.kernelService.getKernel(item.notebook);
                            return { ...info, notebook: item.notebook };
                        })
                    );
                    return localActiveKernelsWithInfo
                        .filter((item) => item.metadata && item.connection)
                        .map((item) => {
                            return <IActiveLocalKernelTreeNode>{
                                connection: item.connection!,
                                kernelConnectionMetadata: item.metadata!,
                                notebook: item.notebook,
                                type: 'activeLocalKernel'
                            };
                        });
                }
            }
            default:
                return [];
        }
    }
    public static register(kernelService: IExportedKernelService, disposables: Disposable[]) {
        const provider = new KernelTreeView(kernelService);
        disposables.push(provider);
        const options = { treeDataProvider: provider, canSelectMany: false, showCollapseAll: true };
        const treeView = window.createTreeView<Node>('jupyterKernelsView', options);
        disposables.push(treeView);
    }
}

function isLocalKernelConnection(
    connection: KernelConnectionMetadata
): connection is PythonKernelConnectionMetadata | LocalKernelSpecConnectionMetadata {
    return connection.kind === 'startUsingLocalKernelSpec' || connection.kind === 'startUsingPythonInterpreter';
}
