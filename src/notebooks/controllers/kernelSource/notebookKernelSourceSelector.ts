// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    Disposable,
    Event,
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
import { IApplicationShell, ICommandManager } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
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
import { traceError } from '../../../platform/logging';
import { PreferredKernelConnectionService } from '../preferredKernelConnectionService';
import { IControllerRegistration, INotebookKernelSourceSelector, IConnectionTracker } from '../types';
import { CreateAndSelectItemFromQuickPick, KernelSelector } from './kernelSelector';
import { ConnectionQuickPickItem, MultiStepResult } from './types';

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
        @inject(IConnectionTracker) private readonly connectionTracker: IConnectionTracker,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
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
            if (result === InputFlowAction.cancel) {
                throw new CancellationError();
            }
            if (this.cancellationTokenSource.token.isCancellationRequested) {
                disposeAllDisposables(state.disposables);
                return;
            }

            // If we got both parts of the equation, then perform the kernel source and kernel switch
            if (state.source && state.connection) {
                await this.onKernelConnectionSelected(notebook, state.connection);
                return state.connection as LocalKernelConnectionMetadata;
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
            if (result === InputFlowAction.cancel) {
                throw new CancellationError();
            }

            if (this.cancellationTokenSource.token.isCancellationRequested) {
                disposeAllDisposables(state.disposables);
                return;
            }

            // If we got both parts of the equation, then perform the kernel source and kernel switch
            if (state.source && state.connection) {
                await this.onKernelConnectionSelected(notebook, state.connection);
                return state.connection as RemoteKernelConnectionMetadata;
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

            const newProviderItems: KernelProviderItemsQuickPickItem[] = provider.getQuickPickEntryItems().map((i) => {
                return {
                    ...i,
                    provider: provider,
                    type: KernelFinderEntityQuickPickType.UriProviderQuickPick,
                    description: undefined,
                    originalItem: i,
                    detail: provider.displayName
                };
            });
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
            title: `Select a Jupyter Server from ${provider.displayName ?? provider.id}`,
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
                    return this.selectRemoteServerFromRemoteKernelFinder(selectedSource, state, token);

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
        const onDidChange = new EventEmitter<void>();
        const onDidChangeStatus = new EventEmitter<void>();
        const kernels: KernelConnectionMetadata[] = [];
        let status: 'discovering' | 'idle' = 'discovering';
        let refreshInvoked: boolean = false;
        let recommended: KernelConnectionMetadata | undefined;
        const onDidChangeRecommended = new EventEmitter<void>();
        const provider = {
            title: DataScience.kernelPickerSelectKernelTitle(),
            kind: ContributedKernelFinderKind.Remote,
            onDidChange: onDidChange.event,
            onDidChangeStatus: onDidChangeStatus.event,
            onDidChangeRecommended: onDidChangeRecommended.event,
            get kernels() {
                return kernels;
            },
            get status() {
                return status;
            },
            get recommended() {
                return recommended;
            },
            refresh: async () => {
                refreshInvoked = true;
            }
        };
        state.disposables.push(onDidChange);
        state.disposables.push(onDidChangeStatus);
        state.disposables.push(onDidChangeRecommended);

        (async () => {
            const uri = generateUriFromRemoteProvider(selectedSource.provider.id, handle);
            if (token.isCancellationRequested) {
                return;
            }
            await this.serverSelector.setJupyterURIToRemote(uri);
            if (token.isCancellationRequested) {
                return;
            }
            // Wait for the remote provider to be registered.
            const finder = await new Promise<IContributedKernelFinder>((resolve) => {
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
            status = 'idle';
            onDidChangeStatus.fire();
            if (finder) {
                provider.refresh = async () => finder.refresh();
                if (refreshInvoked) {
                    await finder.refresh();
                }
                status = finder.status;
                provider.title = `${DataScience.kernelPickerSelectKernelTitle()} from ${finder.displayName}`;
                finder.onDidChangeKernels(
                    () => {
                        kernels.length = 0;
                        kernels.push(...finder.kernels);
                        onDidChange.fire();
                    },
                    this,
                    state.disposables
                );
                finder.onDidChangeStatus(() => {
                    status = finder.status;
                    onDidChangeStatus.fire();
                });
                state.source = finder;
                kernels.length = 0;
                kernels.push(...finder.kernels);
                onDidChange.fire();
                onDidChangeStatus.fire();

                // We need a cancellation in case the user aborts the quick pick
                const cancellationToken = new CancellationTokenSource();
                const preferred = new PreferredKernelConnectionService();
                state.disposables.push(new Disposable(() => cancellationToken.cancel()));
                state.disposables.push(cancellationToken);
                state.disposables.push(preferred);
                preferred
                    .findPreferredRemoteKernelConnection(state.notebook, finder, cancellationToken.token)
                    .then((kernel) => {
                        recommended = kernel;
                        onDidChangeRecommended.fire();
                    })
                    .catch((ex) =>
                        traceError(`Preferred connection failure ${getDisplayPath(state.notebook.uri)}`, ex)
                    );
            }
        })().catch((ex) => traceError('Kernel selection failure', ex));

        return this.selectKernel.bind(this, provider, token);
    }
    private selectKernelFromKernelFinder(
        source: IContributedKernelFinder<KernelConnectionMetadata>,
        token: CancellationToken,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ) {
        state.source = source;
        const onDidChange = new EventEmitter<void>();
        let recommended: KernelConnectionMetadata | undefined;
        const onDidChangeRecommended = new EventEmitter<void>();
        const provider = {
            title:
                DataScience.kernelPickerSelectKernelTitle() + (state.source ? ` from ${state.source.displayName}` : ''),
            kind: source.kind,
            onDidChange: onDidChange.event,
            onDidChangeStatus: source.onDidChangeStatus,
            onDidChangeRecommended: onDidChangeRecommended.event,
            get kernels() {
                return source.kernels;
            },
            get status(): 'discovering' | 'idle' {
                return source.status;
            },
            get recommended() {
                return recommended;
            },
            refresh: () => source.refresh()
        };
        const disposable = source.onDidChangeKernels(() => onDidChange.fire());
        state.disposables.push(disposable);
        state.disposables.push(onDidChange);
        state.disposables.push(onDidChangeRecommended);

        if (
            source.kind === ContributedKernelFinderKind.LocalKernelSpec ||
            source.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) {
            // We need a cancellation in case the user aborts the quick pick
            const cancellationToken = new CancellationTokenSource();
            const preferred = new PreferredKernelConnectionService();
            state.disposables.push(new Disposable(() => cancellationToken.cancel()));
            state.disposables.push(cancellationToken);
            state.disposables.push(preferred);
            const computePreferred = () => {
                if (recommended) {
                    return;
                }
                const preferredMethod =
                    source.kind === ContributedKernelFinderKind.LocalKernelSpec
                        ? preferred.findPreferredLocalKernelSpecConnection.bind(preferred)
                        : preferred.findPreferredPythonKernelConnection.bind(preferred);

                preferredMethod(state.notebook, source, cancellationToken.token)
                    .then((kernel) => {
                        if (recommended) {
                            return;
                        }
                        recommended = kernel;
                        onDidChangeRecommended.fire();
                    })
                    .catch((ex) =>
                        traceError(`Preferred connection failure ${getDisplayPath(state.notebook.uri)}`, ex)
                    );
            };
            computePreferred();
            source.onDidChangeKernels(computePreferred, this, state.disposables);
        }
        return this.selectKernel(provider, token, multiStep, state);
    }
    /**
     * Second stage of the multistep to pick a kernel
     */
    private async selectKernel(
        provider: {
            title: string;
            kind: ContributedKernelFinderKind;
            readonly onDidChange: Event<void>;
            readonly kernels: KernelConnectionMetadata[];
            onDidChangeStatus: Event<void>;
            onDidChangeRecommended: Event<void>;
            status: 'discovering' | 'idle';
            refresh: () => Promise<void>;
            recommended: KernelConnectionMetadata | undefined;
        },
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
                activeItem: undefined
            });
            return { quickPick, selection: selection as Promise<ConnectionQuickPickItem | QuickPickItem> };
        };
        state.connection = await selector.selectKernel(quickPickFactory);
    }
    private async onKernelConnectionSelected(notebook: NotebookDocument, connection: KernelConnectionMetadata) {
        const controllers = this.controllerRegistration.addOrUpdate(connection, [
            notebook.notebookType as typeof JupyterNotebookView | typeof InteractiveWindowView
        ]);
        if (!Array.isArray(controllers) || controllers.length === 0) {
            return;
        }
        // First apply the kernel filter to this document
        this.connectionTracker.trackSelection(notebook, connection);
    }
}
