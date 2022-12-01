// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    EventEmitter,
    NotebookDocument,
    QuickPickItem,
    QuickPickItemKind,
    ThemeIcon
} from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { extractJupyterServerHandleAndId, generateUriFromRemoteProvider } from '../../../kernels/jupyter/jupyterUtils';
import { JupyterServerSelector } from '../../../kernels/jupyter/serverSelector';
import {
    IJupyterServerUriStorage,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    IRemoteKernelFinder
} from '../../../kernels/jupyter/types';
import {
    IKernelFinder,
    KernelConnectionMetadata,
    LocalKernelConnectionMetadata,
    RemoteKernelConnectionMetadata
} from '../../../kernels/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import {
    IMultiStepInput,
    IMultiStepInputFactory,
    InputFlowAction,
    InputStep,
    IQuickPickParameters,
    MultiStepInput
} from '../../../platform/common/utils/multiStepInput';
import { ServiceContainer } from '../../../platform/ioc/container';
import { INotebookKernelSourceSelector } from '../types';
import { CreateAndSelectItemFromQuickPick, KernelSelector } from './kernelSelector';
import { QuickPickKernelItemProvider } from './quickPickKernelItemProvider';
import { ConnectionQuickPickItem, IQuickPickKernelItemProvider, MultiStepResult } from './types';

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
    type: KernelFinderEntityQuickPickType.UriProviderQuickPick;
    provider: IJupyterUriProvider;
    originalItem: QuickPickItem;
}

// Provides the UI to select a Kernel Source for a given notebook document
@injectable()
export class NotebookKernelSourceSelector implements INotebookKernelSourceSelector {
    private localDisposables: IDisposable[] = [];
    private cancellationTokenSource: CancellationTokenSource | undefined;
    constructor(
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(IJupyterUriProviderRegistration)
        private readonly uriProviderRegistration: IJupyterUriProviderRegistration,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector
    ) {}
    public async selectLocalKernel(
        notebook: NotebookDocument,
        kind: ContributedKernelFinderKind.LocalKernelSpec | ContributedKernelFinderKind.LocalPythonEnvironment
    ): Promise<LocalKernelConnectionMetadata | undefined> {
        // Reject if it's not our type
        if (notebook.notebookType !== JupyterNotebookView && notebook.notebookType !== InteractiveWindowView) {
            return;
        }
        this.localDisposables.forEach((d) => d.dispose());
        this.localDisposables = [];
        this.cancellationTokenSource?.cancel();
        this.cancellationTokenSource?.dispose();

        this.cancellationTokenSource = new CancellationTokenSource();
        const multiStep = this.multiStepFactory.create<MultiStepResult>();
        const state: MultiStepResult = { disposables: [], notebook };
        const kernelFinder = this.kernelFinder.registered.find((finder) => finder.id === kind)!;
        try {
            const result = await multiStep.run(
                this.selectKernelFromKernelFinder.bind(
                    this,
                    kernelFinder,
                    this.cancellationTokenSource.token,
                    multiStep,
                    state
                ),
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
                return state.selection.connection as LocalKernelConnectionMetadata;
            }
        } finally {
            disposeAllDisposables(state.disposables);
        }
    }
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
        provider: IJupyterUriProvider,
        token: CancellationToken,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ): Promise<InputStep<MultiStepResult> | void> {
        const savedURIList = await this.serverUriStorage.getSavedUriList();

        if (token.isCancellationRequested) {
            return;
        }

        const servers = this.kernelFinder.registered.filter(
            (info) => info.kind === 'remote' && (info as IRemoteKernelFinder).serverUri.uri
        ) as IRemoteKernelFinder[];
        const items: (ContributedKernelFinderQuickPickItem | KernelProviderItemsQuickPickItem | QuickPickItem)[] = [];

        for (const server of servers) {
            // remote server
            const savedURI = savedURIList.find((uri) => uri.uri === server.serverUri.uri);
            if (savedURI) {
                const idAndHandle = extractJupyterServerHandleAndId(savedURI.uri);

                if (idAndHandle && idAndHandle.id === provider.id) {
                    // local server
                    const uriDate = new Date(savedURI.time);
                    items.push({
                        type: KernelFinderEntityQuickPickType.KernelFinder,
                        kernelFinderInfo: server,
                        serverUri: savedURI.uri,
                        idAndHandle: idAndHandle,
                        label: server.displayName,
                        detail: DataScience.jupyterSelectURIMRUDetail().format(uriDate.toLocaleString()),
                        buttons: provider.removeHandle
                            ? [
                                  {
                                      iconPath: new ThemeIcon('trash'),
                                      tooltip: DataScience.removeRemoteJupyterServerEntryInQuickPick()
                                  }
                              ]
                            : []
                    });
                }
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
                        originalItem: i,
                        detail: provider.displayName
                    };
                }
            );
            items.push(...newProviderItems);
        }

        const onDidChangeItems = new EventEmitter<typeof items>();
        const selectedSource = await multiStep.showQuickPick<
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
                        await provider.removeHandle(e.item.idAndHandle.handle);
                        // the serverUriStorage should be refreshed after the handle removal
                        items.splice(items.indexOf(e.item), 1);
                        onDidChangeItems.fire(items.concat([]));
                    }
                }
            },
            onDidChangeItems: onDidChangeItems.event
        });

        if (token.isCancellationRequested) {
            return;
        }

        if (selectedSource && 'type' in selectedSource) {
            switch (selectedSource.type) {
                case KernelFinderEntityQuickPickType.KernelFinder:
                    return this.selectKernelFromKernelFinder.bind(this, selectedSource.kernelFinderInfo, token);
                case KernelFinderEntityQuickPickType.UriProviderQuickPick:
                    try {
                        const ret = await this.selectRemoteServerFromRemoteKernelFinder(selectedSource, state, token);
                        return ret;
                    } catch (ex) {
                        if (ex === InputFlowAction.back) {
                            return this.getRemoteServersFromProvider(provider, token, multiStep, state);
                        } else {
                            throw ex;
                        }
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
            const uri = generateUriFromRemoteProvider(selectedSource.provider.id, handle);
            if (token.isCancellationRequested) {
                throw new CancellationError();
            }
            await this.serverSelector.setJupyterURIToRemote(uri);
            if (token.isCancellationRequested) {
                throw new CancellationError();
            }
            // Wait for the remote provider to be registered.
            return new Promise<IContributedKernelFinder>((resolve) => {
                const found = this.kernelFinder.registered.find(
                    (f) => f.kind === 'remote' && (f as IRemoteKernelFinder).serverUri.uri === uri
                );
                if (found) {
                    return resolve(found);
                }
                this.kernelFinder.onDidChangeRegistrations(
                    (e) => {
                        const found = e.added.find(
                            (f) => f.kind === 'remote' && (f as IRemoteKernelFinder).serverUri.uri === uri
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
            finderPromise
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
        const provider = new QuickPickKernelItemProvider(state.notebook, source.kind, source);
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
        const selector = new KernelSelector(state.notebook, provider, token);
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
