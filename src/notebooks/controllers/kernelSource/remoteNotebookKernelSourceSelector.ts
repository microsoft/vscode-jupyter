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
    IRemoteKernelFinder,
    IJupyterUriProviderRegistration,
    IJupyterServerProviderRegistry
} from '../../../kernels/jupyter/types';
import { IKernelFinder, KernelConnectionMetadata, RemoteKernelConnectionMetadata } from '../../../kernels/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import {
    InteractiveWindowView,
    JUPYTER_HUB_EXTENSION_ID,
    JVSC_EXTENSION_ID,
    JupyterNotebookView
} from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
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
import { BaseProviderBasedQuickPick } from '../../../platform/common/providerBasedQuickPick';
import { PreferredKernelConnectionService } from '../preferredKernelConnectionService';
import { traceError } from '../../../platform/logging';
import { IRemoteKernelFinderController } from '../../../kernels/jupyter/finder/types';
import { raceCancellationError } from '../../../platform/common/cancellation';
import { JupyterServer } from '../../../api';

enum KernelFinderEntityQuickPickType {
    KernelFinder = 'finder',
    LocalServer = 'localServer',
    UriProviderQuickPick = 'uriProviderQuickPick',
    JupyterServer = 'jupyterServer'
}

interface ContributedKernelFinderQuickPickItem extends QuickPickItem {
    type: KernelFinderEntityQuickPickType.KernelFinder;
    serverUri: string;
    idAndHandle: { id: string; handle: string; extensionId: string };
    kernelFinderInfo: IContributedKernelFinder;
}
interface JupyterServerQuickPickItem extends QuickPickItem {
    type: KernelFinderEntityQuickPickType.JupyterServer;
    idAndHandle: { id: string; handle: string; extensionId: string };
    server: JupyterServer;
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
        @inject(IConnectionDisplayDataProvider) private readonly displayDataProvider: IConnectionDisplayDataProvider,
        @inject(IRemoteKernelFinderController)
        private readonly kernelFinderController: IRemoteKernelFinderController,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
        @inject(IJupyterServerProviderRegistry)
        private readonly jupyterServerRegistry: IJupyterServerProviderRegistry
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
        const quickPickServerItems: (
            | ContributedKernelFinderQuickPickItem
            | KernelProviderItemsQuickPickItem
            | JupyterServerQuickPickItem
            | QuickPickItem
        )[] = [];
        const quickPickCommandItems: (
            | ContributedKernelFinderQuickPickItem
            | KernelProviderItemsQuickPickItem
            | QuickPickItem
        )[] = [];

        const serversAndTimes: { server: IRemoteKernelFinder; time?: number }[] = [];
        const serverProvider = this.jupyterServerRegistry.jupyterCollections.find(
            (p) => p.extensionId === provider.extensionId && p.id === provider.id
        )?.serverProvider;
        const serversPromise = serverProvider?.provideJupyterServers
            ? serverProvider.provideJupyterServers.bind(serverProvider)(token)
            : Promise.resolve([]);
        const handledServerIds = new Set<string>();
        const [jupyterServers] = await Promise.all([
            serversPromise,
            Promise.all(
                servers
                    .filter((s) => s.serverProviderHandle.id === provider.id)
                    .map(async (server) => {
                        // remote server
                        const lastUsedTime = (await this.serverUriStorage.getAll()).find(
                            (item) =>
                                generateIdFromRemoteProvider(item.provider) ===
                                generateIdFromRemoteProvider(server.serverProviderHandle)
                        );
                        if (token.isCancellationRequested) {
                            return;
                        }
                        handledServerIds.add(generateIdFromRemoteProvider(server.serverProviderHandle));
                        serversAndTimes.push({ server, time: lastUsedTime?.time });
                    })
            )
        ]);
        serversAndTimes.sort((a, b) => {
            if (!a.time && !b.time) {
                return a.server.displayName.localeCompare(b.server.displayName);
            }
            if (!a.time && b.time) {
                return 1;
            }
            if (a.time && !b.time) {
                return -1;
            }
            return (a.time || 0) > (b.time || 0) ? -1 : 1;
        });
        serversAndTimes.forEach(({ server, time }) => {
            quickPickServerItems.push({
                type: KernelFinderEntityQuickPickType.KernelFinder,
                kernelFinderInfo: server,
                idAndHandle: server.serverProviderHandle,
                label: server.displayName,
                detail: time ? DataScience.jupyterSelectURIMRUDetail(new Date(time)) : undefined,
                buttons:
                    serverProvider?.removeJupyterServer &&
                    (provider.extensionId === JVSC_EXTENSION_ID || provider.extensionId === JUPYTER_HUB_EXTENSION_ID)
                        ? [
                              {
                                  iconPath: new ThemeIcon('close'),
                                  tooltip: DataScience.removeRemoteJupyterServerEntryInQuickPick
                              }
                          ]
                        : []
            });
        });

        // Add servers that we have never seen before.
        jupyterServers
            .sort((a, b) => a.label.localeCompare(b.label))
            .forEach((server) => {
                const id = generateIdFromRemoteProvider({
                    extensionId: provider.extensionId,
                    id: provider.id,
                    handle: server.id
                });
                if (handledServerIds.has(id)) {
                    return;
                }
                quickPickServerItems.push(<JupyterServerQuickPickItem>{
                    type: KernelFinderEntityQuickPickType.JupyterServer,
                    label: server.label,
                    idAndHandle: { extensionId: provider.extensionId, id: provider.id, handle: server.id },
                    server,
                    buttons:
                        serverProvider?.removeJupyterServer &&
                        (provider.extensionId === JVSC_EXTENSION_ID ||
                            provider.extensionId === JUPYTER_HUB_EXTENSION_ID)
                            ? [
                                  {
                                      iconPath: new ThemeIcon('close'),
                                      tooltip: DataScience.removeRemoteJupyterServerEntryInQuickPick
                                  }
                              ]
                            : []
                });
            });

        // Add the commands
        if (provider.getQuickPickEntryItems && provider.handleQuickPick) {
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
            if (quickPickServerItems.length > 0 && newProviderItems.length) {
                quickPickCommandItems.push({
                    label: Common.labelForQuickPickSeparatorIndicatingThereIsAnotherGroupOfMoreItems,
                    kind: QuickPickItemKind.Separator
                });
            }
            quickPickCommandItems.push(...newProviderItems);
        }

        const items = quickPickServerItems.concat(quickPickCommandItems);
        const onDidChangeItems = new EventEmitter<typeof items>();
        let defaultSelection: (typeof items)[0] | undefined =
            items.length === 1 && 'default' in items[0] && items[0].default ? items[0] : undefined;
        if (serverProvider && items.length === 1) {
            defaultSelection = items[0];
        }
        let lazyQuickPick:
            | QuickPick<
                  | ContributedKernelFinderQuickPickItem
                  | QuickPickItem
                  | JupyterServerQuickPickItem
                  | KernelProviderItemsQuickPickItem
              >
            | undefined;
        let selectedSource:
            | ContributedKernelFinderQuickPickItem
            | KernelProviderItemsQuickPickItem
            | JupyterServerQuickPickItem
            | QuickPickItem
            | undefined;
        if (defaultSelection) {
            selectedSource = defaultSelection;
        } else {
            const { quickPick, selection } = multiStep.showLazyLoadQuickPick<
                | ContributedKernelFinderQuickPickItem
                | KernelProviderItemsQuickPickItem
                | QuickPickItem
                | JupyterServerQuickPickItem,
                IQuickPickParameters<
                    | ContributedKernelFinderQuickPickItem
                    | KernelProviderItemsQuickPickItem
                    | QuickPickItem
                    | JupyterServerQuickPickItem
                >
            >({
                items: items,
                placeholder: '',
                title: DataScience.quickPickTitleForSelectionOfJupyterServer,
                supportBackInFirstStep: true,
                onDidTriggerItemButton: async (e) => {
                    if (
                        'type' in e.item &&
                        (e.item.type === KernelFinderEntityQuickPickType.KernelFinder ||
                            e.item.type === KernelFinderEntityQuickPickType.JupyterServer)
                    ) {
                        const serverId = e.item.idAndHandle.handle;
                        const serverToRemove = jupyterServers.find((s) => s.id === serverId);
                        if (
                            serverProvider?.removeJupyterServer &&
                            serverToRemove &&
                            (provider.extensionId === JVSC_EXTENSION_ID ||
                                provider.extensionId === JUPYTER_HUB_EXTENSION_ID)
                        ) {
                            quickPick.busy = true;
                            await serverProvider.removeJupyterServer(serverToRemove);
                            quickPick.busy = false;
                            // the serverUriStorage should be refreshed after the handle removal
                            items.splice(items.indexOf(e.item), 1);
                            onDidChangeItems.fire(items.concat([]));
                        }
                    }
                },
                onDidChangeItems: onDidChangeItems.event
            });
            if (provider.extensionId === JVSC_EXTENSION_ID || provider.extensionId === JUPYTER_HUB_EXTENSION_ID) {
                quickPick.onDidChangeValue(async (e) => {
                    if (!provider.getQuickPickEntryItems) {
                        return;
                    }
                    const quickPickCommandItems = [];
                    if (quickPickServerItems.length > 0) {
                        quickPickCommandItems.push({
                            label: Common.labelForQuickPickSeparatorIndicatingThereIsAnotherGroupOfMoreItems,
                            kind: QuickPickItemKind.Separator
                        });
                    }

                    const commands = await provider.getQuickPickEntryItems(e);
                    const newProviderItems: KernelProviderItemsQuickPickItem[] = commands.map((i) => {
                        return {
                            ...i,
                            provider: provider,
                            type: KernelFinderEntityQuickPickType.UriProviderQuickPick,
                            description: undefined,
                            originalItem: i
                        };
                    });
                    quickPick.items = quickPickServerItems.concat(quickPickCommandItems).concat(newProviderItems);
                }, this);
            }
            lazyQuickPick = quickPick;
            selectedSource = await selection;
        }

        if (token.isCancellationRequested) {
            return;
        }

        if (selectedSource && 'type' in selectedSource) {
            switch (selectedSource.type) {
                case KernelFinderEntityQuickPickType.KernelFinder: {
                    const result = await this.selectRemoteKernelFromPicker(
                        state.notebook,
                        Promise.resolve(selectedSource.kernelFinderInfo as IRemoteKernelFinder),
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
                }
                case KernelFinderEntityQuickPickType.JupyterServer: {
                    const finderPromise = (async () => {
                        const serverId = {
                            id: provider.id,
                            handle: selectedSource.server.id,
                            extensionId: provider.extensionId
                        };
                        await raceCancellationError(token, this.serverSelector.addJupyterServer(serverId));
                        return this.kernelFinderController.getOrCreateRemoteKernelFinder(
                            serverId,
                            selectedSource.server.label
                        );
                    })();

                    const result = await this.selectRemoteKernelFromPicker(state.notebook, finderPromise, token).catch(
                        (ex) => traceError(`Failed to select a kernel`, ex)
                    );
                    if (result && result === InputFlowAction.back) {
                        return this.getRemoteServersFromProvider(provider, token, multiStep, state);
                    }
                    if (!result || result instanceof InputFlowAction) {
                        throw new CancellationError();
                    }
                    state.selection = { type: 'connection', connection: result };
                    return;
                }
                case KernelFinderEntityQuickPickType.UriProviderQuickPick: {
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
            const serverId = {
                id: selectedSource.provider.id,
                handle,
                extensionId: selectedSource.provider.extensionId
            };
            await raceCancellationError(token, this.serverSelector.addJupyterServer(serverId));
            const displayName = await raceCancellationError(
                token,
                this.jupyterPickerRegistration.getDisplayNameIfProviderIsLoaded(serverId)
            );
            return this.kernelFinderController.getOrCreateRemoteKernelFinder(
                serverId,
                displayName || selectedSource.originalItem.label
            );
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
        source: Promise<IRemoteKernelFinder>,
        token: CancellationToken
    ) {
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
        const errorToQuickPickItem = (_error: Error) => ({
            label: DataScience.failedToFetchKernelSpecsRemoteErrorMessageForQuickPickLabel,
            detail: DataScience.failedToFetchKernelSpecsRemoteErrorMessageForQuickPickDetail
        });
        const remoteKernelPicker = new BaseProviderBasedQuickPick(
            source,
            quickPickFactory,
            getCategory,
            { supportsBack: true },
            errorToQuickPickItem
        );
        const preferred = new PreferredKernelConnectionService(this.jupyterConnection);
        source
            .then((source) => preferred.findPreferredRemoteKernelConnection(notebook, source, token))
            .then((item) => (remoteKernelPicker.selected = item))
            .catch((ex) => traceError(`Failed to determine preferred remote kernel`, ex));
        return remoteKernelPicker.selectItem(token);
    }
}
