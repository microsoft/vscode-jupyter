// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { Disposable, Event, EventEmitter, NotebookDocument } from 'vscode';
import { disposeAllDisposables } from '../common/helpers';
import { traceInfo } from '../common/logger';
import { IDisposable, IDisposableRegistry } from '../common/types';
import { PromiseChain } from '../common/utils/async';
import { Telemetry } from '../datascience/constants';
import { KernelConnectionWrapper } from '../datascience/jupyter/kernels/kernelConnectionWrapper';
import {
    IKernel,
    IKernelProvider,
    KernelConnectionMetadata as IKernelKernelConnectionMetadata
} from '../datascience/jupyter/kernels/types';
import { INotebookControllerManager } from '../datascience/notebook/types';
import { IKernelSocket as ExtensionKernelSocket } from '../datascience/types';
import { sendTelemetryEvent } from '../telemetry';
import { ApiAccessService } from './apiAccessService';
import {
    ActiveKernel,
    IExportedKernelService,
    IKernelConnectionInfo,
    IKernelSocket,
    KernelConnectionMetadata,
    WebSocketData
} from './extension';

@injectable()
export class JupyterKernelServiceFactory {
    private readonly chainedApiAccess = new PromiseChain();
    private readonly extensionApi = new Map<string, IExportedKernelService>();
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(ApiAccessService) private readonly apiAccess: ApiAccessService
    ) {}
    public async getService() {
        const accessInfo = await this.chainedApiAccess.chainFinally(() => this.apiAccess.getAccessInformation());
        if (!accessInfo.accessAllowed) {
            return;
        }
        if (this.extensionApi.get(accessInfo.extensionId)) {
            return this.extensionApi.get(accessInfo.extensionId);
        }
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const service = new JupyterKernelService(
            accessInfo.extensionId,
            this.kernelProvider,
            this.disposables,
            this.notebookControllerManager
        );
        this.extensionApi.set(accessInfo.extensionId, service);
        return service;
    }
}

class JupyterKernelService implements IExportedKernelService {
    private readonly _onDidChangeKernelSpecifications = new EventEmitter<void>();
    private readonly _onDidChangeKernels = new EventEmitter<void>();
    private readonly translatedConnections = new WeakMap<
        Readonly<IKernelKernelConnectionMetadata>,
        KernelConnectionMetadata
    >();
    public get onDidChangeKernelSpecifications(): Event<void> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'onDidChangeKernelSpecifications'
        });
        traceInfo(`API called from ${this.callingExtensionId}`);
        return this._onDidChangeKernelSpecifications.event;
    }
    public get onDidChangeKernels(): Event<void> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'onDidChangeKernels'
        });
        return this._onDidChangeKernels.event;
    }
    private static readonly wrappedKernelConnections = new WeakMap<IKernel, IKernelConnectionInfo>();
    constructor(
        private readonly callingExtensionId: string,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager
    ) {
        this.kernelProvider.onDidDisposeKernel(() => this._onDidChangeKernels.fire(), this, disposables);
        this.kernelProvider.onDidStartKernel(() => this._onDidChangeKernels.fire(), this, disposables);
        this.notebookControllerManager.remoteRefreshed(
            () => this._onDidChangeKernelSpecifications.fire(),
            this,
            disposables
        );
    }
    async getKernelSpecifications(): Promise<KernelConnectionMetadata[]> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getKernelSpecifications'
        });
        await this.notebookControllerManager.loadNotebookControllers();
        const items = await this.notebookControllerManager.kernelConnections;
        return items.map((item) => this.translateKernelConnectionMetataToExportedType(item));
    }
    async getActiveKernels(): Promise<{ metadata: KernelConnectionMetadata; notebook: NotebookDocument }[]> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getActiveKernels'
        });
        return this.kernelProvider.kernels.map((item) => {
            return {
                metadata: this.translateKernelConnectionMetataToExportedType(item.kernelConnectionMetadata),
                notebook: item.notebookDocument
            };
        });
    }
    getKernel(
        notebook: NotebookDocument
    ): { metadata: KernelConnectionMetadata; connection: IKernelConnectionInfo } | undefined {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getKernel'
        });
        const kernel = this.kernelProvider.get(notebook);
        if (kernel?.session?.kernel) {
            const connection = this.wrapKernelConnection(kernel);
            return {
                metadata: this.translateKernelConnectionMetataToExportedType(kernel.kernelConnectionMetadata),
                connection
            };
        }
    }
    async startKernel(spec: KernelConnectionMetadata, notebook: NotebookDocument): Promise<IKernelConnectionInfo> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'startKernel'
        });
        return this.startOrConnect(spec, notebook);
    }
    async connect(spec: ActiveKernel, notebook: NotebookDocument): Promise<IKernelConnectionInfo> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'connect'
        });
        return this.startOrConnect(spec, notebook);
    }
    private async startOrConnect(
        spec: KernelConnectionMetadata | ActiveKernel,
        notebook: NotebookDocument
    ): Promise<IKernelConnectionInfo> {
        await this.notebookControllerManager.loadNotebookControllers();
        const items = await this.notebookControllerManager.kernelConnections;
        const metadata = items.find((item) => item.id === spec.id);
        if (!metadata) {
            throw new Error('Not found');
        }
        const controllers = this.notebookControllerManager.registeredNotebookControllers();
        const controller = controllers.find((item) => item.connection.id === metadata.id);
        if (!controller) {
            throw new Error('Not found');
        }
        const kernel = await this.kernelProvider.getOrCreate(notebook, {
            metadata,
            controller: controller.controller,
            resourceUri: notebook.uri
        });
        let wrappedConnection = JupyterKernelService.wrappedKernelConnections.get(kernel);
        if (wrappedConnection) {
            return wrappedConnection;
        }
        await kernel.start();
        if (!kernel?.session?.kernel) {
            throw new Error('Not found');
        }
        return this.wrapKernelConnection(kernel);
    }
    private wrapKernelConnection(kernel: IKernel): IKernelConnectionInfo {
        if (JupyterKernelService.wrappedKernelConnections.get(kernel)) {
            return JupyterKernelService.wrappedKernelConnections.get(kernel)!;
        }

        const connection = new KernelConnectionWrapper(kernel, kernel.session!.kernel!, this.disposables);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const info = { connection, kernelSocket: new KernelSocketWrapper(kernel) };
        JupyterKernelService.wrappedKernelConnections.set(kernel, info);
        return info;
    }
    private translateKernelConnectionMetataToExportedType(
        connection: Readonly<IKernelKernelConnectionMetadata>
    ): KernelConnectionMetadata {
        if (!this.translatedConnections.has(connection)) {
            const readWriteConnection = connection as IKernelKernelConnectionMetadata;
            // By not forcing the cast, we ensure the types are compatible.
            // All we're doing is ensuring the readonly version of one type is compatible with the other.
            // Also, we must return a readonly version of the type (to prevent anyone from stuffing this).
            // Else it breaks the Jupyter extension
            // We recast to KernelConnectionMetadata as this has already define its properties as readonly.
            const translatedConnection = Object.freeze(readWriteConnection) as KernelConnectionMetadata;
            this.translatedConnections.set(connection, translatedConnection);
        }
        return this.translatedConnections.get(connection)!;
    }
}

/**
 * Helper class to wrap the IKernelSocket.
 * This way users of the API will not need to unbind/rebind the hooks and
 * listen to changes in the observable.
 * Also prevents the need for users of the API to depend on rxjs.
 */
class KernelSocketWrapper implements IKernelSocket {
    private socket?: ExtensionKernelSocket;
    private readonly disposables: IDisposable[] = [];
    private receiveHooks = new Set<(data: WebSocketData) => Promise<void>>();
    private sendHooks = new Set<(data: unknown, cb?: (err?: Error) => void) => Promise<void>>();
    private readonly _onDidSocketChange = new EventEmitter<void>();
    public get ready(): boolean {
        return !!this.socket;
    }
    public get onDidChange(): Event<void> {
        return this._onDidSocketChange.event;
    }
    constructor(kernel: IKernel) {
        const subscription = kernel.kernelSocket.subscribe((socket) => {
            this.removeHooks();
            this.socket = socket?.socket;
            this.addHooks();
            this._onDidSocketChange.fire();
        });
        this.disposables.push(new Disposable(() => subscription.unsubscribe()));
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendToRealKernel(data: any, cb?: (err?: Error) => void): void {
        this.socket?.sendToRealKernel(data, cb);
    }
    addReceiveHook(hook: (data: WebSocketData) => Promise<void>): void {
        this.receiveHooks.add(hook);
    }
    removeReceiveHook(hook: (data: WebSocketData) => Promise<void>): void {
        this.receiveHooks.delete(hook);
    }
    addSendHook(
        hook: (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: any,
            cb?: (err?: Error) => void
        ) => Promise<void>
    ): void {
        this.sendHooks.add(hook);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeSendHook(hook: (data: any, cb?: (err?: Error) => void) => Promise<void>): void {
        this.sendHooks.delete(hook);
    }
    private removeHooks() {
        if (!this.socket) {
            return;
        }
        this.receiveHooks.forEach((hook) => this.socket?.removeReceiveHook(hook));
        this.sendHooks.forEach((hook) => this.socket?.removeSendHook(hook));
    }
    private addHooks() {
        if (!this.socket) {
            return;
        }
        this.receiveHooks.forEach((hook) => this.socket?.addReceiveHook(hook));
        this.sendHooks.forEach((hook) => this.socket?.addSendHook(hook));
    }
}
