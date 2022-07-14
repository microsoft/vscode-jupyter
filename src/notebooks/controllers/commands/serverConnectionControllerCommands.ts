/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { ICommandManager, IVSCodeNotebook, IWorkspaceService } from '../../../platform/common/application/types';
import {
    Commands,
    InteractiveWindowView,
    JupyterNotebookView,
    JVSC_EXTENSION_ID
} from '../../../platform/common/constants';
import { ContextKey } from '../../../platform/common/contextKey';
import { IConfigurationService, IDisposableRegistry, IsWebExtension } from '../../../platform/common/types';
import { JupyterServerSelector } from '../../../kernels/jupyter/serverSelector';
import { createDeferred } from '../../../platform/common/utils/async';
import { IControllerLoader, IControllerRegistration, IVSCodeNotebookController } from '../types';
import {
    IMultiStepInput,
    IMultiStepInputFactory,
    InputFlowAction,
    InputStep
} from '../../../platform/common/utils/multiStepInput';
import { ConfigurationChangeEvent, EventEmitter, QuickPickItem, QuickPickItemKind } from 'vscode';
import { noop } from '../../../platform/common/utils/misc';
import { isLocalConnection } from '../../../kernels/types';
import { IJupyterServerUriStorage, IServerConnectionType } from '../../../kernels/jupyter/types';
import { DataScience } from '../../../platform/common/utils/localize';

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

interface ControllerQuickPick extends QuickPickItem {
    controller: IVSCodeNotebookController;
}

// This service owns the commands that show up in the kernel picker to allow for switching
// between local and remote kernels
@injectable()
export class ServerConnectionControllerCommands implements IExtensionSingleActivationService {
    private showingRemoteNotWebContext: ContextKey;
    private showingLocalOrWebEmptyContext: ContextKey;
    private showingRemoteContext: ContextKey;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(IServerConnectionType) private readonly serverConnectionType: IServerConnectionType,
        @inject(IsWebExtension) private readonly isWeb: boolean,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector,
        @inject(IControllerLoader) private readonly controllerLoader: IControllerLoader,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IConfigurationService) private readonly configurationService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService
    ) {
        // Context keys to control when these commands are shown
        this.showingRemoteNotWebContext = new ContextKey('jupyter.showingRemoteNotWeb', this.commandManager);
        this.showingLocalOrWebEmptyContext = new ContextKey('jupyter.showingLocalOrWebEmpty', this.commandManager);
        this.showingRemoteContext = new ContextKey('jupyter.showingRemoteKernels', this.commandManager);
    }
    public async activate(): Promise<void> {
        this.disposables.push(
            this.commandManager.registerCommand(Commands.SwitchToLocalKernels, this.switchToLocalKernels, this)
        );
        this.disposables.push(
            this.commandManager.registerCommand(Commands.SwitchToRemoteKernels, this.switchToRemoteKernels, this)
        );
        this.disposables.push(
            this.commandManager.registerCommand(Commands.SwitchToAnotherRemoteKernels, this.switchToRemoteKernels, this)
        );
        this.disposables.push(this.serverConnectionType.onDidChange(this.updateContextKeys, this));
        this.updateContextKeys().ignoreErrors;
        this.disposables.push(this.workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration, this));
    }

    private async updateContextKeys() {
        if (this.configurationService.getSettings().showOnlyOneTypeOfKernel) {
            const isLocal = this.serverConnectionType.isLocalLaunch;
            await (this.isWeb ? this.controllerLoader.loaded : Promise.resolve(true));

            this.showingLocalOrWebEmptyContext
                .set(isLocal || (this.isWeb && this.controllerRegistration.registered.length === 0))
                .ignoreErrors();
            this.showingRemoteNotWebContext.set(!isLocal && !this.isWeb).ignoreErrors();
            this.showingRemoteContext.set(!isLocal && this.controllerRegistration.registered.length > 0).ignoreErrors();
        } else {
            this.showingLocalOrWebEmptyContext.set(false).ignoreErrors();
            this.showingRemoteNotWebContext.set(false).ignoreErrors();
            this.showingRemoteContext.set(false).ignoreErrors();
        }
    }

    private onDidChangeConfiguration(e: ConfigurationChangeEvent) {
        if (e.affectsConfiguration('jupyter.showOnlyOneTypeOfKernel')) {
            setTimeout(() => {
                this.updateContextKeys().ignoreErrors;
            }, 0); // Has to be async so the update event fires on the config service
        }
    }

    private async showVsCodeKernelPicker() {
        const activeEditor = this.notebooks.activeNotebookEditor;
        if (activeEditor) {
            // Need to wait for controller to reupdate after
            // switching local/remote
            await this.controllerLoader.loaded;
            this.commandManager
                .executeCommand('notebook.selectKernel', { notebookEditor: activeEditor })
                .then(noop, noop);
        }
    }

    private async switchToRemoteKernels() {
        const activeNotebookType = this.notebooks.activeNotebookEditor ? JupyterNotebookView : InteractiveWindowView;
        const startingLocal = this.serverConnectionType.isLocalLaunch;
        const startingUri = await this.serverUriStorage.getRemoteUri();
        const multiStep = this.multiStepFactory.create<{}>();
        return multiStep.run(
            this.startSwitchRun.bind(
                this,
                this.startSwitchingToRemote.bind(this, activeNotebookType, startingLocal, startingUri)
            ),
            {}
        );
    }

    private async startSwitchRun(next: InputStep<{}>, _input: IMultiStepInput<{}>): Promise<InputStep<{}> | void> {
        // This is a middle man just to create the back button on the first step
        return next;
    }

    private async startSwitchingToRemote(
        activeNotebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        startedLocal: boolean,
        startingUri: string | undefined,
        input: IMultiStepInput<{}>
    ): Promise<InputStep<{}> | void> {
        try {
            await this.serverSelector.selectJupyterURI('nonUser', input);
            return this.showRemoteKernelPicker(activeNotebookType, startedLocal, startingUri, input);
        } catch (e) {
            if (e === InputFlowAction.back) {
                return this.showVsCodeKernelPicker();
            }
        }
    }

    private async showRemoteKernelPicker(
        activeNotebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        startedLocal: boolean,
        startedUri: string | undefined,
        input: IMultiStepInput<{}>
    ): Promise<InputStep<{}> | void> {
        try {
            await this.showKernelPicker(
                DataScience.pickRemoteKernelTitle(),
                DataScience.pickRemoteKernelPlaceholder(),
                false,
                activeNotebookType,
                input
            );
        } catch (e) {
            // They backed out. Put back to local
            if (startedLocal) {
                await this.serverSelector.setJupyterURIToLocal();
            } else {
                // Web case is never local but we might have an empty URI
                await this.serverSelector.setJupyterURIToRemote(startedUri);
            }
            throw e;
        }
    }

    private async switchToLocalKernels() {
        const activeNotebookType = this.notebooks.activeNotebookEditor ? JupyterNotebookView : InteractiveWindowView;
        const startingLocal = this.serverConnectionType.isLocalLaunch;
        const startingUri = await this.serverUriStorage.getRemoteUri();
        const multiStep = this.multiStepFactory.create<{}>();
        return multiStep.run(
            this.startSwitchRun.bind(
                this,
                this.startSwitchingToLocal.bind(this, activeNotebookType, startingLocal, startingUri)
            ),
            {}
        );
    }

    private async startSwitchingToLocal(
        activeNotebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        startedLocal: boolean,
        startedUri: string | undefined,
        input: IMultiStepInput<{}>
    ): Promise<InputStep<{}> | void> {
        // Wait until we switch to local
        const deferred = createDeferred<boolean>();
        const disposable = this.serverConnectionType.onDidChange(() => deferred.resolve(true));
        try {
            await this.serverSelector.setJupyterURIToLocal();
            await deferred.promise;
        } finally {
            disposable.dispose();
        }
        try {
            // Then bring up the quick pick for the current set of controllers.
            await this.showKernelPicker(
                DataScience.pickLocalKernelTitle(),
                DataScience.pickLocalKernelPlaceholder(),
                true,
                activeNotebookType,
                input
            );
        } catch (e) {
            // They backed out. Put back to remote
            if (!startedLocal && startedUri) {
                await this.serverSelector.setJupyterURIToRemote(startedUri, true);
            }
            if (e === InputFlowAction.back) {
                return this.showVsCodeKernelPicker();
            }
        }
    }

    private async showKernelPicker(
        title: string,
        placeholder: string,
        local: boolean,
        viewType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        input: IMultiStepInput<{}>
    ): Promise<void> {
        // Get the current list. We will dynamically update the list as
        // more and more controllers are found.
        const controllers = this.controllerRegistration.registered.filter(
            (c) => isLocalConnection(c.connection) === local && c.viewType === viewType
        );

        // Create an event emitter for when new controllers are added
        const changeEmitter = new EventEmitter<(QuickPickItem | ControllerQuickPick)[]>();

        // Use the current controllers to generate the quick pick items
        const picks: ControllerQuickPick[] = controllers.map((d) => {
            return {
                label: d.label,
                detail: undefined,
                description: d.controller.description,
                controller: d
            };
        });

        // Then group them by kind
        const kernelsPerCategory = groupBy(picks, (a, b) =>
            compareIgnoreCase(a.controller.controller.kind || 'z', b.controller.controller.kind || 'z')
        );
        const kindIndexes = new Map<string, number>();
        const quickPickItems: (QuickPickItem | ControllerQuickPick)[] = [];
        kernelsPerCategory.forEach((items) => {
            const kind = items[0].controller.controller.kind || 'Other';
            quickPickItems.push({
                kind: QuickPickItemKind.Separator,
                label: kind
            });
            quickPickItems.push(...items);
            kindIndexes.set(kind, quickPickItems.length);
        });

        // Listen to new controllers being added
        this.controllerRegistration.onCreated((e) => {
            if (
                e.viewType === viewType &&
                quickPickItems.find((p) => (p as any).controller?.id === e.id) === undefined
            ) {
                // Create a pick for the new controller
                const pick: ControllerQuickPick = {
                    label: e.label,
                    detail: undefined,
                    description: e.controller.description,
                    controller: e
                };

                // Stick into the list at the right place
                const kind = e.controller.kind || 'Other';
                const index = kindIndexes.get(kind) || -1;
                if (index < 0) {
                    quickPickItems.push({
                        kind: QuickPickItemKind.Separator,
                        label: kind
                    });
                    quickPickItems.push(pick);
                    kindIndexes.set(kind, quickPickItems.length);
                } else {
                    quickPickItems.splice(index, 0, pick);
                    kindIndexes.set(kind, quickPickItems.length);
                }
                changeEmitter.fire(quickPickItems);
            }
        });

        // Show quick pick with the list of controllers
        const result = await input.showQuickPick({
            title: title,
            items: quickPickItems,
            matchOnDescription: true,
            matchOnDetail: true,
            startBusy: quickPickItems.length === 0,
            stopBusy: this.controllerLoader.refreshed,
            placeholder,
            onDidChangeItems: changeEmitter.event
        });

        if (result && result.label && (result as any).controller) {
            // We have selected this controller so switch to it.
            const controller = (result as any).controller;
            await this.commandManager.executeCommand('notebook.selectKernel', {
                id: controller.id,
                extension: JVSC_EXTENSION_ID
            });

            // Update our context keys as they might have changed when
            // moving to a new kernel
            await this.updateContextKeys();
        }
    }
}
