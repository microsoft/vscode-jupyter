// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { Event, EventEmitter, Uri } from 'vscode';
import {
    IKernelProvider,
    KernelConnectionMetadata as IKernelKernelConnectionMetadata,
    IThirdPartyKernelProvider,
    BaseKernelConnectionMetadata,
    IKernelFinder
} from '../../kernels/types';
import { traceVerbose, traceInfoIfCI } from '../../platform/logging';
import { IDisposableRegistry, IExtensions } from '../../platform/common/types';
import { PromiseChain } from '../../platform/common/utils/async';
import { sendTelemetryEvent } from '../../telemetry';
import { ApiAccessService } from './apiAccessService';
import { ActiveKernel, IExportedKernelService, KernelConnectionMetadata } from '../../api';
import { JupyterNotebookView, Telemetry } from '../../platform/common/constants';
import { KernelConnector } from '../../notebooks/controllers/kernelConnector';
import { DisplayOptions } from '../../kernels/displayOptions';
import { IServiceContainer } from '../../platform/ioc/types';
import { IExportedKernelServiceFactory } from './api';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import type { Session } from '@jupyterlab/services';

@injectable()
export class JupyterKernelServiceFactory implements IExportedKernelServiceFactory {
    private readonly chainedApiAccess = new PromiseChain();
    private readonly extensionApi = new Map<string, IExportedKernelService>();
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IThirdPartyKernelProvider) private readonly thirdPartyKernelProvider: IThirdPartyKernelProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
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
            this.kernelFinder,
            this.thirdPartyKernelProvider,
            this.disposables,
            this.controllerRegistration,
            this.serviceContainer
        );
        this.extensionApi.set(accessInfo.extensionId, service);
        return service;
    }
}

/**
 * Kernel service for 3rd party extensions to talk to.
 */
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
        traceVerbose(`API called from ${this.callingExtensionId}`);
        return this._onDidChangeKernelSpecifications.event;
    }
    public get onDidChangeKernels(): Event<void> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'onDidChangeKernels'
        });
        return this._onDidChangeKernels.event;
    }
    private _status: 'idle' | 'discovering';
    public get status() {
        return this._status;
    }
    private readonly _onDidChangeStatus = new EventEmitter<void>();
    public get onDidChangeStatus(): Event<void> {
        return this._onDidChangeStatus.event;
    }

    constructor(
        private readonly callingExtensionId: string,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IThirdPartyKernelProvider) private readonly thirdPartyKernelProvider: IThirdPartyKernelProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IServiceContainer) private serviceContainer: IServiceContainer
    ) {
        this._status = this.kernelFinder.status;
        this.kernelFinder.onDidChangeStatus(
            () => {
                this._status = this.kernelFinder.status;
                this._onDidChangeStatus.fire();
            },
            this,
            disposables
        );
        this.kernelProvider.onDidDisposeKernel(
            (e) => {
                traceInfoIfCI(
                    `Kernel ${
                        e.kernelConnectionMetadata.id
                    }, ${e.kernelConnectionMetadata.interpreter?.uri.toString()} disposed`
                );
                this._onDidChangeKernels.fire();
            },
            this,
            disposables
        );
        this.kernelProvider.onDidStartKernel(
            (e) => {
                traceInfoIfCI(
                    `Kernel ${
                        e.kernelConnectionMetadata.id
                    }, ${e.kernelConnectionMetadata.interpreter?.uri.toString()} started`
                );
                this._onDidChangeKernels.fire();
            },
            this,
            disposables
        );
        this.thirdPartyKernelProvider.onDidDisposeKernel(
            (e) => {
                traceInfoIfCI(
                    `Third party Kernel ${
                        e.kernelConnectionMetadata.id
                    }, ${e.kernelConnectionMetadata.interpreter?.uri.toString()} disposed`
                );
                this._onDidChangeKernels.fire();
            },
            this,
            disposables
        );
        this.thirdPartyKernelProvider.onDidStartKernel(
            (e) => {
                traceInfoIfCI(
                    `Third party Kernel ${
                        e.kernelConnectionMetadata.id
                    }, ${e.kernelConnectionMetadata.interpreter?.uri.toString()} started`
                );
                this._onDidChangeKernels.fire();
            },
            this,
            disposables
        );
        this.controllerRegistration.onDidChange(() => this._onDidChangeKernelSpecifications.fire(), this, disposables);
    }
    async getKernelSpecifications(): Promise<KernelConnectionMetadata[]> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getKernelSpecifications'
        });
        return this.kernelFinder.kernels.map((item) => this.translateKernelConnectionMetadataToExportedType(item));
    }
    getActiveKernels(): { metadata: KernelConnectionMetadata; uri: Uri | undefined }[] {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getActiveKernels'
        });
        const kernels: { metadata: KernelConnectionMetadata; uri: Uri | undefined; id: string }[] = [];
        const kernelsAlreadyListed = new Set<string>();
        this.kernelProvider.kernels
            .filter(
                (item) => item.startedAtLeastOnce || item.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel'
            )
            .forEach((item) => {
                const kernel = this.kernelProvider.get(item.notebook);
                // When returning list of active sessions, we don't want to return something thats
                // associated with a controller.
                // Note: In VS Code, a controller starts a kernel, however the controller only keeps track of the kernel spec.
                // Hence when we return this connection, we're actually returning the controller's kernel spec & the uri.
                if (kernel && kernel.session?.kernel?.id) {
                    kernelsAlreadyListed.add(kernel.session.kernel.id);
                }
                kernels.push({
                    metadata: this.translateKernelConnectionMetadataToExportedType(item.kernelConnectionMetadata),
                    uri: item.uri,
                    id: item.id
                });
            });
        this.thirdPartyKernelProvider.kernels
            .filter(
                (item) => item.startedAtLeastOnce || item.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel'
            )
            .forEach((item) => {
                const kernel = this.thirdPartyKernelProvider.get(item.uri);
                // When returning list of active sessions, we don't want to return something thats
                // associated with a controller.
                // Note: In VS Code, a controller starts a kernel, however the controller only keeps track of the kernel spec.
                // Hence when we return this connection, we're actually returning the controller's kernel spec & the uri.
                if (kernel && kernel.session?.kernel?.id) {
                    kernelsAlreadyListed.add(kernel.session.kernel.id);
                }
                kernels.push({
                    metadata: this.translateKernelConnectionMetadataToExportedType(item.kernelConnectionMetadata),
                    uri: item.uri,
                    id: item.id
                });
            });
        this.controllerRegistration.registered.forEach((item) => {
            if (item.controller.notebookType !== JupyterNotebookView) {
                return;
            }
            if (item.connection.kind !== 'connectToLiveRemoteKernel') {
                return;
            }
            if (!item.connection.kernelModel.id || kernelsAlreadyListed.has(item.connection.kernelModel.id)) {
                return;
            }
            kernels.push({ metadata: item.connection as KernelConnectionMetadata, uri: undefined, id: item.id });
        });
        return kernels;
    }
    getKernel(uri: Uri): { metadata: KernelConnectionMetadata; connection: Session.ISessionConnection } | undefined {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getKernel'
        });
        const kernel = this.thirdPartyKernelProvider.get(uri) ?? this.kernelProvider.get(uri);
        if (kernel?.session) {
            return {
                metadata: this.translateKernelConnectionMetadataToExportedType(kernel.kernelConnectionMetadata),
                connection: kernel.session
            };
        }
    }
    async startKernel(spec: KernelConnectionMetadata, uri: Uri): Promise<Session.ISessionConnection> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'startKernel'
        });
        return this.startOrConnect(spec, uri);
    }
    async connect(spec: ActiveKernel, uri: Uri): Promise<Session.ISessionConnection> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'connect'
        });
        return this.startOrConnect(spec, uri);
    }
    private async startOrConnect(
        spec: KernelConnectionMetadata | ActiveKernel,
        uri: Uri
    ): Promise<Session.ISessionConnection> {
        const connection = this.kernelFinder.kernels.find((item) => item.id === spec.id);
        if (!connection) {
            throw new Error('Not found');
        }
        const kernel = await KernelConnector.connectToKernel(
            connection,
            this.serviceContainer,
            { resource: uri },
            new DisplayOptions(false),
            this.disposables,
            '3rdPartyExtension'
        );
        if (!kernel?.session) {
            throw new Error('Not found');
        }
        return kernel.session;
    }
    private translateKernelConnectionMetadataToExportedType(
        connection: Readonly<IKernelKernelConnectionMetadata>
    ): KernelConnectionMetadata {
        if (!this.translatedConnections.has(connection)) {
            // By not forcing the cast, we ensure the types are compatible.
            // All we're doing is ensuring the readonly version of one type is compatible with the other.
            // Also, we must return a readonly version of the type (to prevent 3rd party extensions from stuffing this).
            // Else it breaks the Jupyter extension
            // We recast to KernelConnectionMetadata as this has already define its properties as readonly.

            const translatedConnection = Object.freeze(
                BaseKernelConnectionMetadata.fromJSON(connection.toJSON())
            ) as KernelConnectionMetadata;
            this.translatedConnections.set(connection, translatedConnection);
        }
        return this.translatedConnections.get(connection)!;
    }
}
