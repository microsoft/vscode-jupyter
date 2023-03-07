// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { ICommandManager, IVSCodeNotebook } from '../../../platform/common/application/types';
import {
    Commands,
    InteractiveWindowView,
    JupyterNotebookView,
    JVSC_EXTENSION_ID
} from '../../../platform/common/constants';
import { ContextKey } from '../../../platform/common/contextKey';
import { IDisposable, IDisposableRegistry, IFeaturesManager, IsWebExtension } from '../../../platform/common/types';
import { JupyterServerSelector } from '../../../kernels/jupyter/connection/serverSelector';
import { IControllerRegistration, IVSCodeNotebookController } from '../types';
import {
    IMultiStepInput,
    IMultiStepInputFactory,
    InputFlowAction,
    InputStep
} from '../../../platform/common/utils/multiStepInput';
import { EventEmitter, QuickPickItem, QuickPickItemKind } from 'vscode';
import { noop } from '../../../platform/common/utils/misc';
import { isLocalConnection } from '../../../kernels/types';
import { IJupyterServerUriStorage } from '../../../kernels/jupyter/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { traceVerbose } from '../../../platform/logging';

export function groupBy<T>(data: ReadonlyArray<T>, compare: (a: T, b: T) => number): T[][] {
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

export function compareIgnoreCase(a: string, b: string) {
    return a.localeCompare(b, undefined, { sensitivity: 'accent' });
}

interface ControllerQuickPick extends QuickPickItem {
    controller: IVSCodeNotebookController;
}

// This service owns the commands that show up in the kernel picker to allow for switching
// between local and remote kernels
@injectable()
export class ServerConnectionControllerCommands implements IExtensionSyncActivationService {
    private showingLocalOrWebEmptyContext: ContextKey;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(IsWebExtension) private readonly isWeb: boolean,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager
    ) {
        this.showingLocalOrWebEmptyContext = new ContextKey('jupyter.showingLocalOrWebEmpty', this.commandManager);
    }
    public activate() {
        this.disposables.push(
            this.commandManager.registerCommand(Commands.SwitchToRemoteKernels, this.switchToRemoteKernels, this)
        );
        this.disposables.push(this.serverUriStorage.onDidChangeConnectionType(this.updateContextKeys, this));
        this.updateContextKeys().catch(noop);

        this.disposables.push(this.featuresManager.onDidChangeFeatures(this.updateContextKeys, this));
    }

    private async updateContextKeys() {
        if (this.featuresManager.features.kernelPickerType === 'Insiders') {
            this.showingLocalOrWebEmptyContext.set(false).catch(noop);
        } else {
            // const isLocal = this.serverUriStorage.isLocalLaunch;
            // await (this.isWeb ? this.controllerLoader.loaded : Promise.resolve(true));
            this.showingLocalOrWebEmptyContext.set(this.isWeb).catch(noop);
        }
    }

    private async showVsCodeKernelPicker() {
        const activeEditor = this.notebooks.activeNotebookEditor;
        if (activeEditor) {
            if (this.featuresManager.features.kernelPickerType === 'Stable') {
                // Need to wait for controller to reupdate after
                // switching local/remote
                await this.controllerRegistration.loaded;
            }
            this.commandManager
                .executeCommand('notebook.selectKernel', { notebookEditor: activeEditor })
                .then(noop, noop);
        }
    }

    private async switchToRemoteKernels() {
        const activeNotebookType = this.notebooks.activeNotebookEditor ? JupyterNotebookView : InteractiveWindowView;
        const startingLocal = this.serverUriStorage.isLocalLaunch;
        const startingUri = await this.serverUriStorage.getRemoteUri();
        const multiStep = this.multiStepFactory.create<{}>();
        return multiStep.run(
            this.startSwitchRun.bind(
                this,
                this.startSwitchingToRemote.bind(this, activeNotebookType, startingLocal, startingUri?.uri)
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
                DataScience.pickRemoteKernelTitle,
                DataScience.pickRemoteKernelPlaceholder,
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
        this.controllerRegistration.onDidChange((changed) => {
            changed.added.forEach((e) => {
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
        });

        // Show quick pick with the list of controllers
        const disposables: IDisposable[] = [];
        const stopBusy = new EventEmitter<void>();
        disposables.push(stopBusy);
        this.controllerRegistration.onDidChange(() => stopBusy.fire(), this, disposables);
        const result = await input.showQuickPick({
            title: title,
            items: quickPickItems,
            matchOnDescription: true,
            matchOnDetail: true,
            startBusy: quickPickItems.length === 0,
            stopBusy: stopBusy.event,
            placeholder,
            onDidChangeItems: changeEmitter.event
        });
        disposeAllDisposables(disposables);
        if (result && result.label && (result as any).controller) {
            // We have selected this controller so switch to it.
            const controller = (result as any).controller;
            traceVerbose(`Switching to kernel ${controller.label} ${controller.id}`);
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
