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
import { DataScience } from '../../../platform/common/utils/localize';
import {
    IMultiStepInput,
    IMultiStepInputFactory,
    InputFlowAction,
    InputStep,
    IQuickPickParameters
} from '../../../platform/common/utils/multiStepInput';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { traceError } from '../../../platform/logging';
import { PreferredKernelConnectionService } from '../preferredKernelConnectionService';
import { IControllerRegistration, INotebookKernelSourceSelector, IConnectionTracker } from '../types';
import { KernelSelector } from './kernelSelector';
import { MultiStepResult } from './types';

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
        const selector = new KernelSelector(state.notebook, provider, token);
        state.disposables.push(selector);
        state.connection = await selector.selectKernel(multiStep, state);
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
