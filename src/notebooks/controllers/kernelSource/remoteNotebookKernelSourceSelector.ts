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
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { JupyterServerSelector } from '../../../kernels/jupyter/connection/serverSelector';
import {
    IJupyterServerUriStorage,
    IInternalJupyterUriProvider,
    IJupyterUriProviderRegistration,
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
import { IRemoteNotebookKernelSourceSelector } from '../types';
import { RemoteKernelSelector } from './remoteKernelSelector';
import { QuickPickKernelItemProvider } from './quickPickKernelItemProvider';
import { ConnectionQuickPickItem, IQuickPickKernelItemProvider, MultiStepResult } from './types';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';
import { CreateAndSelectItemFromQuickPick } from './baseKernelSelector';

enum KernelFinderEntityQuickPickType {
    KernelFinder = 'finder',
    LocalServer = 'localServer',
    UriProviderQuickPick = 'uriProviderQuickPick'
}

interface ContributedKernelFinderQuickPickItem extends QuickPickItem {
    type: KernelFinderEntityQuickPickType.KernelFinder;
    serverUri: string;
    idAndHandle: { id: string; handle: string };
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
        @inject(IJupyterUriProviderRegistration)
        private readonly uriProviderRegistration: IJupyterUriProviderRegistration,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection
    ) {}
    public async selectRemoteKernel(
        notebook: NotebookDocument,
        providerId: string
    ): Promise<RemoteKernelConnectionMetadata | undefined> {
        // Reject if it's not our type
        if (notebook.notebookType !== JupyterNotebookView && notebook.notebookType !== InteractiveWindowView) {
            return;
        }
        const provider = await this.uriProviderRegistration.getProvider(providerId);
        if (!provider) {
            throw new Error(`Remote Provider Id ${providerId} not found`);
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
            if (state.source && state.selection?.type === 'connection') {
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
        const servers = this.kernelFinder.registered.filter(
            (info) => info.kind === 'remote' && (info as IRemoteKernelFinder).serverUri.uri
        ) as IRemoteKernelFinder[];
        const items: (ContributedKernelFinderQuickPickItem | KernelProviderItemsQuickPickItem | QuickPickItem)[] = [];

        for (const server of servers) {
            // remote server
            const savedURI = await this.serverUriStorage.get(server.serverUri.provider);
            if (token.isCancellationRequested) {
                return;
            }

            const idAndHandle = savedURI?.provider;
            if (idAndHandle && idAndHandle.id === provider.id) {
                // local server
                const uriDate = new Date(savedURI.time);
                items.push({
                    type: KernelFinderEntityQuickPickType.KernelFinder,
                    kernelFinderInfo: server,
                    serverUri: savedURI.uri,
                    idAndHandle,
                    label: server.displayName,
                    detail: DataScience.jupyterSelectURIMRUDetail(uriDate),
                    buttons: provider.removeHandle
                        ? [
                              {
                                  iconPath: new ThemeIcon('trash'),
                                  tooltip: DataScience.removeRemoteJupyterServerEntryInQuickPick
                              }
                          ]
                        : []
                });
            }
        }

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
                    return this.selectKernelFromKernelFinder.bind(this, selectedSource.kernelFinderInfo, token);
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
    ) {
        if (!selectedSource.provider.handleQuickPick || token.isCancellationRequested) {
            return;
        }

        const handle = await selectedSource.provider.handleQuickPick(selectedSource.originalItem, true);
        if (!handle || token.isCancellationRequested) {
            return;
        }
        if (handle === 'back') {
            throw InputFlowAction.back;
        }

        const finderPromise = (async () => {
            if (token.isCancellationRequested) {
                throw new CancellationError();
            }
            const serverId = { id: selectedSource.provider.id, handle };
            await this.serverSelector.addJupyterServer(serverId);
            if (token.isCancellationRequested) {
                throw new CancellationError();
            }
            // Wait for the remote provider to be registered.
            return new Promise<IContributedKernelFinder>((resolve) => {
                const found = this.kernelFinder.registered.find(
                    (f) =>
                        f.kind === 'remote' &&
                        (f as IRemoteKernelFinder).serverUri.provider.id === serverId.id &&
                        (f as IRemoteKernelFinder).serverUri.provider.handle === serverId.handle
                );
                if (found) {
                    return resolve(found);
                }
                this.kernelFinder.onDidChangeRegistrations(
                    (e) => {
                        const found = e.added.find(
                            (f) =>
                                f.kind === 'remote' &&
                                (f as IRemoteKernelFinder).serverUri.provider.id === serverId.id &&
                                (f as IRemoteKernelFinder).serverUri.provider.handle === serverId.handle
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

        const provider = new QuickPickKernelItemProvider(
            state.notebook,
            ContributedKernelFinderKind.Remote,
            finderPromise,
            undefined,
            this.jupyterConnection
        );
        provider.status = 'discovering';
        state.disposables.push(provider);

        return this.selectKernel.bind(this, provider, token);
    }
    private selectKernelFromKernelFinder(
        source: IContributedKernelFinder<KernelConnectionMetadata>,
        token: CancellationToken,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ) {
        state.source = source;
        const provider = new QuickPickKernelItemProvider(
            state.notebook,
            source.kind,
            source,
            undefined,
            this.jupyterConnection
        );
        state.disposables.push(provider);
        return this.selectKernel(provider, token, multiStep, state);
    }
    /**
     * Second stage of the multistep to pick a kernel
     */
    private async selectKernel(
        provider: IQuickPickKernelItemProvider,
        token: CancellationToken,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ): Promise<InputStep<MultiStepResult> | void> {
        if (token.isCancellationRequested) {
            return;
        }
        const selector = new RemoteKernelSelector(provider, token);
        state.disposables.push(selector);
        const quickPickFactory: CreateAndSelectItemFromQuickPick = (options) => {
            const { quickPick, selection } = multiStep.showLazyLoadQuickPick({
                ...options,
                placeholder: '',
                matchOnDescription: true,
                matchOnDetail: true,
                supportBackInFirstStep: true,
                activeItem: undefined,
                ignoreFocusOut: false
            });
            return { quickPick, selection: selection as Promise<ConnectionQuickPickItem | QuickPickItem> };
        };
        const result = await selector.selectKernel(quickPickFactory);
        if (result?.selection === 'controller') {
            state.source = result.finder;
            state.selection = { type: 'connection', connection: result.connection };
        } else if (result?.selection === 'userPerformedSomeOtherAction') {
            state.selection = { type: 'userPerformedSomeOtherAction' };
        }
    }
}
