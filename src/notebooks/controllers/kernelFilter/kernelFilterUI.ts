// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { QuickPickItem } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { ICommandManager, IApplicationShell, IWorkspaceService } from '../../../platform/common/application/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import {
    getDisplayNameOrNameOfKernelConnection,
    getKernelConnectionDisplayPath,
    getRemoteKernelSessionInformation
} from '../../../kernels/helpers';
import { isRemoteConnection, KernelConnectionMetadata } from '../../../kernels/types';
import { KernelFilterService } from './kernelFilterService';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../../platform/common/constants';
import { IControllerLoader, IControllerRegistration } from '../types';
import { IPlatformService } from '../../../platform/common/platform/types';

function getKernelLabel(metadata: KernelConnectionMetadata): string {
    if (isRemoteConnection(metadata)) {
        return `${DataScience.kernelPrefixForRemote()} ${getDisplayNameOrNameOfKernelConnection(metadata)}`;
    }
    return getDisplayNameOrNameOfKernelConnection(metadata);
}

/**
 * Provides a UI for filtering kernels.
 */
@injectable()
export class KernelFilterUI implements IExtensionSyncActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(IControllerRegistration) private readonly controllers: IControllerRegistration,
        @inject(IControllerLoader) private readonly controllerLoader: IControllerLoader,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IDisposableRegistry) disposales: IDisposableRegistry,
        @inject(KernelFilterService) private readonly kernelFilter: KernelFilterService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPlatformService) private readonly platform: IPlatformService
    ) {
        disposales.push(this);
    }
    public activate() {
        this.disposables.push(this.commandManager.registerCommand('jupyter.filterKernels', this.showUI, this));
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    private async showUI() {
        type QuickPickType = QuickPickItem & { connection: KernelConnectionMetadata };
        const quickPick = this.appShell.createQuickPick<QuickPickType>();
        const duplicates = new Set<string>();
        let quickPickHidden = false;
        quickPick.canSelectMany = false;
        quickPick.placeholder = DataScience.kernelFilterPlaceholder();
        quickPick.busy = true;
        quickPick.enabled = false;

        this.controllerLoader.loaded
            .then(() => {
                if (quickPickHidden) {
                    return;
                }
                const items = this.controllers.all
                    .filter((item) => {
                        if (duplicates.has(item.id)) {
                            return false;
                        }
                        duplicates.add(item.id);
                        return true;
                    })
                    .map((item) => {
                        return <QuickPickType>{
                            label: getKernelLabel(item),
                            picked: !this.kernelFilter.isKernelHidden(item),
                            description: getKernelConnectionDisplayPath(item, this.workspace, this.platform),
                            detail:
                                item.kind === 'connectToLiveRemoteKernel'
                                    ? getRemoteKernelSessionInformation(item)
                                    : '',
                            connection: item
                        };
                    });
                items.sort((a, b) => a.label.localeCompare(b.label));

                quickPick.canSelectMany = true;
                quickPick.activeItems = items;
                quickPick.items = items;
                quickPick.matchOnDescription = true;
                quickPick.matchOnDetail = true;
                quickPick.sortByLabel = true; // Doesnt work, hence we sort manually.
                quickPick.selectedItems = items.filter((item) => item.picked);
                quickPick.placeholder = DataScience.kernelFilterPlaceholder();
                quickPick.enabled = true;
                quickPick.busy = false;
            })
            .catch(noop);

        const disposables: IDisposable[] = [];
        quickPick.show();
        quickPick.onDidHide(
            () => {
                quickPickHidden = true;
                disposeAllDisposables(disposables);
            },
            this,
            disposables
        );
        quickPick.onDidAccept(
            () => {
                quickPickHidden = true;
                quickPick.hide();
                disposeAllDisposables(disposables);
                const selectedItems = new Set(quickPick.selectedItems.map((item) => item.connection));
                const items = quickPick.items;
                const hiddenConnections = items
                    .map((item) => item.connection)
                    .filter((item) => !selectedItems.has(item));
                this.kernelFilter.storeHiddenKernels(hiddenConnections.map((item) => item)).then(noop, noop);
                sendTelemetryEvent(Telemetry.JupyterKernelFilterUsed);
            },
            this,
            disposables
        );
    }
}
