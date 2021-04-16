// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
// import { CancellationTokenSource, NotebookController, NotebookDocument } from 'vscode';
import { CancellationTokenSource, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { IConfigurationService, IDisposableRegistry, IExtensions } from '../../common/types';
import { isLocalLaunch } from '../jupyter/kernels/helpers';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';
import { INotebookProvider } from '../types';
import { getNotebookMetadata } from './helpers/helpers';
/**
 * This class tracks notebook documents that are open and the provides NotebookControllers for
 * each of them
 */
@injectable()
export class NotebookControllerManager implements IExtensionSingleActivationService {
    //private controllerMapping = new WeakMap<NotebookDocument, NotebookController>();

    private isLocalLaunch: boolean;
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
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

        this.getKernelConnectionMetadata(document);
        // const kernelConnectionMetadata = this.getKernelConnectionMetadata(document);
    }

    private async onDidCloseNotebookDocument() {
    }

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