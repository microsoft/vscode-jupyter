// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    EventEmitter,
    NotebookDocument,
    QuickPick,
    QuickPickItem,
    QuickPickItemKind,
    ThemeIcon,
    notebooks
} from 'vscode';
import { IContributedKernelFinder } from '../../../kernels/internalTypes';
import { JupyterServerSelector } from '../../../kernels/jupyter/connection/serverSelector';
import {
    IJupyterServerUriStorage,
    IInternalJupyterUriProvider,
    IRemoteKernelFinder
} from '../../../kernels/jupyter/types';
import { IKernelFinder, KernelConnectionMetadata, RemoteKernelConnectionMetadata } from '../../../kernels/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import {
    IMultiStepInput,
    InputFlowAction,
    InputStep,
    IQuickPickParameters,
    MultiStepInput
} from '../../../platform/common/utils/multiStepInput';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IConnectionDisplayDataProvider, IRemoteNotebookKernelSourceSelector } from '../types';
import { MultiStepResult } from './types';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';
import { generateIdFromRemoteProvider } from '../../../kernels/jupyter/jupyterUtils';
import { BaseProviderBasedQuickPick, IQuickPickItemProvider } from '../../../platform/common/providerBasedQuickPick';
import { PreferredKernelConnectionService } from '../preferredKernelConnectionService';
import { traceError } from '../../../platform/logging';
import { noop } from '../../../platform/common/utils/misc';

enum KernelFinderEntityQuickPickType {
    KernelFinder = 'finder',
    LocalServer = 'localServer',
    UriProviderQuickPick = 'uriProviderQuickPick'
}

interface ContributedKernelFinderQuickPickItem extends QuickPickItem {
    type: KernelFinderEntityQuickPickType.KernelFinder;
    serverUri: string;
    idAndHandle: { id: string; handle: string; extensionId: string };
    kernelFinderInfo: IContributedKernelFinder;
}

interface KernelProviderItemsQuickPickItem extends QuickPickItem {
    /**
     * If this is the only quick pick item in the list and this is true, then this item will be selected by default.
     */
    default?: boolean;
    type: KernelFinderEntityQuickPickType.UriProviderQuickPick;
    provider: IInternalJupyterUriProvider;
    originalItem: QuickPickItem & { default?: boolean };
}

// Provides the UI to select a Kernel Source for a given notebook document
@injectable()
export class RemoteNotebookKernelSourceSelector implements IRemoteNotebookKernelSourceSelector {
    private localDisposables: IDisposable[] = [];
    private cancellationTokenSource: CancellationTokenSource | undefined;
    constructor(
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IConnectionDisplayDataProvider) private readonly displayDataProvider: IConnectionDisplayDataProvider
    ) {}
    public async selectRemoteKernel(
        notebook: NotebookDocument,
        provider: IInternalJupyterUriProvider
    ): Promise<RemoteKernelConnectionMetadata | undefined> {
        // Reject if it's not our type
        if (notebook.notebookType !== JupyterNotebookView && notebook.notebookType !== InteractiveWindowView) {
            return;
        }
        this.localDisposables.forEach((d) => d.dispose());
        this.localDisposables = [];
        this.cancellationTokenSource?.cancel();
        this.cancellationTokenSource?.dispose();

        this.cancellationTokenSource = new CancellationTokenSource();
        const appShell = ServiceContainer.instance.get<IApplicationShell>(IApplicationShell);
        const multiStep = new MultiStepInput<MultiStepResult>(appShell);
        const state: MultiStepResult = { disposables: [], notebook };
        try {
            const result = await multiStep.run(
                this.getRemoteServersFromProvider.bind(this, provider, this.cancellationTokenSource.token),
                state
            );
            if (result === InputFlowAction.cancel || state.selection?.type === 'userPerformedSomeOtherAction') {
                throw new CancellationError();
            }

            if (this.cancellationTokenSource.token.isCancellationRequested) {
                disposeAllDisposables(state.disposables);
                return;
            }

            // If we got both parts of the equation, then perform the kernel source and kernel switch
            if (state.selection?.type === 'connection') {
                return state.selection.connection as RemoteKernelConnectionMetadata;
            }
        } finally {
            disposeAllDisposables(state.disposables);
        }
    }
    private async getRemoteServersFromProvider(
        provider: IInternalJupyterUriProvider,
        token: CancellationToken,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ): Promise<InputStep<MultiStepResult> | void> {
        const servers = this.kernelFinder.registered.filter((info) => info.kind === 'remote') as IRemoteKernelFinder[];
        const items: (ContributedKernelFinderQuickPickItem | KernelProviderItemsQuickPickItem | QuickPickItem)[] = [];

        await Promise.all(
            servers
                .filter((s) => s.serverProviderHandle.id === provider.id)
                .map(async (server) => {
                    // remote server
                    const lastUsedTime = (await this.serverUriStorage.getAll()).find(
                        (item) =>
                            generateIdFromRemoteProvider(item.provider) ===
                            generateIdFromRemoteProvider(server.serverProviderHandle)
                    );
                    if (token.isCancellationRequested || !lastUsedTime) {
                        return;
                    }
                    items.push({
                        type: KernelFinderEntityQuickPickType.KernelFinder,
                        kernelFinderInfo: server,
                        idAndHandle: server.serverProviderHandle,
                        label: server.displayName,
                        detail: DataScience.jupyterSelectURIMRUDetail(new Date(lastUsedTime.time)),
                        buttons: provider.removeHandle
                            ? [
                                  {
                                      iconPath: new ThemeIcon('trash'),
                                      tooltip: DataScience.removeRemoteJupyterServerEntryInQuickPick
                                  }
                              ]
                            : []
                    });
                })
        );

        if (provider.getQuickPickEntryItems && provider.handleQuickPick) {
            if (items.length > 0) {
                items.push({ label: 'More', kind: QuickPickItemKind.Separator });
            }

            const newProviderItems: KernelProviderItemsQuickPickItem[] = (await provider.getQuickPickEntryItems()).map(
                (i) => {
                    return {
                        ...i,
                        provider: provider,
                        type: KernelFinderEntityQuickPickType.UriProviderQuickPick,
                        description: undefined,
                        originalItem: i
                    };
                }
            );
            items.push(...newProviderItems);
        }

        const onDidChangeItems = new EventEmitter<typeof items>();
        const defaultSelection = items.length === 1 && 'default' in items[0] && items[0].default ? items[0] : undefined;
        let lazyQuickPick:
            | QuickPick<ContributedKernelFinderQuickPickItem | QuickPickItem | KernelProviderItemsQuickPickItem>
            | undefined;
        let selectedSource:
            | ContributedKernelFinderQuickPickItem
            | KernelProviderItemsQuickPickItem
            | QuickPickItem
            | undefined;
        if (defaultSelection) {
            selectedSource = defaultSelection;
        } else {
            const { quickPick, selection } = multiStep.showLazyLoadQuickPick<
                ContributedKernelFinderQuickPickItem | KernelProviderItemsQuickPickItem | QuickPickItem,
                IQuickPickParameters<
                    ContributedKernelFinderQuickPickItem | KernelProviderItemsQuickPickItem | QuickPickItem
                >
            >({
                items: items,
                placeholder: '',
                title: 'Select a Jupyter Server',
                supportBackInFirstStep: true,
                onDidTriggerItemButton: async (e) => {
                    if ('type' in e.item && e.item.type === KernelFinderEntityQuickPickType.KernelFinder) {
                        if (provider.removeHandle) {
                            quickPick.busy = true;
                            await provider.removeHandle(e.item.idAndHandle.handle);
                            quickPick.busy = false;
                            // the serverUriStorage should be refreshed after the handle removal
                            items.splice(items.indexOf(e.item), 1);
                            onDidChangeItems.fire(items.concat([]));
                        }
                    }
                },
                onDidChangeItems: onDidChangeItems.event
            });

            lazyQuickPick = quickPick;
            selectedSource = await selection;
        }

        if (token.isCancellationRequested) {
            return;
        }

        if (selectedSource && 'type' in selectedSource) {
            switch (selectedSource.type) {
                case KernelFinderEntityQuickPickType.KernelFinder:
                    const result = await this.selectRemoteKernelFromPicker(
                        state.notebook,
                        Promise.resolve(selectedSource.kernelFinderInfo),
                        token
                    ).catch((ex) => traceError(`Failed to select a kernel`, ex));
                    if (result && result === InputFlowAction.back) {
                        return this.getRemoteServersFromProvider(provider, token, multiStep, state);
                    }
                    if (!result || result instanceof InputFlowAction) {
                        throw new CancellationError();
                    }
                    state.selection = { type: 'connection', connection: result };
                    return;
                case KernelFinderEntityQuickPickType.UriProviderQuickPick:
                    const taskNb = notebooks.createNotebookControllerDetectionTask(JupyterNotebookView);
                    try {
                        if (lazyQuickPick) {
                            lazyQuickPick.busy = true;
                        }
                        const ret = await this.selectRemoteServerFromRemoteKernelFinder(selectedSource, state, token);
                        if (lazyQuickPick) {
                            lazyQuickPick.busy = false;
                        }
                        return ret;
                    } catch (ex) {
                        if (ex === InputFlowAction.back && !defaultSelection) {
                            return this.getRemoteServersFromProvider(provider, token, multiStep, state);
                        } else {
                            throw ex;
                        }
                    } finally {
                        taskNb.dispose();
                    }
                default:
                    break;
            }
        }
    }

    private async selectRemoteServerFromRemoteKernelFinder(
        selectedSource: KernelProviderItemsQuickPickItem,
        state: MultiStepResult,
        token: CancellationToken
    ): Promise<void> {
        if (!selectedSource.provider.handleQuickPick || token.isCancellationRequested) {
            return;
        }

        const handle = await selectedSource.provider.handleQuickPick(selectedSource.originalItem, true);
        if (!handle || token.isCancellationRequested) {
            throw new CancellationError();
        }
        if (handle === 'back') {
            throw InputFlowAction.back;
        }

        const finderPromise = (async () => {
            if (token.isCancellationRequested) {
                throw new CancellationError();
            }
            const serverId = {
                id: selectedSource.provider.id,
                handle,
                extensionId: selectedSource.provider.extensionId
            };
            await this.serverSelector.addJupyterServer(serverId);
            if (token.isCancellationRequested) {
                throw new CancellationError();
            }
            // Wait for the remote provider to be registered.
            return new Promise<IContributedKernelFinder>((resolve) => {
                const found = this.kernelFinder.registered.find(
                    (f) =>
                        f.kind === 'remote' &&
                        (f as IRemoteKernelFinder).serverProviderHandle.id === serverId.id &&
                        (f as IRemoteKernelFinder).serverProviderHandle.handle === serverId.handle
                );
                if (found) {
                    return resolve(found);
                }
                this.kernelFinder.onDidChangeRegistrations(
                    (e) => {
                        const found = e.added.find(
                            (f) =>
                                f.kind === 'remote' &&
                                (f as IRemoteKernelFinder).serverProviderHandle.id === serverId.id &&
                                (f as IRemoteKernelFinder).serverProviderHandle.handle === serverId.handle
                        );
                        if (found) {
                            return resolve(found);
                        }
                    },
                    this,
                    state.disposables
                );
            });
        })();

        const result = await this.selectRemoteKernelFromPicker(state.notebook, finderPromise, token).catch((ex) =>
            traceError(`Failed to select a kernel`, ex)
        );
        if (result && result === InputFlowAction.back) {
            return this.selectRemoteServerFromRemoteKernelFinder(selectedSource, state, token);
        }
        if (!result || result instanceof InputFlowAction) {
            throw new CancellationError();
        }
        state.selection = { type: 'connection', connection: result };
        return;
    }
    private async selectRemoteKernelFromPicker(
        notebook: NotebookDocument,
        source: Promise<IContributedKernelFinder<KernelConnectionMetadata>>,
        token: CancellationToken
    ) {
        const provider = source.then((source) => {
            const onDidChangeEvent = new EventEmitter<void>();
            source.onDidChangeKernels(() => onDidChangeEvent.fire());
            return <IQuickPickItemProvider<KernelConnectionMetadata>>{
                title: DataScience.kernelPickerSelectKernelFromRemoteTitle(source.displayName),
                get items() {
                    return source.kernels;
                },
                get status() {
                    return source.status;
                },
                onDidChange: onDidChangeEvent.event,
                onDidChangeStatus: source.onDidChangeStatus,
                refresh: () => source.refresh()
            };
        });
        const quickPickFactory = (item: KernelConnectionMetadata) => {
            const displayData = this.displayDataProvider.getDisplayData(item);
            return <QuickPickItem>{
                label: displayData.label,
                description: displayData.description,
                detail: displayData.detail
            };
        };
        const getCategory = (item: KernelConnectionMetadata) => {
            return <{ label: string; sortKey?: string }>{
                label: this.displayDataProvider.getDisplayData(item).category || 'Other'
            };
        };
        const remoteKernelPicker = new BaseProviderBasedQuickPick(provider, quickPickFactory, getCategory, {
            supportsBack: true
        });
        const preferred = new PreferredKernelConnectionService(this.jupyterConnection);
        source
            .then((source) => preferred.findPreferredRemoteKernelConnection(notebook, source, token))
            .then((item) => (remoteKernelPicker.selected = item))
            .catch((ex) => traceError(`Failed to determine preferred remote kernel`, ex));
        return remoteKernelPicker.selectItem(token);
    }
}
