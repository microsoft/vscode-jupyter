// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, EventEmitter, QuickPickItem, Uri } from 'vscode';
import { IJupyterServerUri, IJupyterUriProvider } from '../../api.unstable';
import { IExtensionContext } from '../../platform/common/types';
import {
    JupyterServer,
    JupyterServerCollection,
    JupyterServerConnectionInformation,
    JupyterServerCreationItem
} from '../../api.proposed';
import { Disposables } from '../../platform/common/utils';
import { IServiceContainer } from '../../platform/ioc/types';
import { IJupyterUriProviderRegistration } from '../../kernels/jupyter/types';

class JupyterServerCreationItemImpl extends Disposables implements JupyterServerCreationItem {
    label: string;
    detail?: string | undefined;
    sortText?: string | undefined;
    picked?: boolean | undefined;
    constructor(label: string, public readonly onDidSelect: () => Promise<JupyterServer | undefined>) {
        super();
        this.label = label;
    }
}

class JupyterServerImpl extends Disposables implements JupyterServer {
    constructor(
        public readonly id: string,
        public label: string,
        public resolveConnectionInformation: () => Promise<JupyterServerConnectionInformation>
    ) {
        super();
    }
}
class JupyterServerCollectionImpl extends Disposables implements JupyterServerCollection, IJupyterUriProvider {
    documentation?: Uri | undefined;
    protected readonly creationItems = new Set<JupyterServerCreationItemImpl>();
    protected readonly servers = new Set<JupyterServerImpl>();
    public get displayName() {
        return this.label;
    }
    detail?: string | undefined;
    private readonly _onDidChangeHandles = new EventEmitter<void>();
    public readonly onDidChangeHandles = this._onDidChangeHandles.event;
    constructor(public readonly id: string, public label: string) {
        super();
    }
    createServer(
        id: string,
        label: string,
        resolveConnectionInformation: () => Promise<JupyterServerConnectionInformation>
    ): JupyterServer {
        const server = new JupyterServerImpl(id, label, resolveConnectionInformation);
        this.servers.add(server);
        this.disposables.push(server);

        server.onDidDispose(
            () => {
                this.servers.delete(server);
                this._onDidChangeHandles.fire();
            },
            this,
            this.disposables
        );

        this._onDidChangeHandles.fire();
        return server;
    }
    createServerCreationItem(
        label: string,
        onDidSelect: () => Promise<JupyterServer | undefined>
    ): JupyterServerCreationItem {
        const item = new JupyterServerCreationItemImpl(label, onDidSelect);
        this.creationItems.add(item);
        item.onDidDispose(() => this.creationItems.delete(item), this, this.disposables);
        this.disposables.push(item);
        return item;
    }
    getQuickPickEntryItems(): (QuickPickItem & { default?: boolean | undefined })[] {
        return Array.from(this.creationItems)
            .filter((s) => !s.isDisposed)
            .sort((a, b) => (a.sortText || a.label).localeCompare(b.sortText || b.label))
            .map((a) => {
                return {
                    label: a.label,
                    default: a.picked,
                    detail: a.detail
                };
            });
    }
    async handleQuickPick(item: QuickPickItem, _backEnabled: boolean): Promise<string | undefined> {
        const selection = Array.from(this.creationItems).find((a) => a.label === item.label);
        if (selection) {
            try {
                const server = await selection.onDidSelect();
                return server?.id || 'back';
            } catch (ex) {
                if (ex instanceof CancellationError) {
                    return;
                }
                return 'back';
            }
        }
    }
    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        const server = Array.from(this.servers).find((a) => a.id === handle);
        if (server) {
            const info = await server.resolveConnectionInformation();
            return {
                baseUrl: info.baseUrl.toString(),
                displayName: server.label,
                token: info.token,
                authorizationHeader: info.authorizationHeader,
                mappedRemoteNotebookDir: info.mappedRemoteNotebookDir,
                webSocketProtocols: info.webSocketProtocols
            };
        }
        throw new Error(`Server with handle '${handle}' not found.`);
    }
    async getServerUriWithoutAuth(handle: string): Promise<IJupyterServerUri> {
        const server = Array.from(this.servers).find((a) => a.id === handle);
        if (server) {
            return {
                baseUrl: '',
                displayName: server.label,
                token: ''
            };
        }
        throw new Error(`Server with handle '${handle}' not found.`);
    }
    async getHandles(): Promise<string[]> {
        return Array.from(this.servers)
            .filter((s) => !s.isDisposed)
            .map((s) => s.id);
    }
    async removeHandle(handle: string): Promise<void> {
        const server = Array.from(this.servers).find((a) => a.id === handle);
        server?.dispose();
    }
}
export function createServerCollection(
    serviceContainer: IServiceContainer,
    context: IExtensionContext,
    extensionId: string,
    id: string,
    label: string
) {
    const collection = new JupyterServerCollectionImpl(id, label);
    const container = serviceContainer.get<IJupyterUriProviderRegistration>(IJupyterUriProviderRegistration);
    const disposable = container.registerProvider(collection, extensionId);
    collection.onDidDispose(() => disposable, undefined, context.subscriptions);

    context.subscriptions.push(collection);
    context.subscriptions.push(disposable);

    return collection;
}
