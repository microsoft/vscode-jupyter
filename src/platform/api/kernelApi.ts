// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { Disposable, Event, EventEmitter, Uri } from 'vscode';
import { KernelConnectionWrapper } from './kernelConnectionWrapper';
import {
    IKernelProvider,
    IKernel,
    KernelConnectionMetadata as IKernelKernelConnectionMetadata
} from '../../kernels/types';
import { INotebookControllerManager } from '../../notebooks/types';
import { disposeAllDisposables } from '../common/helpers';
import { traceInfo } from '../logging';
import { IDisposable, IDisposableRegistry, IExtensions } from '../common/types';
import { PromiseChain } from '../common/utils/async';
import { IKernelSocket as ExtensionKernelSocket } from '../../kernels/types';
import { sendTelemetryEvent } from '../../telemetry';
import { ApiAccessService } from './apiAccessService';
import {
    ActiveKernel,
    IExportedKernelService,
    IKernelConnectionInfo,
    IKernelSocket,
    KernelConnectionMetadata,
    WebSocketData
} from './extension';
import { Telemetry } from '../common/constants';
import { KernelConnector } from '../../kernels/kernelConnector';
import { DisplayOptions } from '../../kernels/displayOptions';
import { IServiceContainer } from '../ioc/types';
import { JupyterNotebookView } from '../../notebooks/constants';
import { IExportedKernelServiceFactory } from './types';

@injectable()
export class JupyterKernelServiceFactory implements IExportedKernelServiceFactory {
    private readonly chainedApiAccess = new PromiseChain();
    private readonly extensionApi = new Map<string, IExportedKernelService>();
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(ApiAccessService) private readonly apiAccess: ApiAccessService,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer
    ) {}
    public async getService() {
        const info = await this.extensions.determineExtensionFromCallStack();
        const accessInfo = await this.chainedApiAccess.chainFinally(() => this.apiAccess.getAccessInformation(info));
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
            this.notebookControllerManager,
            this.serviceContainer
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
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(IServiceContainer) private serviceContainer: IServiceContainer
    ) {
        this.kernelProvider.onDidDisposeKernel(() => this._onDidChangeKernels.fire(), this, disposables);
        this.kernelProvider.onDidStartKernel(() => this._onDidChangeKernels.fire(), this, disposables);
        this.notebookControllerManager.remoteRefreshed(
            () => this._onDidChangeKernelSpecifications.fire(),
            this,
            disposables
        );
    }
    async getKernelSpecifications(refresh?: boolean): Promise<KernelConnectionMetadata[]> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getKernelSpecifications'
        });
        await this.notebookControllerManager.loadNotebookControllers(refresh);
        const items = await this.notebookControllerManager.kernelConnections;
        return items.map((item) => this.translateKernelConnectionMetadataToExportedType(item));
    }
    getActiveKernels(): { metadata: KernelConnectionMetadata; uri: Uri | undefined }[] {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getActiveKernels'
        });
        const kernels: { metadata: KernelConnectionMetadata; uri: Uri | undefined }[] = [];
        const kernelsAlreadyListed = new Set<string>();
        this.kernelProvider.kernels
            .filter(
                (item) => item.startedAtLeastOnce || item.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel'
            )
            .forEach((item) => {
                const kernel = this.kernelProvider.get(item.uri);
                // When returning list of active sessions, we don't want to return something thats
                // associated with a controller.
                // Note: In VS Code, a controller starts a kernel, however the controller only keeps track of the kernel spec.
                // Hence when we return this connection, we're actually returning the controller's kernel spec & the uri.
                if (kernel && kernel.session?.kernelId) {
                    kernelsAlreadyListed.add(kernel.session?.kernelId);
                }
                kernels.push({
                    metadata: this.translateKernelConnectionMetadataToExportedType(item.kernelConnectionMetadata),
                    uri: item.uri
                });
            });
        this.notebookControllerManager.getRegisteredNotebookControllers().forEach((item) => {
            if (item.controller.notebookType !== JupyterNotebookView) {
                return;
            }
            if (item.connection.kind !== 'connectToLiveRemoteKernel') {
                return;
            }
            if (!item.connection.kernelModel.id || kernelsAlreadyListed.has(item.connection.kernelModel.id)) {
                return;
            }
            kernels.push({ metadata: item.connection, uri: undefined });
        });
        return kernels;
    }
    getKernel(uri: Uri): { metadata: KernelConnectionMetadata; connection: IKernelConnectionInfo } | undefined {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getKernel'
        });
        const kernel = this.kernelProvider.get(uri);
        if (kernel?.session?.kernel) {
            const connection = this.wrapKernelConnection(kernel);
            return {
                metadata: this.translateKernelConnectionMetadataToExportedType(kernel.kernelConnectionMetadata),
                connection
            };
        }
    }
    async startKernel(spec: KernelConnectionMetadata, uri: Uri): Promise<IKernelConnectionInfo> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'startKernel'
        });
        return this.startOrConnect(spec, uri);
    }
    async connect(spec: ActiveKernel, uri: Uri): Promise<IKernelConnectionInfo> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'connect'
        });
        return this.startOrConnect(spec, uri);
    }
    private async startOrConnect(
        spec: KernelConnectionMetadata | ActiveKernel,
        uri: Uri
    ): Promise<IKernelConnectionInfo> {
        await this.notebookControllerManager.loadNotebookControllers();
        const items = await this.notebookControllerManager.kernelConnections;
        const metadata = items.find((item) => item.id === spec.id);
        if (!metadata) {
            throw new Error('Not found');
        }
        const controllers = this.notebookControllerManager.getRegisteredNotebookControllers();
        const controller = controllers.find((item) => item.connection.id === metadata.id);
        if (!controller) {
            throw new Error('Not found');
        }
        const kernel = await KernelConnector.connectToKernel(
            controller.controller,
            metadata,
            this.serviceContainer,
            { resource: uri, notebook: undefined },
            new DisplayOptions(false),
            this.disposables,
            '3rdPartyExtension'
        );
        let wrappedConnection = JupyterKernelService.wrappedKernelConnections.get(kernel);
        if (wrappedConnection) {
            return wrappedConnection;
        }
        if (!kernel?.session?.kernel) {
            throw new Error('Not found');
        }
        return this.wrapKernelConnection(kernel);
    }
    private wrapKernelConnection(kernel: IKernel): IKernelConnectionInfo {
        if (JupyterKernelService.wrappedKernelConnections.get(kernel)) {
            return JupyterKernelService.wrappedKernelConnections.get(kernel)!;
        }

        const connection = new KernelConnectionWrapper(kernel, this.disposables);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const info = { connection, kernelSocket: new KernelSocketWrapper(kernel) };
        JupyterKernelService.wrappedKernelConnections.set(kernel, info);
        return info;
    }
    private translateKernelConnectionMetadataToExportedType(
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
