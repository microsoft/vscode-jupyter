/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { ServerConnectionType } from '../../../kernels/jupyter/launcher/serverConnectionType';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { Commands, JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { ContextKey } from '../../../platform/common/contextKey';
import { IDisposableRegistry, IsWebExtension } from '../../../platform/common/types';
import { JupyterServerSelector } from '../../../kernels/jupyter/serverSelector';
import { createDeferred } from '../../../platform/common/utils/async';
import { IControllerLoader, IControllerRegistration, IVSCodeNotebookController } from '../types';
import { IMultiStepInputFactory, InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import { QuickPickItem, QuickPickItemKind } from 'vscode';

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
    private showingRemoteKernelsContext: ContextKey;
    private showingLocalKernelsContext: ContextKey;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(ServerConnectionType) private readonly serverConnectionType: ServerConnectionType,
        @inject(IsWebExtension) private readonly isWeb: boolean,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector,
        @inject(IControllerLoader) private readonly controllerLoader: IControllerLoader,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration
    ) {
        // Context keys to control when these commands are shown
        this.showingLocalKernelsContext = new ContextKey('jupyter.showingLocalKenrnels', this.commandManager);
        this.showingRemoteKernelsContext = new ContextKey('jupyter.showingRemoteKernels', this.commandManager);
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
        this.disposables.push(this.serverConnectionType.onDidChange(this.onConnectionTypeChanged, this));
        this.onConnectionTypeChanged();
    }

    private onConnectionTypeChanged() {
        const isLocal = this.serverConnectionType.isLocalLaunch;

        // The 'showingLocalKernels' context is used to control the visibility of the 'connect to remote kernels' command
        // Therefore it should always be enabled when running in the web
        this.showingLocalKernelsContext.set(isLocal || this.isWeb).ignoreErrors();

        // The 'showingRemoteKernels' context is used to control the visibility of the 'connect to local kernels' command
        // Therefore it should never be enabled when running in the web
        this.showingRemoteKernelsContext.set(!isLocal && !this.isWeb).ignoreErrors();
    }

    private async showVsCodeKernelPicker() {
        return this.commandManager.executeCommand('notebook.selectKernel');
    }

    private async switchToRemoteKernels() {
        // Ask for the server URI
        const result = await this.serverSelector.selectJupyterURI('nonUser', true);
        if (result === InputFlowAction.back) {
            return this.showVsCodeKernelPicker();
        } else {
            return this.showKernelPicker('Pick remote kernel', 'type here to filter');
        }
    }

    private async switchToLocalKernels() {
        // Wait until we switch to local
        const deferred = createDeferred<boolean>();
        const disposable = this.serverConnectionType.onDidChange(() => deferred.resolve(true));
        try {
            await this.serverSelector.setJupyterURIToLocal();
            await deferred.promise;
        } finally {
            disposable.dispose();
        }

        // Then bring up the quick pick for the current set of controllers.
        return this.showKernelPicker('Pick local kernel', 'type here to filter');
    }

    private async showKernelPicker(title: string, placeholder: string) {
        // Make sure the controllers are refreshed
        await this.controllerLoader.loadControllers(true);

        // Get the current list
        const controllers = this.controllerRegistration.values;

        // Use these to generate the quick pick items
        const picks: ControllerQuickPick[] = controllers.map((d) => {
            return {
                label: d.label,
                detail: undefined,
                description: d.controller.description,
                controller: d
            };
        });
        const kernelsPerCategory = groupBy(picks, (a, b) =>
            compareIgnoreCase(a.controller.controller.kind || 'z', b.controller.controller.kind || 'z')
        );
        const quickPickItems: (QuickPickItem | ControllerQuickPick)[] = [];
        kernelsPerCategory.forEach((items) => {
            quickPickItems.push({
                kind: QuickPickItemKind.Separator,
                label: items[0].controller.controller.kind || 'Other'
            });
            quickPickItems.push(...items);
        });

        // Show quick pick with the list of python interpreters
        const multiStep = this.multiStepFactory.create();
        const result = await multiStep.showQuickPick({
            title: title,
            canGoBack: true,
            items: quickPickItems,
            placeholder
        });

        if (result && result.label && (result as any).controller) {
            // We have selected this controller so switch to it.
            const controller = (result as any).controller;
            await this.commandManager.executeCommand('notebook.selectKernel', {
                id: controller.id,
                extension: JVSC_EXTENSION_ID
            });
        }

        return result;
    }
}
