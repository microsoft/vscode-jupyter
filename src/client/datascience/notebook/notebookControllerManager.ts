// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { CancellationTokenSource, EventEmitter, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceInfo, traceInfoIf } from '../../common/logger';
import { IConfigurationService, IDisposableRegistry, IExtensionContext, IExtensions } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { sendNotebookOrKernelLanguageTelemetry } from '../common';
import { Telemetry } from '../constants';
import { areKernelConnectionsEqual, isLocalLaunch } from '../jupyter/kernels/helpers';
import { IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';
import { INotebookStorageProvider } from '../notebookStorage/notebookStorageProvider';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { sendNotebookControllerCreateTelemetry } from '../telemetry/kernelTelemetry';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../telemetry/telemetry';
import { INotebookProvider } from '../types';
import { getNotebookMetadata, isJupyterNotebook, trackKernelInNotebookMetadata } from './helpers/helpers';
import { VSCodeNotebookController } from './notebookExecutionHandler';
import { INotebookControllerManager } from './types';
/**
 * This class tracks notebook documents that are open and the provides NotebookControllers for
 * each of them
 */
@injectable()
export class NotebookControllerManager implements INotebookControllerManager, IExtensionSingleActivationService {
    private controllerMapping = new WeakMap<NotebookDocument, { selected: VSCodeNotebookController | undefined, controllers: VSCodeNotebookController[] }>();
    private readonly _onNotebookControllerSelected: EventEmitter<{ notebook: NotebookDocument, controller: VSCodeNotebookController }>;

    private isLocalLaunch: boolean;
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        @inject(IRemoteKernelFinder) private readonly remoteKernelFinder: IRemoteKernelFinder,
        @inject(INotebookStorageProvider) private readonly storageProvider: INotebookStorageProvider,
    ) {
        this._onNotebookControllerSelected = new EventEmitter<{ notebook: NotebookDocument, controller: VSCodeNotebookController }>();
        this.disposables.push(this._onNotebookControllerSelected);
        this.isLocalLaunch = isLocalLaunch(this.configuration);
    }

    get onNotebookControllerSelected() {
        return this._onNotebookControllerSelected.event;
    }

    public async activate(): Promise<void> {
        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        this.notebook.onDidCloseNotebookDocument(this.onDidCloseNotebookDocument, this, this.disposables);

        // Be aware of if we need to re-look for kernels on extension change
        this.extensions.onDidChange(this.onDidChangeExtensions, this, this.disposables);
    }

    private onDidChangeExtensions() {
        // IANHU: Need to invalidate kernels here?
    }

    private async onDidOpenNotebookDocument(document: NotebookDocument) {
        const stopWatch = new StopWatch();

        const connections = await this.getKernelConnectionMetadata(document);
        const controllers = this.createNotebookControllers(document, connections);

        // Send telemetry related to fetching the kernel connections
        sendNotebookControllerCreateTelemetry(document.uri, controllers, stopWatch);

        traceInfoIf(
            !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
            `Providing notebook controllers with length ${controllers.length} for ${document.uri.fsPath}. Preferred is ${controllers.find((m) => m.isPreferred)?.label
            }, ${controllers.find((m) => m.isPreferred)?.id}`
        );
    }

    private onDidCloseNotebookDocument(document: NotebookDocument) {
        // See if we have NotebookControllers for this document, if we do, dispose them
        if (this.controllerMapping.has(document)) {
            this.controllerMapping.get(document)?.controllers.forEach(controller => {
                controller.dispose();
            });

            this.controllerMapping.delete(document);
        }
    }

    // For this notebook document, create NotebookControllers for all associated kernel connections
    private createNotebookControllers(document: NotebookDocument, kernelConnections: { connections: KernelConnectionMetadata[], preferred: KernelConnectionMetadata | undefined }): VSCodeNotebookController[] {
        if (this.controllerMapping.get(document)) {
            // IANHU: Should this happen ever?
        }

        // Map KernelConnectionMetadata => NotebookController
        const controllers = kernelConnections.connections.map(value => {
            return this.createNotebookController(document, value, areKernelConnectionsEqual(value, kernelConnections.preferred));
        });

        // Store our NotebookControllers to dispose on doc close
        this.controllerMapping.set(document, { selected: undefined, controllers: controllers });

        return controllers;
    }

    private createNotebookController(document: NotebookDocument, kernelConnection: KernelConnectionMetadata, preferred: boolean): VSCodeNotebookController {
        // Create notebook selector
        const controller = new VSCodeNotebookController(document, kernelConnection,
            this.notebook, this.commandManager, this.kernelProvider,
            this.preferredRemoteKernelIdProvider, this.context, this.disposables);

        // Setting preferred handled here in the manager as it's meta to the Controllers themselves
        controller.isPreferred = preferred;

        // Hook up to if this NotebookController is selected or de-selected
        controller.onNotebookControllerSelected(this.handleOnNotebookControllerSelected, this, this.disposables);

        // We are disposing as documents are closed, but do this as well
        this.disposables.push(controller);

        return controller;
    }

    // A new NotebookController has been selected, find the associated notebook document and update it
    private async handleOnNotebookControllerSelected(event: { notebook: NotebookDocument, controller: VSCodeNotebookController }) {
        if (this.controllerMapping.has(event.notebook)) {
            const currentMapping = this.controllerMapping.get(event.notebook);
            // ! Ok here as we have already checked has above
            this.controllerMapping.set(event.notebook, { controllers: currentMapping?.controllers!, selected: event.controller })

            // Now actually handle the change
            await this.notebookKernelChanged(event.notebook, event.controller);

            // Now notify out that we have updated a notebooks controller
            this._onNotebookControllerSelected.fire(event);
        }
    }

    // For the given NotebookDocument find all associated KernelConnectionMetadata
    private async getKernelConnectionMetadata(document: NotebookDocument): Promise<{ connections: KernelConnectionMetadata[], preferred: KernelConnectionMetadata | undefined }> {
        // IANHU: Need a token passed in here?
        const token = new CancellationTokenSource().token;

        let kernels: KernelConnectionMetadata[] = [];
        let preferred: KernelConnectionMetadata | undefined;

        // If we already have a kernel selected, set that one as preferred
        if (this.controllerMapping.has(document)) {
            preferred = this.controllerMapping.get(document)?.selected?.connection;
        }

        if (this.isLocalLaunch) {
            kernels = await this.localKernelFinder.listKernels(document.uri, token);
            preferred =
                preferred ??
                (await this.localKernelFinder.findKernel(document.uri, getNotebookMetadata(document), token));

            // We need to filter out those items that are for other extensions.
            kernels = kernels.filter((r) => {
                if (r.kind !== 'connectToLiveKernel' && r.kernelSpec) {
                    if (
                        r.kernelSpec.metadata?.vscode?.extension_id &&
                        this.extensions.getExtension(r.kernelSpec.metadata?.vscode?.extension_id)
                    ) {
                        return false;
                    }
                }
                return true;
            });
        } else {
            const connection = await this.notebookProvider.connect({
                getOnly: false,
                resource: document.uri,
                disableUI: false,
                localOnly: false
            });

            kernels = await this.remoteKernelFinder.listKernels(document.uri, connection, token);
            preferred =
                preferred ??
                (await this.remoteKernelFinder.findKernel(
                    document.uri,
                    connection,
                    getNotebookMetadata(document),
                    token
                ));
        }

        return { connections: kernels, preferred };
    }

    private async notebookKernelChanged(document: NotebookDocument, controller: VSCodeNotebookController) {
        // We're only interested in our Jupyter Notebooks.
        if (!isJupyterNotebook(document)) {
            trackKernelInNotebookMetadata(document, undefined);
            return;
        }
        const selectedKernelConnectionMetadata = controller.connection;

        const model = this.storageProvider.get(document.uri);
        if (model && model.isTrusted === false) {
            // eslint-disable-next-line
            // TODO: https://github.com/microsoft/vscode-python/issues/13476
            // If a model is not trusted, we cannot change the kernel (this results in changes to notebook metadata).
            // This is because we store selected kernel in the notebook metadata.
            traceInfoIf(!!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT, 'Kernel not switched, model not trusted');
            return;
        }

        const existingKernel = this.kernelProvider.get(document.uri);
        if (
            existingKernel &&
            areKernelConnectionsEqual(existingKernel.kernelConnectionMetadata, selectedKernelConnectionMetadata)
        ) {
            traceInfo('Switch kernel did not change kernel.');
            return;
        }
        switch (controller.connection.kind) {
            case 'startUsingPythonInterpreter':
                sendNotebookOrKernelLanguageTelemetry(Telemetry.SwitchToExistingKernel, PYTHON_LANGUAGE);
                break;
            case 'connectToLiveKernel':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    controller.connection.kernelModel.language
                );
                break;
            case 'startUsingKernelSpec':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    controller.connection.kernelSpec.language
                );
                break;
            default:
            // We don't know as its the default kernel on Jupyter server.
        }
        trackKernelResourceInformation(document.uri, { kernelConnection: controller.connection });
        sendKernelTelemetryEvent(document.uri, Telemetry.SwitchKernel);
        // If we have an existing kernel, then we know for a fact the user is changing the kernel.
        // Else VSC is just setting a kernel for a notebook after it has opened.
        if (existingKernel) {
            const telemetryEvent = this.isLocalLaunch
                ? Telemetry.SelectLocalJupyterKernel
                : Telemetry.SelectRemoteJupyterKernel;
            sendKernelTelemetryEvent(document.uri, telemetryEvent);
        }

        trackKernelInNotebookMetadata(document, selectedKernelConnectionMetadata);

        // Make this the new kernel (calling this method will associate the new kernel with this Uri).
        // Calling `getOrCreate` will ensure a kernel is created and it is mapped to the Uri provided.
        // This will dispose any existing (older kernels) associated with this notebook.
        // This way other parts of extension have access to this kernel immediately after event is handled.
        // Unlike webview notebooks we cannot revert to old kernel if kernel switching fails.
        const newKernel = this.kernelProvider.getOrCreate(document.uri, {
            metadata: selectedKernelConnectionMetadata
        });
        traceInfo(`KernelProvider switched kernel to id = ${newKernel?.kernelConnectionMetadata.id}}`);

        // Before we start the notebook, make sure the metadata is set to this new kernel.
        trackKernelInNotebookMetadata(document, selectedKernelConnectionMetadata);

        // Auto start the local kernels.
        if (newKernel && !this.configuration.getSettings(undefined).disableJupyterAutoStart && this.isLocalLaunch) {
            await newKernel.start({ disableUI: true, document }).catch(noop);
        }
    }
}