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
// eslint-disable-next-line import/no-restricted-paths
import { CodespacesJupyterServerSelector } from '../../../codespaces/codeSpacesServerSelector';
import {
    IJupyterServerUriStorage,
    IRemoteKernelFinder,
    IJupyterServerProviderRegistry
} from '../../../kernels/jupyter/types';
import { IKernelFinder, KernelConnectionMetadata, RemoteKernelConnectionMetadata } from '../../../kernels/types';
import {
    CodespaceExtensionId,
    InteractiveWindowView,
    JUPYTER_HUB_EXTENSION_ID,
    JVSC_EXTENSION_ID,
    JupyterNotebookView
} from '../../../platform/common/constants';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IDisposable } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import {
    IMultiStepInput,
    InputFlowAction,
    InputStep,
    IQuickPickParameters,
    MultiStepInput
} from '../../../platform/common/utils/multiStepInput';
import { IConnectionDisplayDataProvider, IRemoteNotebookKernelSourceSelector } from '../types';
import { MultiStepResult } from './types';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';
import { generateIdFromRemoteProvider } from '../../../kernels/jupyter/jupyterUtils';
import { BaseProviderBasedQuickPick } from '../../../platform/common/providerBasedQuickPick';
import { PreferredKernelConnectionService } from '../preferredKernelConnectionService';
import { traceError } from '../../../platform/logging';
import { IRemoteKernelFinderController } from '../../../kernels/jupyter/finder/types';
import { raceCancellationError } from '../../../platform/common/cancellation';
import { JupyterServer, JupyterServerCollection, JupyterServerCommand } from '../../../api';
import { noop } from '../../../platform/common/utils/misc';

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
    type: KernelFinderEntityQuickPickType.UriProviderQuickPick;
    provider: JupyterServerCollection;
    command: JupyterServerCommand;
}

function doesExtensionSupportRemovingAServer(extensionId: string) {
    return extensionId === JVSC_EXTENSION_ID || extensionId === JUPYTER_HUB_EXTENSION_ID;
}
// Provides the UI to select a Kernel Source for a given notebook document
@injectable()
export class RemoteNotebookKernelSourceSelector implements IRemoteNotebookKernelSourceSelector {
    private localDisposables: IDisposable[] = [];
    private cancellationTokenSource: CancellationTokenSource | undefined;
    constructor(
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(CodespacesJupyterServerSelector) private readonly serverSelector: CodespacesJupyterServerSelector,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IConnectionDisplayDataProvider) private readonly displayDataProvider: IConnectionDisplayDataProvider,
        @inject(IRemoteKernelFinderController)
        private readonly kernelFinderController: IRemoteKernelFinderController,
        @inject(IJupyterServerProviderRegistry)
        private readonly jupyterServerRegistry: IJupyterServerProviderRegistry
    ) {}
    public async selectRemoteKernel(
        notebook: NotebookDocument,
        provider: JupyterServerCollection
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
        const multiStep = new MultiStepInput<MultiStepResult>();
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
                dispose(state.disposables);
                return;
            }

            // If we got both parts of the equation, then perform the kernel source and kernel switch
            if (state.selection?.type === 'connection') {
                return state.selection.connection as RemoteKernelConnectionMetadata;
            }
        } finally {
            dispose(state.disposables);
        }
    }
    private async getRemoteServersFromProvider(
        provider: JupyterServerCollection,
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
            ? Promise.resolve(serverProvider.provideJupyterServers.bind(serverProvider)(token)).then(
                  (servers) => servers || []
              )
            : Promise.resolve([]);
        const handledServerIds = new Set<string>();
        const jupyterServers = await serversPromise;
        servers
            .filter((s) => s.serverProviderHandle.id === provider.id)
            .map((server) => {
                // remote server
                const lastUsedTime = this.serverUriStorage.all.find(
                    (item) =>
                        generateIdFromRemoteProvider(item.provider) ===
                        generateIdFromRemoteProvider(server.serverProviderHandle)
                );
                handledServerIds.add(generateIdFromRemoteProvider(server.serverProviderHandle));
                serversAndTimes.push({ server, time: lastUsedTime?.time });
            });
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

        serversAndTimes
            .filter(({ time }) => (time || 0) > 0)
            .forEach(({ server, time }) => {
                quickPickServerItems.push({
                    type: KernelFinderEntityQuickPickType.KernelFinder,
                    kernelFinderInfo: server,
                    idAndHandle: server.serverProviderHandle,
                    label: server.displayName,
                    description: time
                        ? DataScience.jupyterServerLastConnectionForQuickPickDescription(new Date(time))
                        : undefined,
                    buttons:
                        serverProvider?.removeJupyterServer && doesExtensionSupportRemovingAServer(provider.extensionId)
                            ? [
                                  {
                                      iconPath: new ThemeIcon('close'),
                                      tooltip: DataScience.removeRemoteJupyterServerEntryInQuickPick
                                  }
                              ]
                            : []
                });
            });

        serversAndTimes
            .filter(({ time }) => !time)
            .forEach(({ server }) => {
                quickPickServerItems.push({
                    type: KernelFinderEntityQuickPickType.KernelFinder,
                    kernelFinderInfo: server,
                    idAndHandle: server.serverProviderHandle,
                    label: server.displayName,
                    buttons:
                        serverProvider?.removeJupyterServer && doesExtensionSupportRemovingAServer(provider.extensionId)
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
                        serverProvider?.removeJupyterServer && doesExtensionSupportRemovingAServer(provider.extensionId)
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
        if (provider.commandProvider) {
            const newProviderItems: KernelProviderItemsQuickPickItem[] = (
                (await Promise.resolve(provider.commandProvider.provideCommands(undefined, token))) || []
            ).map((i) => {
                return {
                    ...i,
                    provider: provider,
                    type: KernelFinderEntityQuickPickType.UriProviderQuickPick,
                    command: i
                };
            });
            if (quickPickServerItems.length > 0 && newProviderItems.length) {
                quickPickCommandItems.push({
                    label: '',
                    kind: QuickPickItemKind.Separator
                });
            }
            quickPickCommandItems.push(...newProviderItems);
        }

        const items = quickPickServerItems.concat(quickPickCommandItems);
        const onDidChangeItems = new EventEmitter<typeof items>();
        let defaultSelection: (typeof items)[0] | undefined =
            items.length === 1 && 'command' in items[0] && items[0].command.canBeAutoSelected ? items[0] : undefined;
        if (serverProvider) {
            // If the only item is a server, then aut select that.
            const itemsWithoutSeparators = items.filter((i) => 'type' in i) as (
                | ContributedKernelFinderQuickPickItem
                | KernelProviderItemsQuickPickItem
                | JupyterServerQuickPickItem
            )[];
            if (
                itemsWithoutSeparators.length === 1 &&
                itemsWithoutSeparators.every((i) => i.type !== KernelFinderEntityQuickPickType.UriProviderQuickPick)
            ) {
                defaultSelection = itemsWithoutSeparators[0];
            } else if (
                itemsWithoutSeparators.every((i) => i.type === KernelFinderEntityQuickPickType.UriProviderQuickPick) &&
                itemsWithoutSeparators.filter((i) => i.picked).length === 1
            ) {
                // Anyone using the new API must explicitly state the fact that commands are auto selected.
                // We will auto select a command only if there is one command that has `picked=true`
                // And if there are no servers.
                defaultSelection = items.filter((i) => i.picked)[0];
            }
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
                placeholder:
                    provider.extensionId === JVSC_EXTENSION_ID || provider.extensionId === JUPYTER_HUB_EXTENSION_ID
                        ? DataScience.enterOrSelectRemoteJupyterPlaceholder
                        : DataScience.selectRemoteJupyterPlaceholder,
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
                            doesExtensionSupportRemovingAServer(provider.extensionId)
                        ) {
                            quickPick.busy = true;
                            this.serverUriStorage
                                .remove({
                                    extensionId: provider.extensionId,
                                    id: provider.id,
                                    handle: serverId
                                })
                                .catch(noop);
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
            quickPick.onDidChangeValue(async (e) => {
                if (!provider.commandProvider?.provideCommands) {
                    return;
                }
                const quickPickCommandItems: QuickPickItem[] = [];
                if (quickPickServerItems.length > 0) {
                    quickPickCommandItems.push({
                        label: '',
                        kind: QuickPickItemKind.Separator
                    });
                }

                const commands = await Promise.resolve(provider.commandProvider.provideCommands(e, token));
                const newProviderItems: KernelProviderItemsQuickPickItem[] = (commands || []).map((i) => {
                    return {
                        ...i,
                        provider: provider,
                        type: KernelFinderEntityQuickPickType.UriProviderQuickPick,
                        command: i
                    };
                });
                quickPick.items = quickPickServerItems.concat(quickPickCommandItems).concat(newProviderItems);
            }, this);
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
                        if (selectedSource === defaultSelection) {
                            throw InputFlowAction.back;
                        }
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
                        if (provider.extensionId.toLowerCase() === CodespaceExtensionId.toLowerCase()) {
                            await raceCancellationError(token, this.serverSelector.addJupyterServer(serverId));
                        }
                        return this.kernelFinderController.getOrCreateRemoteKernelFinder(
                            serverId,
                            selectedSource.server.label
                        );
                    })();

                    const result = await this.selectRemoteKernelFromPicker(state.notebook, finderPromise, token).catch(
                        (ex) => traceError(`Failed to select a kernel`, ex)
                    );
                    if (result && result === InputFlowAction.back) {
                        if (selectedSource === defaultSelection) {
                            throw InputFlowAction.back;
                        }
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
        if (!selectedSource.provider.commandProvider?.handleCommand || token.isCancellationRequested) {
            return;
        }

        const server = await Promise.resolve(
            selectedSource.provider.commandProvider.handleCommand(selectedSource.command, token)
        );

        if (!server) {
            throw InputFlowAction.back;
        }
        if (token.isCancellationRequested) {
            throw new CancellationError();
        }

        const finderPromise = (async () => {
            const serverId = {
                id: selectedSource.provider.id,
                handle: server.id,
                extensionId: selectedSource.provider.extensionId
            };
            if (serverId.extensionId.toLowerCase() === CodespaceExtensionId.toLowerCase()) {
                await raceCancellationError(token, this.serverSelector.addJupyterServer(serverId));
            }
            return this.kernelFinderController.getOrCreateRemoteKernelFinder(serverId, server.label);
        })();

        const result = await this.selectRemoteKernelFromPicker(state.notebook, finderPromise, token).catch((ex) =>
            traceError(`Failed to select a kernel`, ex)
        );
        if (result && result === InputFlowAction.back) {
            // Do not go back to the previous command,
            // We have no idea whta the previous command in the 3rd party extension does,
            // Its possible we start a server, or make some http request or the like.
            // Thus implicitly calling the action on the command is wrong, instead the user must chose this operation.
            // return this.selectRemoteServerFromRemoteKernelFinder(selectedSource, state, token);
            throw InputFlowAction.back;
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
        let recommended: RemoteKernelConnectionMetadata | undefined;
        const quickPickFactory = (item: KernelConnectionMetadata) => {
            const displayData = this.displayDataProvider.getDisplayData(item);
            const prefix = item === recommended ? '$(star-full) ' : '';
            return <QuickPickItem>{
                label: `${prefix}${displayData.label}`,
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
            .then((item) => {
                recommended = item;
                if (item?.kind === 'startUsingRemoteKernelSpec') {
                    remoteKernelPicker.recommended = item;
                }
                remoteKernelPicker.selected = item;
            })
            .catch((ex) => traceError(`Failed to determine preferred remote kernel`, ex));
        return remoteKernelPicker.selectItem(token);
    }
}
