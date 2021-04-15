// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { CancellationTokenSource, NotebookKernelOptions, Uri } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../../common/constants';
import { traceInfo } from '../../common/logger';
import { IConfigurationService, IExtensionContext, IExtensions, IPathUtils } from '../../common/types';
import {
    areKernelConnectionsEqual,
    getDescriptionOfKernelConnection,
    getDetailOfKernelConnection,
    getDisplayNameOrNameOfKernelConnection,
    isLocalLaunch
} from '../jupyter/kernels/helpers';
import { IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { INotebookProvider } from '../types';
import { VSCodeNotebookKernelOptions } from './kernelOptions';

// This class is responsible at activation for registering all the kernels that we
// provide for native notebooks
@injectable()
export class KernelCreator implements IExtensionSingleActivationService {
    private isLocalLaunch: boolean;
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(UseVSCodeNotebookEditorApi) private readonly useNativeNb: boolean,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IRemoteKernelFinder) private readonly remoteKernelFinder: IRemoteKernelFinder,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils
    ) {
        this.isLocalLaunch = isLocalLaunch(this.configuration);
    }
    public async activate(): Promise<void> {
        if (this.useNativeNb) {
            const notebookKernelOptions = await this.getNotebookKernelOptions();
            await this.createNotebookKernels(notebookKernelOptions);
        }
    }

    // Get our list of NotebookKernelOptions that we need to use to create kernels
    private async getNotebookKernelOptions(): Promise<NotebookKernelOptions[]> {
        let kernels: KernelConnectionMetadata[] = [];
        let preferred: KernelConnectionMetadata | undefined;

        // IANHU: Not a real token, how to handle cancellation here?
        const token = new CancellationTokenSource().token;

        // IANHU: Set Preferred here?

        // IANHU: This used to be the document, but what is it here if we don't have a document?
        // IANHU: Undefined works as a resource, try working with that
        //const targetResource = undefined;
        const targetResource = Uri.file('/Users/ianhuff/Documents/DataScience/DebuggingDemo/manualTestFile.ipynb');

        if (this.isLocalLaunch) {
            kernels = await this.localKernelFinder.listKernels(targetResource, token);

            // IANHU: Another preferred check here?

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
                resource: targetResource,
                disableUI: false,
                localOnly: false
            });

            kernels = await this.remoteKernelFinder.listKernels(targetResource, connection, token);

            // IANHU: Another Preferred check here
        }

        return kernels.map((k) => {
            return new VSCodeNotebookKernelOptions(
                getDisplayNameOrNameOfKernelConnection(k),
                getDescriptionOfKernelConnection(k),
                getDetailOfKernelConnection(k, this.pathUtils),
                k,
                areKernelConnectionsEqual(k, preferred),
                this.kernelProvider,
                this.notebook,
                this.context,
                this.preferredRemoteKernelIdProvider,
                this.commandManager
            );
        });

        // Map kernels into result type
        // return kernels.map((k) => {
        // return new VSCodeNotebookKernelMetadata(
        // getDisplayNameOrNameOfKernelConnection(k),
        // getDescriptionOfKernelConnection(k),
        // getDetailOfKernelConnection(k, this.pathUtils),
        // k,
        // areKernelConnectionsEqual(k, preferred),
        // this.kernelProvider,
        // this.notebook,
        // this.context,
        // this.preferredRemoteKernelIdProvider,
        // this.commandManager
        // );
        // });
        // return [
        // {
        // id: 'testid',
        // label: 'testlabel',
        // selector: { viewType: 'jupyter-notebook' },
        // supportedLanguages: ['python'],
        // hasExecutionOrder: true,
        // executeHandler: (executions) => {
        // for (let exec of executions) {
        // traceInfo(exec.document.uri.toString());
        // }
        // }
        // },
        // {
        // id: 'testid2',
        // label: 'testlabel2',
        // selector: { viewType: 'jupyter-notebook' },
        // supportedLanguages: ['python'],
        // hasExecutionOrder: true,
        // executeHandler: (executions) => {
        // for (let exec of executions) {
        // traceInfo(exec.document.uri.toString());
        // }
        // }
        // }
        // ];
    }

    private async createNotebookKernels(notebookKernelOptions: NotebookKernelOptions[]) {
        const kernels = notebookKernelOptions.map(this.notebook.createNotebookKernel);
        kernels.forEach((kernel) => {
            traceInfo(kernel.label);
        });
    }
}
