// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
// tslint:disable-next-line: no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { CancellationToken, Event, EventEmitter, Uri } from 'vscode';
import {
    NotebookCell,
    NotebookDocument,
    NotebookKernel as VSCNotebookKernel,
    NotebookKernelProvider
} from '../../../../types/vscode-proposed';
import { IPythonExtensionChecker } from '../../api/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { traceInfo } from '../../common/logger';
import { IDisposableRegistry } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { IInterpreterService } from '../../interpreter/contracts';
import { JupyterServerConnectionService } from '../../remote/connection/remoteConnectionsService';
import { IJupyterServerConnectionService } from '../../remote/ui/types';
import { captureTelemetry } from '../../telemetry';
import { Telemetry } from '../constants';
import { areKernelConnectionsEqual } from '../jupyter/kernels/helpers';
import { KernelSelectionProvider } from '../jupyter/kernels/kernelSelections';
import { KernelSelector } from '../jupyter/kernels/kernelSelector';
import { KernelSwitcher } from '../jupyter/kernels/kernelSwitcher';
import {
    DefaultKernelConnectionMetadata,
    getKernelConnectionId,
    IKernel,
    IKernelProvider,
    IKernelSpecQuickPickItem,
    KernelConnectionMetadata,
    KernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata
} from '../jupyter/kernels/types';
import { INotebookStorageProvider } from '../notebookStorage/notebookStorageProvider';
import { IJupyterSessionManagerFactory, INotebook, INotebookProvider, IRawNotebookSupportedService } from '../types';
import {
    getNotebookMetadata,
    isJupyterNotebook,
    isPythonNotebook,
    updateKernelInfoInNotebookMetadata,
    updateKernelInNotebookMetadata
} from './helpers/helpers';

export class VSCodeNotebookKernelMetadata implements VSCNotebookKernel {
    get preloads(): Uri[] {
        return [];
    }
    get id() {
        return getKernelConnectionId(this.selection);
    }
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly detail: string,
        public readonly selection: Readonly<KernelConnectionMetadata>,
        public readonly isPreferred: boolean,
        private readonly kernelProvider: IKernelProvider,
        private readonly notebook: IVSCodeNotebook
    ) {}
    public executeCell(doc: NotebookDocument, cell: NotebookCell) {
        traceInfo('Execute Cell in KernelProvider.ts');
        const kernel = this.kernelProvider.getOrCreate(cell.notebook.uri, { metadata: this.selection });
        if (kernel) {
            this.updateKernelInfoInNotebookWhenAvailable(kernel, doc);
            kernel.executeCell(cell).catch(noop);
        }
    }
    public executeAllCells(document: NotebookDocument) {
        const kernel = this.kernelProvider.getOrCreate(document.uri, { metadata: this.selection });
        if (kernel) {
            this.updateKernelInfoInNotebookWhenAvailable(kernel, document);
            kernel.executeAllCells(document).catch(noop);
        }
    }
    public cancelCellExecution(_: NotebookDocument, cell: NotebookCell) {
        this.kernelProvider.get(cell.notebook.uri)?.interrupt(); // NOSONAR
    }
    public cancelAllCellsExecution(document: NotebookDocument) {
        this.kernelProvider.get(document.uri)?.interrupt(); // NOSONAR
    }
    private updateKernelInfoInNotebookWhenAvailable(kernel: IKernel, doc: NotebookDocument) {
        const disposable = kernel.onStatusChanged(() => {
            if (!kernel.info) {
                return;
            }
            const editor = this.notebook.notebookEditors.find((item) => item.document === doc);
            if (!editor || editor.kernel?.id !== this.id) {
                return;
            }
            disposable.dispose();
            updateKernelInfoInNotebookMetadata(doc, kernel.info);
        });
    }
}

@injectable()
export class VSCodeKernelPickerProvider implements NotebookKernelProvider {
    public get onDidChangeKernels(): Event<NotebookDocument | undefined> {
        return this._onDidChangeKernels.event;
    }
    private readonly _onDidChangeKernels = new EventEmitter<NotebookDocument | undefined>();
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
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IRawNotebookSupportedService) private readonly rawNotebookSupported: IRawNotebookSupportedService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IJupyterServerConnectionService)
        private readonly remoteConnections: JupyterServerConnectionService,
        @inject(IJupyterSessionManagerFactory) private readonly sessionFactory: IJupyterSessionManagerFactory
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
    @captureTelemetry(Telemetry.KernelProviderPerf)
    public async provideKernels(
        document: NotebookDocument,
        token: CancellationToken
    ): Promise<VSCodeNotebookKernelMetadata[]> {
        let kernels: VSCodeNotebookKernelMetadata[];
        if (this.remoteConnections.findConnection(document.uri)) {
            kernels = await this.provideRemoteKernels(document, token);
        } else {
            kernels = await this.provideLocalKernels(document, token);
        }

        kernels.sort((a, b) => {
            if (a.label > b.label) {
                return 1;
            } else if (a.label === b.label) {
                return 0;
            } else {
                return -1;
            }
        });
        return kernels;
    }
    // tslint:disable-next-line: cyclomatic-complexity
    public async provideRemoteKernels(
        document: NotebookDocument,
        token: CancellationToken
    ): Promise<VSCodeNotebookKernelMetadata[]> {
        const connection = this.remoteConnections.findConnection(document.uri);
        if (!connection) {
            return [];
        }
        const sessionManager = await this.sessionFactory.create(connection.connection, true);

        const result = await Promise.all([
            this.kernelSelector.getPreferredKernelForRemoteConnection(
                document.uri,
                sessionManager,
                getNotebookMetadata(document),
                token
            ),
            this.kernelSelectionProvider.getKernelSelectionsForRemoteSession(document.uri, sessionManager, token),
            this.interpreterService.getActiveInterpreter(document.uri),
            sessionManager.getDefaultKernel()
        ]);
        if (token.isCancellationRequested) {
            return [];
        }
        let [preferredKernelInfo] = result;
        const [, kernels, activeInterpreter, defaultKernel] = result;
        if (!preferredKernelInfo && defaultKernel) {
            preferredKernelInfo = kernels.find(
                (item) =>
                    item.selection.kind === 'startUsingKernelSpec' && item.selection.kernelSpec.name === defaultKernel
            )?.selection;
        }
        const preferredKernel = this.createNotebookKernelMetadataFromPreferredRemoteKernel(
            preferredKernelInfo,
            kernels
        );

        // Default the interpreter to the local interpreter (if none is provided).
        const withInterpreter = kernels.map((kernel) => {
            const selection = cloneDeep(kernel.selection); // Always clone, so we can make changes to this.
            selection.interpreter = selection.interpreter || activeInterpreter;
            return { ...kernel, selection };
        });

        // Turn this into our preferred list.
        const existingItem = new Set<string>();
        const mapped = withInterpreter
            .map((kernel) => {
                return new VSCodeNotebookKernelMetadata(
                    kernel.label,
                    kernel.description || '',
                    kernel.detail || '',
                    kernel.selection,
                    false,
                    this.kernelProvider,
                    this.notebook
                );
            })
            .filter((item) => {
                if (existingItem.has(item.id)) {
                    return false;
                }
                if (preferredKernel?.id === item.id) {
                    return false;
                }
                existingItem.add(item.id);
                return true;
            });

        if (preferredKernel) {
            mapped.push(preferredKernel);
        }
        return mapped;
    }
    public async provideLocalKernels(
        document: NotebookDocument,
        token: CancellationToken
    ): Promise<VSCodeNotebookKernelMetadata[]> {
        this.isRawNotebookSupported =
            this.isRawNotebookSupported || this.rawNotebookSupported.isSupportedForLocalLaunch();
        const rawSupported = await this.isRawNotebookSupported;
        const isPythonNb = isPythonNotebook(getNotebookMetadata(document));
        const [preferredKernel, kernels, activeInterpreter] = await Promise.all([
            this.getPreferredKernel(document, token),
            this.kernelSelector.getKernelSelectionsForLocalSession(
                document.uri,
                rawSupported ? 'raw' : 'jupyter',
                undefined,
                token
            ),
            isPythonNb && this.extensionChecker.isPythonExtensionInstalled
                ? this.interpreterService.getActiveInterpreter(document.uri)
                : Promise.resolve(undefined)
        ]);
        if (token.isCancellationRequested) {
            return [];
        }

        // Default the interpreter to the local interpreter (if none is provided).
        const withInterpreter = kernels.map((kernel) => {
            const selection = cloneDeep(kernel.selection); // Always clone, so we can make changes to this.
            selection.interpreter = selection.interpreter || activeInterpreter;
            return { ...kernel, selection };
        });

        // Turn this into our preferred list.
        const existingItem = new Set<string>();
        const mapped = withInterpreter
            .map((kernel) => {
                return new VSCodeNotebookKernelMetadata(
                    kernel.label,
                    kernel.description || '',
                    kernel.detail || '',
                    kernel.selection,
                    areKernelConnectionsEqual(kernel.selection, preferredKernel),
                    this.kernelProvider,
                    this.notebook
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
            const languages = document.cells.map((c) => c.language);
            // Find the first that matches on language
            const indexOfKernelMatchingDocumentLanguage = kernels.findIndex((k) =>
                languages.find((l) => l === k.selection.kernelSpec?.language)
            );

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
                        this.notebook
                    )
                );
            }
        }
        return mapped;
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
                this.notebook
            );
        } else if (preferredKernel.kind === 'connectToLiveKernel') {
            return new VSCodeNotebookKernelMetadata(
                preferredKernel.kernelModel.display_name || preferredKernel.kernelModel.name,
                '',
                preferredKernel.kernelModel.name,
                preferredKernel,
                true,
                this.kernelProvider,
                this.notebook
            );
        } else {
            return new VSCodeNotebookKernelMetadata(
                preferredKernel.kernelSpec.display_name,
                '',
                preferredKernel.kernelSpec.name,
                preferredKernel,
                true,
                this.kernelProvider,
                this.notebook
            );
        }
    }
    private createNotebookKernelMetadataFromPreferredRemoteKernel(
        preferredKernelInfo?:
            | LiveKernelConnectionMetadata
            | KernelSpecConnectionMetadata
            | DefaultKernelConnectionMetadata,
        preferredInfFromQuick?: IKernelSpecQuickPickItem<LiveKernelConnectionMetadata | KernelSpecConnectionMetadata>[]
    ): VSCodeNotebookKernelMetadata | undefined {
        if (!preferredKernelInfo) {
            return;
        }
        const preferredInfoFromQuickPick = preferredInfFromQuick?.find(
            (item) => getKernelConnectionId(item.selection) === getKernelConnectionId(preferredKernelInfo!)
        );
        switch (preferredKernelInfo.kind) {
            case 'connectToLiveKernel':
                return new VSCodeNotebookKernelMetadata(
                    preferredInfoFromQuickPick?.label || preferredKernelInfo.kernelModel.name,
                    preferredInfoFromQuickPick?.detail ||
                        preferredKernelInfo.kernelModel.display_name ||
                        preferredKernelInfo.kernelModel.name,
                    preferredInfoFromQuickPick?.description || preferredKernelInfo.kernelModel.name,
                    preferredKernelInfo,
                    true,
                    this.kernelProvider,
                    this.notebook
                );
            case 'startUsingKernelSpec':
                return new VSCodeNotebookKernelMetadata(
                    preferredInfoFromQuickPick?.label || preferredKernelInfo.kernelSpec.name,
                    preferredInfoFromQuickPick?.detail ||
                        preferredKernelInfo.kernelSpec.display_name ||
                        preferredKernelInfo.kernelSpec.name,
                    preferredInfoFromQuickPick?.description || preferredKernelInfo.kernelSpec.name,
                    preferredKernelInfo,
                    true,
                    this.kernelProvider,
                    this.notebook
                );

            default:
                break;
        }
    }
    private async getPreferredKernel(document: NotebookDocument, token: CancellationToken) {
        // If we already have a kernel selected, then return that.
        const editor =
            this.notebook.notebookEditors.find((e) => e.document === document) ||
            (this.notebook.activeNotebookEditor?.document === document
                ? this.notebook.activeNotebookEditor
                : undefined);
        if (editor && editor.kernel && editor.kernel instanceof VSCodeNotebookKernelMetadata) {
            return editor.kernel.selection;
        }
        this.isRawNotebookSupported =
            this.isRawNotebookSupported || this.rawNotebookSupported.isSupportedForLocalLaunch();
        const rawSupported = await this.isRawNotebookSupported;

        return this.kernelSelector.getPreferredKernelForLocalConnection(
            document.uri,
            rawSupported ? 'raw' : 'jupyter',
            undefined,
            getNotebookMetadata(document),
            true,
            token,
            true
        );
    }
    private async onDidChangeActiveNotebookKernel({
        document,
        kernel
    }: {
        document: NotebookDocument;
        kernel: VSCNotebookKernel | undefined;
    }) {
        // We're only interested in our Jupyter Notebooks & our kernels.
        if (!kernel || !(kernel instanceof VSCodeNotebookKernelMetadata) || !isJupyterNotebook(document)) {
            return;
        }
        const selectedKernelConnectionMetadata = kernel.selection;

        const model = this.storageProvider.get(document.uri);
        if (!model || !model.isTrusted) {
            // tslint:disable-next-line: no-suspicious-comment
            // TODO: https://github.com/microsoft/vscode-python/issues/13476
            // If a model is not trusted, we cannot change the kernel (this results in changes to notebook metadata).
            // This is because we store selected kernel in the notebook metadata.
            return;
        }

        const existingKernel = this.kernelProvider.get(document.uri);
        if (existingKernel && areKernelConnectionsEqual(existingKernel.metadata, selectedKernelConnectionMetadata)) {
            return;
        }

        // Make this the new kernel (calling this method will associate the new kernel with this Uri).
        // Calling `getOrCreate` will ensure a kernel is created and it is mapped to the Uri provided.
        // This way other parts of extension have access to this kernel immediately after event is handled.
        this.kernelProvider.getOrCreate(document.uri, {
            metadata: selectedKernelConnectionMetadata
        });

        // Change kernel and update metadata.
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
            // tslint:disable-next-line: no-suspicious-comment
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
