// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import {
    CancellationToken,
    CancellationTokenSource,
    Event,
    EventEmitter,
    NotebookDocument,
    QuickInputButton,
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
import { ICommandManager } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView, JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
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
import { ConnectionDisplayDataProvider } from '../connectionDisplayData';
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
    source?: IContributedKernelFinder;
    connection?: KernelConnectionMetadata;
    disposables: IDisposable[];
};

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
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}

    public async selectKernelSource(notebook: NotebookDocument): Promise<void> {
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
        const state: MultiStepResult = { disposables: [] };
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
            const oldActiveItem = quickPick.activeItems.length ? [quickPick.activeItems[0]] : [];
            quickPick.items = items;
            quickPick.activeItems = oldActiveItem;
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
                    return this.selectKernelFromKernelFinder(selectedSource.kernelFinderInfo, state, token);
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
                // insert separator
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
                    return this.selectKernelFromKernelFinder(selectedSource.kernelFinderInfo, state, token);
                case KernelFinderEntityQuickPickType.UriProviderQuickPick: {
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
                    const provider = {
                        onDidChange: onDidChange.event,
                        onDidChangeStatus: onDidChangeStatus.event,
                        get kernels() {
                            return kernels;
                        },
                        get status() {
                            return status;
                        },
                        refresh: async () => {
                            refreshInvoked = true;
                        }
                    };
                    state.disposables.push(onDidChange);
                    state.disposables.push(onDidChangeStatus);

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
                        }
                    })().catch(noop);

                    return this.selectKernel.bind(this, provider, token);
                }
                default:
                    break;
            }
        }
    }

    private selectKernelFromKernelFinder(
        source: IContributedKernelFinder<KernelConnectionMetadata>,
        state: MultiStepResult,
        token: CancellationToken
    ) {
        // Kick off a refresh of Python environments when displaying the quick pick for local kernels or Python envs.
        this.interpreterService.refreshInterpreters().ignoreErrors();
        state.source = source;
        const onDidChange = new EventEmitter<void>();
        const provider = {
            onDidChange: onDidChange.event,
            onDidChangeStatus: source.onDidChangeStatus,
            get kernels() {
                return source.kernels;
            },
            get status(): 'discovering' | 'idle' {
                return source.status;
            },
            refresh: () => source.refresh()
        };
        const disposable = source.onDidChangeKernels(() => onDidChange.fire());
        state.disposables.push(disposable);
        state.disposables.push(onDidChange);
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
            status: 'discovering' | 'idle';
            refresh: () => Promise<void>;
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
        if (provider.status === 'discovering') {
            quickPick.busy = true;
        }
        provider.onDidChangeStatus(
            () => {
                if (provider.status === 'idle') {
                    quickPick.busy = false;
                }
            },
            this,
            state.disposables
        );
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
                    const oldItemCount = currentItemsInCategory.size;
                    items.forEach((item) => currentItemsInCategory.add(item));
                    const newItems = Array.from(currentItemsInCategory);
                    newItems.sort((a, b) => a.label.localeCompare(b.label));
                    quickPickItems.splice(indexOfExistingCategory + 1, oldItemCount, ...newItems);
                } else {
                    quickPickItems.push(newCategory);
                    items.sort((a, b) => a.label.localeCompare(b.label));
                    quickPickItems.push(...items);
                    categories.set(newCategory, new Set(items));
                }
                const previousActiveItem = quickPick.activeItems.length ? quickPick.activeItems[0] : undefined;
                quickPick.items = quickPickItems;
                quickPick.activeItems = previousActiveItem ? [previousActiveItem] : [];
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
        const controllers = this.controllerRegistration.add(connection, [
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
