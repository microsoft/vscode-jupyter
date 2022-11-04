// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Disposable, NotebookDocument, QuickPickItem, QuickPickItemKind } from 'vscode';
import { IContributedKernelFinder } from '../../../kernels/internalTypes';
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
import { IKernelFinder } from '../../../kernels/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView, JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { DataScience } from '../../../platform/common/utils/localize';
import {
    IMultiStepInput,
    IMultiStepInputFactory,
    IQuickPickParameters
} from '../../../platform/common/utils/multiStepInput';
import {
    IControllerRegistration,
    INotebookKernelSourceSelector,
    INotebookKernelSourceTracker,
    IVSCodeNotebookController
} from '../types';

enum KernelSourceQuickPickType {
    LocalKernelSpecAndPythonEnv = 'localKernelSpecAndPythonEnv',
    LocalServer = 'localServer',
    ServerUriProvider = 'serverUriProvider'
}

enum KernelFinderEntityQuickPickType {
    KernelFinder = 'finder',
    LocalServer = 'localServer',
    UriProviderQuickPick = 'uriProviderQuickPick'
}

interface LocalKernelSourceQuickPickItem extends QuickPickItem {
    type: KernelSourceQuickPickType.LocalKernelSpecAndPythonEnv;
    kernelFinderInfo: IContributedKernelFinder;
}

interface LocalJupyterServerSourceQuickPickItem extends QuickPickItem {
    type: KernelSourceQuickPickType.LocalServer;
}

interface KernelProviderInfoQuickPickItem extends QuickPickItem {
    type: KernelSourceQuickPickType.ServerUriProvider;
    provider: IJupyterUriProvider;
}

interface ContributedKernelFinderQuickPickItem extends QuickPickItem {
    type: KernelFinderEntityQuickPickType.KernelFinder;
    kernelFinderInfo: IContributedKernelFinder;
}

interface LocalJupyterServerQuickPickItem extends QuickPickItem {
    type: KernelFinderEntityQuickPickType.LocalServer;
}

interface KernelProviderItemsQuickPickItem extends QuickPickItem {
    type: KernelFinderEntityQuickPickType.UriProviderQuickPick;
    provider: IJupyterUriProvider;
    originalItem: QuickPickItem;
}

type KernelSourceQuickPickItem =
    | LocalKernelSourceQuickPickItem
    | KernelProviderInfoQuickPickItem
    | LocalJupyterServerSourceQuickPickItem;

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
    private internalDisposables: Disposable[] = [];

    constructor(
        @inject(INotebookKernelSourceTracker) private readonly kernelSourceTracker: INotebookKernelSourceTracker,
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

        const multiStep = this.multiStepFactory.create<MultiStepResult>();
        const state: MultiStepResult = {};
        await multiStep.run(this.getSourceNested.bind(this, notebook.notebookType), state);

        // If we got both parts of the equation, then perform the kernel source and kernel switch
        if (state.source && state.controller) {
            await this.applyResults(notebook, state);
        }
    }

    private async getSourceNested(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ) {
        const items: KernelSourceQuickPickItem[] = [];
        const allKernelFinders = this.kernelFinder.registered;

        const localKernelFinder = allKernelFinders.find((finder) => finder.id === 'local');
        if (localKernelFinder) {
            // local kernel spec and python env finder
            items.push({
                type: KernelSourceQuickPickType.LocalKernelSpecAndPythonEnv,
                label: 'Local Kernels & Python Environments',
                detail: DataScience.pickLocalKernelTitle(),
                kernelFinderInfo: localKernelFinder
            });
        }

        // Manual remote server kernel finder
        items.push({
            type: KernelSourceQuickPickType.LocalServer,
            label: 'Existing Jupyter Server',
            detail: DataScience.jupyterSelectURINewDetail()
        });

        // 3rd party remote server uri providers
        const providers = await this.uriProviderRegistration.getProviders();
        providers.forEach((p) => {
            items.push({
                type: KernelSourceQuickPickType.ServerUriProvider,
                label: p.displayName ?? p.id,
                detail: `Connect to Jupyter servers from ${p.displayName ?? p.id}`,
                provider: p
            });
        });

        const selectedSource = await multiStep.showQuickPick<
            KernelSourceQuickPickItem,
            IQuickPickParameters<KernelSourceQuickPickItem>
        >({
            items: items,
            placeholder: '',
            title: DataScience.kernelPickerSelectSourceTitle()
        });

        if (selectedSource) {
            switch (selectedSource.type) {
                case KernelSourceQuickPickType.LocalKernelSpecAndPythonEnv:
                    state.source = selectedSource.kernelFinderInfo;
                    return this.getKernel.bind(this, async () => {
                        return this.getMatchingControllers(selectedSource.kernelFinderInfo, notebookType);
                    });
                case KernelSourceQuickPickType.LocalServer:
                    return this.getUserProvidedJupyterServers.bind(this, notebookType);
                case KernelSourceQuickPickType.ServerUriProvider:
                    return this.getRemoteServersFromProvider.bind(this, selectedSource.provider, notebookType);
                default:
                    break;
            }
        }
    }

    private async getUserProvidedJupyterServers(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ) {
        const servers = this.kernelFinder.registered.filter((info) => {
            return info.kind === 'remote' && (info as IRemoteKernelFinder).serverUri.uri;
        }) as IRemoteKernelFinder[];
        const items: (ContributedKernelFinderQuickPickItem | LocalJupyterServerQuickPickItem | QuickPickItem)[] = [];

        for (const server of servers) {
            // remote server
            const savedURIList = await this.serverUriStorage.getSavedUriList();
            const savedURI = savedURIList.find((uri) => uri.uri === server.serverUri.uri);
            if (savedURI) {
                const idAndHandle = extractJupyterServerHandleAndId(savedURI.uri);
                if (!idAndHandle) {
                    const uriDate = new Date(savedURI.time);
                    items.push({
                        kernelFinderInfo: server,
                        label: server.displayName,
                        type: KernelFinderEntityQuickPickType.KernelFinder,
                        detail: DataScience.jupyterSelectURIMRUDetail().format(uriDate.toLocaleString())
                    });
                }
            }
        }

        if (items.length > 0) {
            // insert separator
            items.push({ label: 'More', kind: QuickPickItemKind.Separator });
        }

        items.push({
            type: KernelFinderEntityQuickPickType.LocalServer,
            label: 'Connect to a Jupyter Server',
            detail: DataScience.jupyterSelectURINewDetail()
        });

        const selectedSource = await multiStep.showQuickPick<
            ContributedKernelFinderQuickPickItem | LocalJupyterServerQuickPickItem | QuickPickItem,
            IQuickPickParameters<ContributedKernelFinderQuickPickItem | LocalJupyterServerQuickPickItem | QuickPickItem>
        >({
            items: items,
            placeholder: '',
            title: 'Select a Jupyter Server'
        });

        if (selectedSource && 'type' in selectedSource) {
            switch (selectedSource.type) {
                case KernelFinderEntityQuickPickType.KernelFinder:
                    state.source = selectedSource.kernelFinderInfo;
                    return this.getKernel.bind(this, async () => {
                        return this.getMatchingControllers(selectedSource.kernelFinderInfo, notebookType);
                    });
                case KernelFinderEntityQuickPickType.LocalServer:
                    break;
                default:
                    break;
            }
        }
    }

    private async getRemoteServersFromProvider(
        provider: IJupyterUriProvider,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ) {
        const servers = this.kernelFinder.registered.filter(
            (info) => info.kind === 'remote' && (info as IRemoteKernelFinder).serverUri.uri
        ) as IRemoteKernelFinder[];
        const items: (ContributedKernelFinderQuickPickItem | KernelProviderItemsQuickPickItem | QuickPickItem)[] = [];

        for (const server of servers) {
            // remote server
            const savedURIList = await this.serverUriStorage.getSavedUriList();
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

        if (selectedSource && 'type' in selectedSource) {
            switch (selectedSource.type) {
                case KernelFinderEntityQuickPickType.KernelFinder:
                    state.source = selectedSource.kernelFinderInfo;
                    return this.getKernel.bind(this, async () => {
                        return this.getMatchingControllers(selectedSource.kernelFinderInfo, notebookType);
                    });
                case KernelFinderEntityQuickPickType.UriProviderQuickPick:
                    return this.getKernel.bind(this, async () => {
                        if (!selectedSource.provider.handleQuickPick) {
                            return [];
                        }

                        const handle = await selectedSource.provider.handleQuickPick(selectedSource.originalItem, true);

                        if (handle) {
                            const uri = generateUriFromRemoteProvider(selectedSource.provider.id, handle);
                            const serverId = await computeServerId(uri);
                            const controllerCreatedPromise = waitForNotebookControllersCreationForServer(
                                serverId,
                                this.controllerRegistration
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
                    });
                default:
                    break;
            }
        }
    }

    // Second stage of the multistep to pick a kernel
    private async getKernel(
        getMatchingControllers: () => Promise<IVSCodeNotebookController[]>,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ) {
        if (!state.source) {
            return;
        }

        const matchingControllers = await getMatchingControllers();

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
        result.source && this.kernelSourceTracker.setKernelSourceForNotebook(notebook, result.source);

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
    controllerRegistration: IControllerRegistration
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
        const eventListener = controllerRegistration.onChanged((e) => {
            for (let controller of e.added) {
                if (
                    controller.connection.kind === 'connectToLiveRemoteKernel' ||
                    controller.connection.kind === 'startUsingRemoteKernelSpec'
                ) {
                    if (controller.connection.serverId === serverId) {
                        eventListener.dispose();
                        resolve();
                    }
                }
            }
        });
    });
}
