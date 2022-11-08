// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken, CancellationTokenSource, NotebookDocument, QuickPickItem, QuickPickItemKind } from 'vscode';
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
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../kernels/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView, JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { IDisposable } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import {
    IMultiStepInput,
    IMultiStepInputFactory,
    InputFlowAction,
    InputStep,
    IQuickPickParameters
} from '../../../platform/common/utils/multiStepInput';
import {
    IControllerRegistration,
    INotebookKernelSourceSelector,
    IConnectionTracker,
    IVSCodeNotebookController
} from '../types';

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

interface ControllerQuickPickItem extends QuickPickItem {
    controller: IVSCodeNotebookController;
}

// The return type of our multistep selection process
type MultiStepResult = { source?: IContributedKernelFinder; controller?: IVSCodeNotebookController };

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
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector
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
        const state: MultiStepResult = {};
        await multiStep.run(
            this.getSourceNested.bind(this, notebook.notebookType, this.cancellationTokenSource.token),
            state
        );

        if (this.cancellationTokenSource.token.isCancellationRequested) {
            return;
        }

        // If we got both parts of the equation, then perform the kernel source and kernel switch
        if (state.source && state.controller) {
            await this.applyResults(notebook, state);
        }
    }

    private async getSourceNested(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
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

        if (token.isCancellationRequested) {
            return;
        }

        const selectedSource = await multiStep.showQuickPick<
            KernelSourceQuickPickItem,
            IQuickPickParameters<KernelSourceQuickPickItem>
        >({
            items: items,
            placeholder: '',
            title: DataScience.kernelPickerSelectSourceTitle()
        });

        if (token.isCancellationRequested) {
            return;
        }

        if (selectedSource) {
            switch (selectedSource.type) {
                case KernelSourceQuickPickType.LocalKernelSpec:
                case KernelSourceQuickPickType.LocalPythonEnv:
                    state.source = selectedSource.kernelFinderInfo;
                    return this.getKernel.bind(
                        this,
                        async () => {
                            return this.getMatchingControllers(selectedSource.kernelFinderInfo, notebookType);
                        },
                        token
                    );
                case KernelSourceQuickPickType.ServerUriProvider:
                    return this.getRemoteServersFromProvider.bind(this, selectedSource.provider, notebookType, token);
                default:
                    break;
            }
        }
    }

    private async getRemoteServersFromProvider(
        provider: IJupyterUriProvider,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
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
                        label: server.displayName,
                        detail: DataScience.jupyterSelectURIMRUDetail().format(uriDate.toLocaleString())
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

        const selectedSource = await multiStep.showQuickPick<
            ContributedKernelFinderQuickPickItem | KernelProviderItemsQuickPickItem | QuickPickItem,
            IQuickPickParameters<
                ContributedKernelFinderQuickPickItem | KernelProviderItemsQuickPickItem | QuickPickItem
            >
        >({
            items: items,
            placeholder: '',
            title: `Select a Jupyter Server from ${provider.displayName ?? provider.id}`
        });

        if (token.isCancellationRequested) {
            return;
        }

        if (selectedSource && 'type' in selectedSource) {
            switch (selectedSource.type) {
                case KernelFinderEntityQuickPickType.KernelFinder:
                    state.source = selectedSource.kernelFinderInfo;
                    return this.getKernel.bind(
                        this,
                        async () => {
                            return this.getMatchingControllers(selectedSource.kernelFinderInfo, notebookType);
                        },
                        token
                    );
                case KernelFinderEntityQuickPickType.UriProviderQuickPick:
                    return this.getKernel.bind(
                        this,
                        async () => {
                            if (!selectedSource.provider.handleQuickPick) {
                                return [];
                            }

                            const handle = await selectedSource.provider.handleQuickPick(
                                selectedSource.originalItem,
                                true
                            );

                            if (handle === 'back') {
                                throw InputFlowAction.back;
                            }

                            if (token.isCancellationRequested) {
                                return [];
                            }

                            if (handle) {
                                const uri = generateUriFromRemoteProvider(selectedSource.provider.id, handle);
                                const serverId = await computeServerId(uri);
                                const controllerCreatedPromise = waitForNotebookControllersCreationForServer(
                                    serverId,
                                    this.controllerRegistration,
                                    this.localDisposables
                                );
                                await this.serverSelector.setJupyterURIToRemote(uri);
                                await controllerCreatedPromise;

                                const finder = this.kernelFinder.registered.find(
                                    (f) => f.kind === 'remote' && (f as IRemoteKernelFinder).serverUri.uri === uri
                                );
                                if (finder) {
                                    state.source = finder;
                                    return this.getMatchingControllers(finder, notebookType);
                                }
                            }

                            return [];
                        },
                        token
                    );
                default:
                    break;
            }
        }
    }

    // Second stage of the multistep to pick a kernel
    private async getKernel(
        getMatchingControllers: () => Promise<IVSCodeNotebookController[]>,
        token: CancellationToken,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ): Promise<InputStep<MultiStepResult> | void> {
        const matchingControllers = await getMatchingControllers();

        if (!state.source) {
            return;
        }

        if (token.isCancellationRequested) {
            return;
        }

        // Create controller items and group the by category
        const controllerPickItems: ControllerQuickPickItem[] = matchingControllers.map((controller) => {
            return {
                label: controller.label,
                detail: undefined,
                description: controller.controller.description,
                controller
            };
        });

        const kernelsPerCategory = groupBy(controllerPickItems, (a, b) =>
            compareIgnoreCase(a.controller.controller.kind || 'z', b.controller.controller.kind || 'z')
        );

        // Insert separators into the right spots in the list
        const kindIndexes = new Map<string, number>();
        const quickPickItems: (QuickPickItem | ControllerQuickPickItem)[] = [];

        kernelsPerCategory.forEach((items) => {
            const kind = items[0].controller.controller.kind || 'Other';
            quickPickItems.push({
                kind: QuickPickItemKind.Separator,
                label: kind
            });
            quickPickItems.push(...items);
            kindIndexes.set(kind, quickPickItems.length);
        });

        const result = await multiStep.showQuickPick<
            ControllerQuickPickItem | QuickPickItem,
            IQuickPickParameters<ControllerQuickPickItem | QuickPickItem>
        >({
            title: DataScience.kernelPickerSelectKernelTitle() + ` from ${state.source.displayName}`,
            items: quickPickItems,
            matchOnDescription: true,
            matchOnDetail: true,
            placeholder: ''
        });

        if (token.isCancellationRequested) {
            return;
        }

        if ('controller' in result) {
            state.controller = result.controller;
        }
    }

    // Get all registered controllers that match a specific finder
    private getMatchingControllers(
        kernelSource: IContributedKernelFinder,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ): IVSCodeNotebookController[] {
        return this.controllerRegistration.registered.filter((controller) => {
            const finder = this.kernelFinder.getFinderForConnection(controller.connection);
            return finder?.id === kernelSource.id && controller.viewType === notebookType;
        });
    }

    // If we completed the multistep with results, apply those results
    private async applyResults(notebook: NotebookDocument, result: MultiStepResult) {
        // First apply the kernel filter to this document
        result.controller && this.connectionTracker.trackSelection(notebook, result.controller.connection);

        // Then select the kernel that we wanted
        result.controller &&
            (await this.commandManager.executeCommand('notebook.selectKernel', {
                id: result.controller.id,
                extension: JVSC_EXTENSION_ID
            }));
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
