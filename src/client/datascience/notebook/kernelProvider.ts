// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { CancellationToken, Event, EventEmitter } from 'vscode';
import {
    NotebookCommunication,
    NotebookDocument,
    NotebookKernel as VSCNotebookKernel
} from '../../../../types/vscode-proposed';
import { IVSCodeNotebook } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { IConfigurationService, IDisposableRegistry, IExtensionContext } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { captureTelemetry } from '../../telemetry';
import { sendNotebookOrKernelLanguageTelemetry } from '../common';
import { Settings, Telemetry } from '../constants';
import { areKernelConnectionsEqual } from '../jupyter/kernels/helpers';
import { KernelSelectionProvider } from '../jupyter/kernels/kernelSelections';
import { KernelSelector } from '../jupyter/kernels/kernelSelector';
import { KernelSwitcher } from '../jupyter/kernels/kernelSwitcher';
import {
    IKernelProvider,
    IKernelSpecQuickPickItem,
    KernelConnectionMetadata,
    KernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../jupyter/kernels/types';
import { INotebookStorageProvider } from '../notebookStorage/notebookStorageProvider';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import {
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    INotebook,
    INotebookProvider,
    IRawNotebookSupportedService
} from '../types';
import {
    getNotebookMetadata,
    isJupyterKernel,
    isJupyterNotebook,
    updateKernelInNotebookMetadata
} from './helpers/helpers';
import { VSCodeNotebookKernelMetadata } from './kernelWithMetadata';
import { INotebookKernelProvider, INotebookKernelResolver } from './types';

@injectable()
export class VSCodeKernelPickerProvider implements INotebookKernelProvider {
    public get onDidChangeKernels(): Event<NotebookDocument | undefined> {
        return this._onDidChangeKernels.event;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get onDidGetFontAwesomeMessage(): Event<{ webview: NotebookCommunication; message: any }> {
        return this._onDidGetFontAwesomeMessage.event;
    }
    private readonly _onDidChangeKernels = new EventEmitter<NotebookDocument | undefined>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly _onDidGetFontAwesomeMessage = new EventEmitter<{ webview: NotebookCommunication; message: any }>();
    private notebookKernelChangeHandled = new WeakSet<INotebook>();
    private isRawNotebookSupported?: Promise<boolean>;
    constructor(
        @inject(KernelSelectionProvider) private readonly kernelSelectionProvider: KernelSelectionProvider,
        @inject(KernelSelector) private readonly kernelSelector: KernelSelector,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(INotebookStorageProvider) private readonly storageProvider: INotebookStorageProvider,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(KernelSwitcher) private readonly kernelSwitcher: KernelSwitcher,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IRawNotebookSupportedService) private readonly rawNotebookSupported: IRawNotebookSupportedService,
        @inject(INotebookKernelResolver) private readonly kernelResolver: INotebookKernelResolver,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IJupyterSessionManagerFactory)
        private readonly jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider
    ) {
        this.kernelSelectionProvider.onDidChangeSelections(
            (e) => {
                if (e) {
                    const doc = this.notebook.notebookDocuments.find((d) => d.uri.fsPath === e.fsPath);
                    if (doc) {
                        return this._onDidChangeKernels.fire(doc);
                    }
                }
                this._onDidChangeKernels.fire(undefined);
            },
            this,
            disposables
        );
        this.notebook.onDidChangeActiveNotebookKernel(this.onDidChangeActiveNotebookKernel, this, disposables);
    }

    public async resolveKernel?(
        kernel: VSCodeNotebookKernelMetadata,
        document: NotebookDocument,
        webview: NotebookCommunication,
        token: CancellationToken
    ): Promise<void> {
        webview.onDidReceiveMessage((m) => this._onDidGetFontAwesomeMessage.fire({ webview, message: m }));
        return this.kernelResolver.resolveKernel(kernel, document, webview, token);
    }
    @captureTelemetry(Telemetry.NativeNotebookKernelSelectionPerf)
    public async provideKernels(
        document: NotebookDocument,
        token: CancellationToken
    ): Promise<VSCodeNotebookKernelMetadata[]> {
        const sessionManager = await this.getJupyterSessionManager();
        if (token.isCancellationRequested) {
            if (sessionManager) {
                await sessionManager.dispose();
            }
            return [];
        }

        const [preferredKernel, kernels] = await Promise.all([
            this.getPreferredKernel(document, token, sessionManager),
            this.getKernelSelections(document, token, sessionManager)
        ]).finally(() => (sessionManager ? sessionManager.dispose() : undefined));
        if (token.isCancellationRequested) {
            return [];
        }

        // Turn this into our preferred list.
        const existingItem = new Set<string>();
        const mapped = kernels
            .map((kernel) => {
                return new VSCodeNotebookKernelMetadata(
                    kernel.label,
                    kernel.description || '',
                    kernel.detail || '',
                    kernel.selection,
                    areKernelConnectionsEqual(kernel.selection, preferredKernel),
                    this.kernelProvider,
                    this.notebook,
                    this.context,
                    this.preferredRemoteKernelIdProvider,
                    this
                );
            })
            .filter((item) => {
                if (existingItem.has(item.id)) {
                    return false;
                }
                existingItem.add(item.id);
                return true;
            });

        // If no preferred kernel set but we have a language, use that to set preferred instead.
        if (!mapped.find((v) => v.isPreferred)) {
            const languages = Array.from(new Set<string>(document.cells.map((c) => c.language)));
            // Find the first that matches on language
            const indexOfKernelMatchingDocumentLanguage = kernels.findIndex((k) => {
                const kernelSpecConnection = k.selection;
                if (kernelSpecConnection.kind === 'startUsingKernelSpec') {
                    return languages.find((l) => l === kernelSpecConnection.kernelSpec.language);
                } else if (kernelSpecConnection.kind === 'connectToLiveKernel') {
                    return languages.find((l) => l === kernelSpecConnection.kernelModel.language);
                } else {
                    return false;
                }
            });
            // If we have a preferred kernel, then add that to the list, & put it on top of the list.
            const preferredKernelMetadata = this.createNotebookKernelMetadataFromPreferredKernel(preferredKernel);
            if (preferredKernelMetadata) {
                mapped.splice(0, 0, preferredKernelMetadata);
            } else if (indexOfKernelMatchingDocumentLanguage >= 0) {
                const kernel = kernels[indexOfKernelMatchingDocumentLanguage];
                mapped.splice(
                    indexOfKernelMatchingDocumentLanguage,
                    1,
                    new VSCodeNotebookKernelMetadata(
                        kernel.label,
                        kernel.description || '',
                        kernel.detail || '',
                        kernel.selection,
                        true,
                        this.kernelProvider,
                        this.notebook,
                        this.context,
                        this.preferredRemoteKernelIdProvider,
                        this
                    )
                );
            }
        }
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
    private async getKernelSelections(
        document: NotebookDocument,
        token: CancellationToken,
        sessionManager?: IJupyterSessionManager
    ): Promise<
        IKernelSpecQuickPickItem<
            | LiveKernelConnectionMetadata
            | KernelSpecConnectionMetadata
            | KernelSpecConnectionMetadata
            | PythonKernelConnectionMetadata
        >[]
    > {
        if (this.isLocalLaunch()) {
            this.isRawNotebookSupported =
                this.isRawNotebookSupported || this.rawNotebookSupported.isSupportedForLocalLaunch();

            const isRawSupported = await this.isRawNotebookSupported;
            if (token.isCancellationRequested) {
                return [];
            }

            return this.kernelSelectionProvider.getKernelSelectionsForLocalSession(
                document.uri,
                isRawSupported ? 'raw' : 'jupyter',
                undefined,
                token
            );
        } else {
            if (!sessionManager) {
                throw new Error('Session Manager not available');
            }
            return this.kernelSelectionProvider.getKernelSelectionsForRemoteSession(
                document.uri,
                sessionManager,
                token
            );
        }
    }
    private async getJupyterSessionManager() {
        if (this.isLocalLaunch()) {
            return;
        }
        // Make sure we have a connection or we can't get remote kernels.
        const connection = await this.notebookProvider.connect({ getOnly: false, disableUI: false, localOnly: false });
        if (!connection) {
            throw new Error('Using remote connection but connection is undefined');
        } else if (connection?.type === 'raw') {
            throw new Error('Using remote connection but connection type is raw');
        } else {
            return this.jupyterSessionManagerFactory.create(connection);
        }
    }
    private isLocalLaunch(): boolean {
        const settings = this.configuration.getSettings(undefined);
        const serverType: string | undefined = settings.jupyterServerType;

        if (!serverType || serverType.toLowerCase() === Settings.JupyterServerLocalLaunch) {
            return true;
        }

        return false;
    }
    private createNotebookKernelMetadataFromPreferredKernel(
        preferredKernel?: KernelConnectionMetadata
    ): VSCodeNotebookKernelMetadata | undefined {
        if (!preferredKernel) {
            return;
        } else if (preferredKernel.kind === 'startUsingDefaultKernel') {
            return;
        } else if (preferredKernel.kind === 'startUsingPythonInterpreter') {
            return new VSCodeNotebookKernelMetadata(
                preferredKernel.interpreter.displayName || preferredKernel.interpreter.path,
                '',
                preferredKernel.interpreter.path,
                preferredKernel,
                true,
                this.kernelProvider,
                this.notebook,
                this.context,
                this.preferredRemoteKernelIdProvider,
                this
            );
        } else if (preferredKernel.kind === 'connectToLiveKernel') {
            return new VSCodeNotebookKernelMetadata(
                preferredKernel.kernelModel.display_name || preferredKernel.kernelModel.name,
                '',
                preferredKernel.kernelModel.name,
                preferredKernel,
                true,
                this.kernelProvider,
                this.notebook,
                this.context,
                this.preferredRemoteKernelIdProvider,
                this
            );
        } else {
            return new VSCodeNotebookKernelMetadata(
                preferredKernel.kernelSpec.display_name,
                '',
                preferredKernel.kernelSpec.name,
                preferredKernel,
                true,
                this.kernelProvider,
                this.notebook,
                this.context,
                this.preferredRemoteKernelIdProvider,
                this
            );
        }
    }
    private async getPreferredKernel(
        document: NotebookDocument,
        token: CancellationToken,
        sessionManager?: IJupyterSessionManager
    ): Promise<KernelConnectionMetadata | undefined> {
        // If we already have a kernel selected, then return that.
        const editor =
            this.notebook.notebookEditors.find((e) => e.document === document) ||
            (this.notebook.activeNotebookEditor?.document === document
                ? this.notebook.activeNotebookEditor
                : undefined);
        if (editor && isJupyterKernel(editor.kernel)) {
            return editor.kernel.selection;
        }

        if (this.isLocalLaunch()) {
            this.isRawNotebookSupported =
                this.isRawNotebookSupported || this.rawNotebookSupported.isSupportedForLocalLaunch();
            const rawSupported = await this.isRawNotebookSupported;
            if (token.isCancellationRequested) {
                return;
            }

            return this.kernelSelector.getPreferredKernelForLocalConnection(
                document.uri,
                rawSupported ? 'raw' : 'jupyter',
                undefined,
                getNotebookMetadata(document),
                true,
                token,
                true
            );
        } else {
            return this.kernelSelector.getPreferredKernelForRemoteConnection(
                document.uri,
                sessionManager,
                getNotebookMetadata(document),
                token
            );
        }
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

        // Make this the new kernel (calling this method will associate the new kernel with this Uri).
        // Calling `getOrCreate` will ensure a kernel is created and it is mapped to the Uri provided.
        // This will dispose any existing (older kernels) associated with this notebook.
        // This way other parts of extension have access to this kernel immediately after event is handled.
        // Unlike webview notebooks we cannot revert to old kernel if kernel switching fails.
        this.kernelProvider.getOrCreate(document.uri, {
            metadata: selectedKernelConnectionMetadata
        });

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
                        updateKernelInNotebookMetadata(document, e);
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
            updateKernelInNotebookMetadata(document, selectedKernelConnectionMetadata);
        }
    }
}
