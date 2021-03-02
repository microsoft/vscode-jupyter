// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    CancellationToken,
    Event,
    EventEmitter,
    NotebookCommunication,
    NotebookDocument,
    NotebookKernel as VSCNotebookKernel
} from 'vscode';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { IConfigurationService, IDisposableRegistry, IExtensionContext, IExtensions, IPathUtils } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { captureTelemetry } from '../../telemetry';
import { sendNotebookOrKernelLanguageTelemetry } from '../common';
import { Telemetry } from '../constants';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../telemetry/telemetry';
import {
    areKernelConnectionsEqual,
    getDescriptionOfKernelConnection,
    getDetailOfKernelConnection,
    getDisplayNameOrNameOfKernelConnection,
    isLocalLaunch
} from '../jupyter/kernels/helpers';
import { KernelSwitcher } from '../jupyter/kernels/kernelSwitcher';
import { IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { INotebookStorageProvider } from '../notebookStorage/notebookStorageProvider';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { INotebook, INotebookProvider } from '../types';
import {
    getNotebookMetadata,
    isJupyterKernel,
    isJupyterNotebook,
    trackKernelInNotebookMetadata
} from './helpers/helpers';
import { VSCodeNotebookKernelMetadata } from './kernelWithMetadata';
import { INotebookKernelProvider, INotebookKernelResolver } from './types';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';

@injectable()
export class VSCodeKernelPickerProvider implements INotebookKernelProvider {
    public get onDidChangeKernels(): Event<NotebookDocument | undefined> {
        return this._onDidChangeKernels.event;
    }
    private readonly _onDidChangeKernels = new EventEmitter<NotebookDocument | undefined>();
    private notebookKernelChangeHandled = new WeakSet<INotebook>();
    private readonly isLocalLaunch: boolean;
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(INotebookStorageProvider) private readonly storageProvider: INotebookStorageProvider,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(KernelSwitcher) private readonly kernelSwitcher: KernelSwitcher,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(INotebookKernelResolver) private readonly kernelResolver: INotebookKernelResolver,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IRemoteKernelFinder) private readonly remoteKernelFinder: IRemoteKernelFinder,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils
    ) {
        this.isLocalLaunch = isLocalLaunch(this.configuration);
        this.notebook.onDidChangeActiveNotebookKernel(this.onDidChangeActiveNotebookKernel, this, disposables);
        this.extensions.onDidChange(this.onDidChangeExtensions, this, disposables);
    }

    public async resolveKernel?(
        kernel: VSCodeNotebookKernelMetadata,
        document: NotebookDocument,
        webview: NotebookCommunication,
        token: CancellationToken
    ): Promise<void> {
        return this.kernelResolver.resolveKernel(kernel, document, webview, token);
    }
    @captureTelemetry(Telemetry.KernelProviderPerf)
    public async provideKernels(
        document: NotebookDocument,
        token: CancellationToken
    ): Promise<VSCodeNotebookKernelMetadata[]> {
        const stopWatch = new StopWatch();
        const kernels = await this.getKernels(document, token);
        if (token.isCancellationRequested) {
            return [];
        }

        // Go through the kernels, removing any dupes
        const existingItem = new Set<string>();
        const mapped = kernels.filter((item) => {
            if (existingItem.has(item.id)) {
                return false;
            }
            existingItem.add(item.id);
            return true;
        });

        // Send telemetry related to the list
        sendKernelListTelemetry(document.uri, mapped, stopWatch);

        mapped.sort((a, b) => {
            if (a.label > b.label) {
                return 1;
            } else if (a.label === b.label) {
                return 0;
            } else {
                return -1;
            }
        });
        return mapped;
    }

    private onDidChangeExtensions() {
        this._onDidChangeKernels.fire(undefined);
    }

    private async getKernels(
        document: NotebookDocument,
        token: CancellationToken
    ): Promise<VSCodeNotebookKernelMetadata[]> {
        let kernels: KernelConnectionMetadata[] = [];
        let preferred: KernelConnectionMetadata | undefined;

        // If we already have a kernel selected, then set that one as preferred
        const editor =
            this.notebook.notebookEditors.find((e) => e.document === document) ||
            (this.notebook.activeNotebookEditor?.document === document
                ? this.notebook.activeNotebookEditor
                : undefined);
        if (editor && isJupyterKernel(editor.kernel)) {
            preferred = (editor.kernel as VSCodeNotebookKernelMetadata).selection;
        }

        if (this.isLocalLaunch) {
            kernels = await this.localKernelFinder.listKernels(document.uri);
            preferred = preferred ?? await this.localKernelFinder.findKernel(document.uri, getNotebookMetadata(document), token);

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

            kernels = await this.remoteKernelFinder.listKernels(document.uri, connection);
            preferred = preferred ?? await this.remoteKernelFinder.findKernel(
                document.uri,
                connection,
                getNotebookMetadata(document),
                token
            );
        }


        // Map kernels into result type
        return kernels.map((k) => {
            return new VSCodeNotebookKernelMetadata(
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
    }

    /**
     * The new kernel is started only when the user attempts to do something with it (like run a cell)
     * This is enforced by the current VS Code UX/workflow.
     */
    private async onDidChangeActiveNotebookKernel({
        document,
        kernel
    }: {
        document: NotebookDocument;
        kernel: VSCNotebookKernel | undefined;
    }) {
        // We're only interested in our Jupyter Notebooks & our kernels.
        if (!isJupyterKernel(kernel) || !isJupyterNotebook(document)) {
            trackKernelInNotebookMetadata(document, undefined);
            return;
        }
        const selectedKernelConnectionMetadata = kernel.selection;

        const model = this.storageProvider.get(document.uri);
        if (!model || !model.isTrusted) {
            // eslint-disable-next-line
            // TODO: https://github.com/microsoft/vscode-python/issues/13476
            // If a model is not trusted, we cannot change the kernel (this results in changes to notebook metadata).
            // This is because we store selected kernel in the notebook metadata.
            return;
        }

        const existingKernel = this.kernelProvider.get(document.uri);
        if (
            existingKernel &&
            areKernelConnectionsEqual(existingKernel.kernelConnectionMetadata, selectedKernelConnectionMetadata)
        ) {
            return;
        }
        switch (kernel.selection.kind) {
            case 'startUsingPythonInterpreter':
                sendNotebookOrKernelLanguageTelemetry(Telemetry.SwitchToExistingKernel, PYTHON_LANGUAGE);
                break;
            case 'connectToLiveKernel':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    kernel.selection.kernelModel.language
                );
                break;
            case 'startUsingKernelSpec':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    kernel.selection.kernelSpec.language
                );
                break;
            default:
            // We don't know as its the default kernel on Jupyter server.
        }
        trackKernelResourceInformation(document.uri, { kernelConnection: kernel.selection });
        sendKernelTelemetryEvent(document.uri, Telemetry.SwitchKernel);
        // If we have an existing kernel, then we know for a fact the user is changing the kernel.
        // Else VSC is just setting a kernel for a notebook after it has opened.
        if (existingKernel) {
            const telemetryEvent = this.isLocalLaunch
                ? Telemetry.SelectLocalJupyterKernel
                : Telemetry.SelectRemoteJupyterKernel;
            sendKernelTelemetryEvent(document.uri, telemetryEvent);
        }
        // Make this the new kernel (calling this method will associate the new kernel with this Uri).
        // Calling `getOrCreate` will ensure a kernel is created and it is mapped to the Uri provided.
        // This will dispose any existing (older kernels) associated with this notebook.
        // This way other parts of extension have access to this kernel immediately after event is handled.
        // Unlike webview notebooks we cannot revert to old kernel if kernel switching fails.
        const newKernel = this.kernelProvider.getOrCreate(document.uri, {
            metadata: selectedKernelConnectionMetadata
        });

        // Auto start the local kernels.
        if (newKernel && !this.configuration.getSettings(undefined).disableJupyterAutoStart && this.isLocalLaunch) {
            newKernel.start({ disableUI: true, document }).catch(noop);
        }

        // Change kernel and update metadata (this can return `undefined`).
        // When calling `kernelProvider.getOrCreate` it will attempt to dispose the current kernel.
        const notebook = await this.notebookProvider.getOrCreateNotebook({
            resource: document.uri,
            identity: document.uri,
            getOnly: true
        });

        // If we have a notebook, change its kernel now
        if (notebook) {
            if (!this.notebookKernelChangeHandled.has(notebook)) {
                this.notebookKernelChangeHandled.add(notebook);
                notebook.onKernelChanged(
                    (e) => {
                        if (notebook.disposed) {
                            return;
                        }
                        trackKernelInNotebookMetadata(document, e);
                    },
                    this,
                    this.disposables
                );
            }
            // eslint-disable-next-line
            // TODO: https://github.com/microsoft/vscode-python/issues/13514
            // We need to handle these exceptions in `siwthKernelWithRetry`.
            // We shouldn't handle them here, as we're already handling some errors in the `siwthKernelWithRetry` method.
            // Adding comment here, so we have context for the requirement.
            this.kernelSwitcher.switchKernelWithRetry(notebook, selectedKernelConnectionMetadata).catch(noop);
        } else {
            trackKernelInNotebookMetadata(document, selectedKernelConnectionMetadata);
        }
    }
}
