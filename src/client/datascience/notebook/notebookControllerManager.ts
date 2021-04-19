// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { CancellationTokenSource, NotebookController, NotebookDocument, NotebookSelector } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { traceInfo } from '../../common/logger';
import { IConfigurationService, IDisposableRegistry, IExtensionContext, IExtensions } from '../../common/types';
import { isLocalLaunch } from '../jupyter/kernels/helpers';
import { IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { INotebookProvider } from '../types';
import { JupyterNotebookView } from './constants';
import { getNotebookMetadata } from './helpers/helpers';
import { VSCodeNotebookController } from './notebookExecutionHandler';
/**
 * This class tracks notebook documents that are open and the provides NotebookControllers for
 * each of them
 */
@injectable()
export class NotebookControllerManager implements IExtensionSingleActivationService {
    private controllerMapping2 = new WeakMap<NotebookDocument, VSCodeNotebookController[]>();
    private controllerMapping = new WeakMap<NotebookDocument, { selected: VSCodeNotebookController | undefined, controllers: VSCodeNotebookController[] }>();

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
    ) {
        this.isLocalLaunch = isLocalLaunch(this.configuration);
    }

    public async activate(): Promise<void> {
        // Sign up for document either opening or closing
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        this.notebook.onDidCloseNotebookDocument(this.onDidCloseNotebookDocument, this, this.disposables);
    }

    private async onDidOpenNotebookDocument(document: NotebookDocument) {
        // IANHU: Need to do stopwatch and telemetry here?

        const connections = await this.getKernelConnectionMetadata(document);
        this.createNotebookControllers(document, connections);
    }

    private async onDidCloseNotebookDocument(document: NotebookDocument) {
        // See if we have NotebookControllers for this document, if we do, dispose them
        if (this.controllerMapping.has(document)) {
            this.controllerMapping.get(document)?.controllers.forEach(controller => {
                controller.dispose();
            });

            this.controllerMapping.delete(document);
        }
    }

    // For this notebook document, create NotebookControllers for all associated kernel connections
    private createNotebookControllers(document: NotebookDocument, kernelConnections: KernelConnectionMetadata[]) {
        if (this.controllerMapping.get(document)) {
            // IANHU: Should this happen ever?
        }

        // Map KernelConnectionMetadata => NotebookController
        const controllers = kernelConnections.map(value => {
            return this.createNotebookController(document, value);
        });

        // Store our NotebookControllers to dispose on doc close
        this.controllerMapping.set(document, { selected: undefined, controllers: controllers });
    }

    private createNotebookController(document: NotebookDocument, kernelConnection: KernelConnectionMetadata): VSCodeNotebookController {
        // Create notebook selector
        const controller = new VSCodeNotebookController(document, kernelConnection,
            this.notebook, this.commandManager, this.kernelProvider,
            this.preferredRemoteKernelIdProvider, this.context, this.disposables);

        // Hook up to if this NotebookController is selected or de-selected
        //controller.onDidChangeNotebookAssociation(this.onDidChangeNotebookAssociation, this, this.disposables);
        controller.onNotebookControllerSelected(this.onNotebookControllerSelected, this, this.disposables);

        // We are disposing as documents are closed, but do this as well
        this.disposables.push(controller);

        return controller;
    }

    //private onDidChangeNotebookAssociation(_event: { notebook: NotebookDocument, selected: boolean }) {
    //traceInfo('IANHU');
    //}

    // A new NotebookController has been selected, find the associated notebook document and update it
    private onNotebookControllerSelected(event: { notebook: NotebookDocument, controller: VSCodeNotebookController }) {
        if (this.controllerMapping.has(event.notebook)) {
            const currentMapping = this.controllerMapping.get(event.notebook);
            // ! Ok here as we have already checked has above
            this.controllerMapping.set(event.notebook, { controllers: currentMapping?.controllers!, selected: event.controller })
        }
    }

    // For the given NotebookDocument find all associated KernelConnectionMetadata
    private async getKernelConnectionMetadata(document: NotebookDocument): Promise<KernelConnectionMetadata[]> {
        // IANHU: Need a token passed in here?
        const token = new CancellationTokenSource().token;

        let kernels: KernelConnectionMetadata[] = [];
        let preferred: KernelConnectionMetadata | undefined;

        // If we already have a kernel selected, then set that one as preferred
        // IANHU
        // const editor =
        // this.notebook.notebookEditors.find((e) => e.document === document) ||
        // (this.notebook.activeNotebookEditor?.document === document
        // ? this.notebook.activeNotebookEditor
        // : undefined);

        // IANHU
        // if (editor && isJupyterKernel(editor.kernel)) {
        // preferred = (editor.kernel as VSCodeNotebookKernelMetadata).selection;
        // }

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

        return kernels;
    }
}