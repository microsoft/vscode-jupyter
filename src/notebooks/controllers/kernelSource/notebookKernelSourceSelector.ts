// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import {
    CancellationToken,
    CancellationTokenSource,
    Disposable,
    Event,
    EventEmitter,
    NotebookDocument,
    QuickInputButton,
    QuickPick,
    QuickPickItem,
    QuickPickItemKind,
    ThemeIcon
} from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import {
    computeServerId,
    extractJupyterServerHandleAndId,
    generateUriFromRemoteProvider
} from '../../../kernels/jupyter/jupyterUtils';
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
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../kernels/types';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView, JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IDisposable } from '../../../platform/common/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import {
    IMultiStepInput,
    IMultiStepInputFactory,
    InputFlowAction,
    InputStep,
    IQuickPickParameters
} from '../../../platform/common/utils/multiStepInput';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { traceError } from '../../../platform/logging';
import { ConnectionDisplayDataProvider } from '../connectionDisplayData';
import { PreferredKernelConnectionService } from '../preferredKernelConnectionService';
import { IControllerRegistration, INotebookKernelSourceSelector, IConnectionTracker } from '../types';

enum KernelSourceQuickPickType {
    LocalKernelSpec = 'localKernelSpec',
    LocalPythonEnv = 'localPythonEnv',
    LocalServer = 'localServer',
    ServerUriProvider = 'serverUriProvider'
}

enum KernelFinderEntityQuickPickType {
    KernelFinder = 'finder',
    LocalServer = 'localServer',
    UriProviderQuickPick = 'uriProviderQuickPick'
}

interface LocalKernelSpecSourceQuickPickItem extends QuickPickItem {
    type: KernelSourceQuickPickType.LocalKernelSpec;
    kernelFinderInfo: IContributedKernelFinder<LocalKernelSpecConnectionMetadata>;
}

interface LocalPythonEnvSourceQuickPickItem extends QuickPickItem {
    type: KernelSourceQuickPickType.LocalPythonEnv;
    kernelFinderInfo: IContributedKernelFinder<PythonKernelConnectionMetadata>;
}

interface KernelProviderInfoQuickPickItem extends QuickPickItem {
    type: KernelSourceQuickPickType.ServerUriProvider;
    provider: IJupyterUriProvider;
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

type KernelSourceQuickPickItem =
    | LocalKernelSpecSourceQuickPickItem
    | LocalPythonEnvSourceQuickPickItem
    | KernelProviderInfoQuickPickItem;

// type KernelFinderEntityQuickPickItem =
//     | ContributedKernelFinderQuickPickItem
//     | LocalJupyterServerQuickPickItem
//     | KernelProviderItemsQuickPickItem;

interface ConnectionQuickPickItem extends QuickPickItem {
    connection: KernelConnectionMetadata;
}

// The return type of our multistep selection process
type MultiStepResult = {
    notebook: NotebookDocument;
    source?: IContributedKernelFinder;
    connection?: KernelConnectionMetadata;
    disposables: IDisposable[];
};
function isKernelPick(item: ConnectionQuickPickItem | QuickPickItem): item is ConnectionQuickPickItem {
    return 'connection' in item;
}
function updateKernelSourceQuickPickWithNewItems<T extends ConnectionQuickPickItem | QuickPickItem>(
    quickPick: QuickPick<T>,
    items: T[],
    activeItem?: T
) {
    const activeItems = quickPick.activeItems.length ? [quickPick.activeItems[0]] : activeItem ? [activeItem] : [];
    if (activeItems.length && !items.includes(activeItems[0])) {
        const oldActiveItem = activeItems[0];
        const newActiveKernelQuickPickItem =
            isKernelPick(oldActiveItem) &&
            items.find((item) => isKernelPick(item) && item.connection.id === oldActiveItem.connection.id);
        // Find this same quick pick item.
        if (newActiveKernelQuickPickItem) {
            activeItems[0] = newActiveKernelQuickPickItem;
        } else {
            activeItems.length = 0;
        }
    }
    quickPick.items = items;
    quickPick.activeItems = activeItems;
}
function updateKernelQuickPickWithNewItems<T extends ConnectionQuickPickItem | QuickPickItem>(
    quickPick: QuickPick<T>,
    items: T[],
    activeItem?: T
) {
    const activeItems = quickPick.activeItems.length ? [quickPick.activeItems[0]] : activeItem ? [activeItem] : [];
    quickPick.items = items;
    quickPick.activeItems = activeItems;
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
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector,
        @inject(ConnectionDisplayDataProvider) private readonly displayDataProvider: ConnectionDisplayDataProvider,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
    ) {}

    public async selectKernelSource(notebook: NotebookDocument): Promise<void> {
        // Reject if it's not our type
        if (notebook.notebookType !== JupyterNotebookView && notebook.notebookType !== InteractiveWindowView) {
            return;
        }
        // Kick off a refresh of Python environments when displaying the quick pick for local kernels or Python envs.
        if (this.extensionChecker.isPythonExtensionInstalled) {
            this.interpreterService.refreshInterpreters().ignoreErrors();
        }
        this.localDisposables.forEach((d) => d.dispose());
        this.localDisposables = [];
        this.cancellationTokenSource?.cancel();
        this.cancellationTokenSource?.dispose();

        this.cancellationTokenSource = new CancellationTokenSource();
        const multiStep = this.multiStepFactory.create<MultiStepResult>();
        const state: MultiStepResult = { disposables: [], notebook };
        await multiStep.run(this.getSourceNested.bind(this, this.cancellationTokenSource.token), state);

        if (this.cancellationTokenSource.token.isCancellationRequested) {
            disposeAllDisposables(state.disposables);
            return;
        }

        // If we got both parts of the equation, then perform the kernel source and kernel switch
        if (state.source && state.connection) {
            await this.onKernelConnectionSelected(notebook, state.connection);
        }
        disposeAllDisposables(state.disposables);
    }

    private async getSourceNested(
        token: CancellationToken,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ): Promise<InputStep<MultiStepResult> | void> {
        const items: KernelSourceQuickPickItem[] = [];
        const allKernelFinders = this.kernelFinder.registered;

        const localPythonEnvKernelFinder = allKernelFinders.find(
            (finder) => finder.id === ContributedKernelFinderKind.LocalPythonEnvironment
        );
        if (localPythonEnvKernelFinder) {
            // local kernel spec and python env finder
            items.push({
                type: KernelSourceQuickPickType.LocalPythonEnv,
                label: DataScience.localPythonEnvironments(),
                detail: DataScience.pickLocalKernelPythonEnvTitle(),
                kernelFinderInfo: localPythonEnvKernelFinder as IContributedKernelFinder<PythonKernelConnectionMetadata>
            });
        }

        const localKernelFinder = allKernelFinders.find(
            (finder) => finder.id === ContributedKernelFinderKind.LocalKernelSpec
        );
        if (localKernelFinder) {
            // local kernel spec and python env finder
            items.push({
                type: KernelSourceQuickPickType.LocalKernelSpec,
                label: DataScience.localKernelSpecs(),
                detail: DataScience.pickLocalKernelSpecTitle(),
                kernelFinderInfo: localKernelFinder as IContributedKernelFinder<LocalKernelSpecConnectionMetadata>
            });
        }

        if (token.isCancellationRequested) {
            return;
        }

        const { quickPick, selection } = await multiStep.showLazyLoadQuickPick<
            KernelSourceQuickPickItem,
            IQuickPickParameters<KernelSourceQuickPickItem>
        >({
            items: items,
            placeholder: '',
            title: DataScience.kernelPickerSelectSourceTitle()
        });
        quickPick.busy = true;

        (async () => {
            // 3rd party remote server uri providers
            const providers = await this.uriProviderRegistration.getProviders();
            providers.forEach((p) => {
                items.push({
                    type: KernelSourceQuickPickType.ServerUriProvider,
                    label: p.displayName ?? p.id,
                    detail: p.detail ?? `Connect to Jupyter servers from ${p.displayName ?? p.id}`,
                    provider: p
                });
            });
            updateKernelSourceQuickPickWithNewItems(quickPick, items);
            quickPick.busy = false;
        })().ignoreErrors();

        const selectedSource = await selection;
        if (token.isCancellationRequested) {
            return;
        }

        if (selectedSource) {
            switch (selectedSource.type) {
                case KernelSourceQuickPickType.LocalKernelSpec:
                case KernelSourceQuickPickType.LocalPythonEnv:
                    return this.selectKernelFromLocalKernelFinder(selectedSource.kernelFinderInfo, state, token);
                case KernelSourceQuickPickType.ServerUriProvider:
                    return this.getRemoteServersFromProvider.bind(this, selectedSource.provider, token);
                default:
                    break;
            }
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
                    return this.selectKernelFromLocalKernelFinder(selectedSource.kernelFinderInfo, state, token);
                case KernelFinderEntityQuickPickType.UriProviderQuickPick:
                    return this.selectKernelFromRemoteKernelFinder(selectedSource, state, token);

                default:
                    break;
            }
        }
    }

    private async selectKernelFromRemoteKernelFinder(
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
        let status: 'discovering' | 'idle' = 'idle';
        let refreshInvoked: boolean = false;
        let recommended: KernelConnectionMetadata | undefined;
        const onDidChangeRecommended = new EventEmitter<void>();
        const provider = {
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
            const serverId = await computeServerId(uri);
            const controllerCreatedPromise = waitForNotebookControllersCreationForServer(
                serverId,
                this.controllerRegistration,
                this.localDisposables
            );
            if (token.isCancellationRequested) {
                return;
            }
            await this.serverSelector.setJupyterURIToRemote(uri);
            await controllerCreatedPromise;
            if (token.isCancellationRequested) {
                return;
            }

            const finder = this.kernelFinder.registered.find(
                (f) => f.kind === 'remote' && (f as IRemoteKernelFinder).serverUri.uri === uri
            );
            status = 'idle';
            onDidChangeStatus.fire();
            if (finder) {
                provider.refresh = async () => finder.refresh();
                if (refreshInvoked) {
                    await finder.refresh();
                }
                status = finder.status;
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
    private selectKernelFromLocalKernelFinder(
        source: IContributedKernelFinder<KernelConnectionMetadata>,
        state: MultiStepResult,
        token: CancellationToken
    ) {
        state.source = source;
        const onDidChange = new EventEmitter<void>();
        let recommended: KernelConnectionMetadata | undefined;
        const onDidChangeRecommended = new EventEmitter<void>();
        const provider = {
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
        return this.selectKernel.bind(this, provider, token);
    }
    /**
     * Second stage of the multistep to pick a kernel
     */
    private async selectKernel(
        provider: {
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

        const connectionToQuickPick = (connection: KernelConnectionMetadata): ConnectionQuickPickItem => {
            const displayData = this.displayDataProvider.getDisplayData(connection);
            return {
                label: displayData.label,
                detail: displayData.detail,
                description: displayData.description,
                connection: connection
            };
        };

        const connectionToCategory = (connection: KernelConnectionMetadata): QuickPickItem => {
            const kind = this.displayDataProvider.getDisplayData(connection).category || 'Other';
            return {
                kind: QuickPickItemKind.Separator,
                label: kind
            };
        };

        const trackedIds = new Set(provider.kernels.map((item) => item.id));
        const connectionPickItems = provider.kernels.map((connection) => connectionToQuickPick(connection));

        // Insert separators into the right spots in the list
        let quickPickItems: (QuickPickItem | ConnectionQuickPickItem)[] = [];
        const categories = new Map<QuickPickItem, Set<ConnectionQuickPickItem>>();
        groupBy(connectionPickItems, (a, b) =>
            compareIgnoreCase(
                this.displayDataProvider.getDisplayData(a.connection).category || 'z',
                this.displayDataProvider.getDisplayData(b.connection).category || 'z'
            )
        ).forEach((items) => {
            const item = connectionToCategory(items[0].connection);
            quickPickItems.push(item);
            items.sort((a, b) => a.label.localeCompare(b.label));
            quickPickItems.push(...items);
            categories.set(item, new Set(items));
        });

        const refreshButton: QuickInputButton = { iconPath: new ThemeIcon('refresh'), tooltip: Common.refresh() };
        const refreshingButton: QuickInputButton = {
            iconPath: new ThemeIcon('loading~spin'),
            tooltip: Common.refreshing()
        };

        const { quickPick, selection } = multiStep.showLazyLoadQuickPick<
            ConnectionQuickPickItem | QuickPickItem,
            IQuickPickParameters<ConnectionQuickPickItem | QuickPickItem>
        >({
            title:
                DataScience.kernelPickerSelectKernelTitle() + (state.source ? ` from ${state.source.displayName}` : ''),
            items: quickPickItems,
            matchOnDescription: true,
            matchOnDetail: true,
            placeholder: '',
            activeItem: undefined,
            buttons: [refreshButton],
            onDidTriggerButton: async (e) => {
                if (e === refreshButton) {
                    const buttons = quickPick.buttons;
                    quickPick.buttons = buttons.filter((btn) => btn !== refreshButton).concat(refreshingButton);
                    await provider.refresh().catch(noop);
                    quickPick.buttons = buttons;
                }
            }
        });
        // Assume we're always busy.
        quickPick.busy = true;
        let noLongerBusy = true;
        // If we don't get any updates after 2s, then hide the busy indicator
        let updateTimeout = setTimeout(() => {
            if (noLongerBusy) {
                quickPick.busy = false;
            }
        }, 2_000);
        state.disposables.push(new Disposable(() => clearTimeout(updateTimeout)));
        provider.onDidChangeStatus(
            () => {
                clearTimeout(updateTimeout);
                switch (provider.status) {
                    case 'discovering':
                        quickPick.busy = true;
                        noLongerBusy = false;
                        break;
                    case 'idle':
                        noLongerBusy = true;
                        updateTimeout = setTimeout(() => {
                            if (noLongerBusy) {
                                quickPick.busy = false;
                            }
                        }, 2_000);
                        state.disposables.push(new Disposable(() => clearTimeout(updateTimeout)));
                        break;
                }
            },
            this,
            state.disposables
        );

        const recommendedItems: (QuickPickItem | ConnectionQuickPickItem)[] = [];
        const updateRecommended = () => {
            if (!provider.recommended) {
                return;
            }
            if (!recommendedItems.length) {
                recommendedItems.push(<QuickPickItem>{
                    label: DataScience.recommendedKernelCategoryInQuickPick(),
                    kind: QuickPickItemKind.Separator
                });
            }
            const recommendedItem = connectionToQuickPick(provider.recommended);
            recommendedItem.label = `$(star-full) ${recommendedItem.label}`;
            if (recommendedItems.length === 2) {
                recommendedItems[1] = recommendedItem;
            } else {
                recommendedItems.push(recommendedItem);
            }
            updateKernelQuickPickWithNewItems(quickPick, recommendedItems.concat(quickPickItems), recommendedItems[1]);
        };
        provider.onDidChangeRecommended(updateRecommended, this, state.disposables);
        updateRecommended();
        provider.onDidChange(() => {
            quickPick.title =
                DataScience.kernelPickerSelectKernelTitle() + (state.source ? ` from ${state.source.displayName}` : '');
            const allIds = new Set<string>();
            const newQuickPickItems = provider.kernels
                .filter((item) => {
                    allIds.add(item.id);
                    if (!trackedIds.has(item.id)) {
                        trackedIds.add(item.id);
                        return true;
                    }
                    return false;
                })
                .map((item) => connectionToQuickPick(item));
            const removedIds = Array.from(trackedIds).filter((id) => !allIds.has(id));
            if (removedIds.length) {
                const itemsRemoved: (ConnectionQuickPickItem | QuickPickItem)[] = [];
                categories.forEach((items, category) => {
                    items.forEach((item) => {
                        if (removedIds.includes(item.connection.id)) {
                            items.delete(item);
                            itemsRemoved.push(item);
                        }
                    });
                    if (!items.size) {
                        itemsRemoved.push(category);
                        categories.delete(category);
                    }
                });
                const previousActiveItem = quickPick.activeItems.length ? quickPick.activeItems[0] : undefined;
                quickPickItems = quickPickItems.filter((item) => !itemsRemoved.includes(item));
                quickPick.items = quickPickItems;
                quickPick.activeItems =
                    previousActiveItem && !itemsRemoved.includes(previousActiveItem) ? [previousActiveItem] : [];
            }
            if (!newQuickPickItems.length) {
                return;
            }
            groupBy(newQuickPickItems, (a, b) =>
                compareIgnoreCase(
                    this.displayDataProvider.getDisplayData(a.connection).category || 'z',
                    this.displayDataProvider.getDisplayData(b.connection).category || 'z'
                )
            ).forEach((items) => {
                items.sort((a, b) => a.label.localeCompare(b.label));
                const newCategory = connectionToCategory(items[0].connection);
                // Check if we already have a item for this category in the quick pick.
                const existingCategory = quickPickItems.find(
                    (item) => item.kind === QuickPickItemKind.Separator && item.label === newCategory.label
                );
                if (existingCategory) {
                    const indexOfExistingCategory = quickPickItems.indexOf(existingCategory);
                    const currentItemsInCategory = categories.get(existingCategory)!;
                    const currentItemIdsInCategory = new Map(
                        Array.from(currentItemsInCategory).map((item) => [item.connection.id, item])
                    );
                    const oldItemCount = currentItemsInCategory.size;
                    items.forEach((item) => {
                        const existingItem = currentItemIdsInCategory.get(item.connection.id);
                        if (existingItem) {
                            currentItemsInCategory.delete(existingItem);
                        }
                        currentItemsInCategory.add(item);
                    });
                    const newItems = Array.from(currentItemsInCategory);
                    newItems.sort((a, b) => a.label.localeCompare(b.label));
                    quickPickItems.splice(indexOfExistingCategory + 1, oldItemCount, ...newItems);
                } else {
                    // Since we sort items by Env type, ensure this new item is inserted in the right place.
                    const currentCategories = quickPickItems
                        .map((item, index) => [item, index])
                        .filter(([item, _]) => (item as QuickPickItem).kind === QuickPickItemKind.Separator)
                        .map(([item, index]) => [(item as QuickPickItem).label, index]);

                    currentCategories.push([newCategory.label, -1]);
                    currentCategories.sort((a, b) => a[0].toString().localeCompare(b[0].toString()));

                    // Find where we need to insert this new category.
                    const indexOfNewCategoryInList = currentCategories.findIndex((item) => item[1] === -1);
                    let newIndex = 0;
                    if (indexOfNewCategoryInList > 0) {
                        newIndex =
                            currentCategories.length === indexOfNewCategoryInList + 1
                                ? quickPickItems.length
                                : (currentCategories[indexOfNewCategoryInList + 1][1] as number);
                    }

                    items.sort((a, b) => a.label.localeCompare(b.label));
                    quickPickItems.splice(newIndex, 0, newCategory, ...items);
                    categories.set(newCategory, new Set(items));
                }
                updateKernelQuickPickWithNewItems(quickPick, recommendedItems.concat(quickPickItems));
            });
        });

        const result = await selection;
        if (token.isCancellationRequested) {
            return;
        }

        if ('connection' in result) {
            state.connection = result.connection;
        }
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

        // Then select the kernel that we wanted
        await this.commandManager.executeCommand('notebook.selectKernel', {
            id: controllers[0].id,
            extension: JVSC_EXTENSION_ID
        });
    }
}

function groupBy<T>(data: ReadonlyArray<T>, compare: (a: T, b: T) => number): T[][] {
    const result: T[][] = [];
    let currentGroup: T[] | undefined = undefined;
    for (const element of data.slice(0).sort(compare)) {
        if (!currentGroup || compare(currentGroup[0], element) !== 0) {
            currentGroup = [element];
            result.push(currentGroup);
        } else {
            currentGroup.push(element);
        }
    }
    return result;
}

function compareIgnoreCase(a: string, b: string) {
    return a.localeCompare(b, undefined, { sensitivity: 'accent' });
}

function waitForNotebookControllersCreationForServer(
    serverId: string,
    controllerRegistration: IControllerRegistration,
    localDisposables: IDisposable[]
) {
    if (
        controllerRegistration.all.find(
            (connection) =>
                (connection.kind === 'connectToLiveRemoteKernel' || connection.kind === 'startUsingRemoteKernelSpec') &&
                connection.id === serverId
        )
    ) {
        return;
    }

    return new Promise<void>((resolve) => {
        const d = controllerRegistration.onChanged((e) => {
            for (let controller of e.added) {
                if (
                    controller.connection.kind === 'connectToLiveRemoteKernel' ||
                    controller.connection.kind === 'startUsingRemoteKernelSpec'
                ) {
                    if (controller.connection.serverId === serverId) {
                        d.dispose();
                        resolve();
                    }
                }
            }
        });

        localDisposables.push(d);
    });
}
