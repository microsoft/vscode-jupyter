// import { INotebookControllerManager } from './types';

import { inject, injectable } from 'inversify';
import { QuickPickItem } from 'vscode';
import { IExtensionSyncActivationService } from '../../../activation/types';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../../../common/application/types';
import { disposeAllDisposables } from '../../../common/helpers';
import { IDisposable, IDisposableRegistry, IPathUtils } from '../../../common/types';
import { DataScience } from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import {
    getDisplayNameOrNameOfKernelConnection,
    getKernelConnectionPath,
    getRemoteKernelSessionInformation
} from '../../jupyter/kernels/helpers';
import { KernelConnectionMetadata } from '../../jupyter/kernels/types';
import { INotebookControllerManager } from '../types';
import { KernelFilterService } from './kernelFilterService';

@injectable()
export class KernelFilterUI implements IExtensionSyncActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(INotebookControllerManager) private readonly controllers: INotebookControllerManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IDisposableRegistry) disposales: IDisposableRegistry,
        @inject(KernelFilterService) private readonly kernelFilter: KernelFilterService,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
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

        this.controllers.kernelConnections
            .then((connections) => {
                if (quickPickHidden) {
                    return;
                }
                const items = connections
                    .filter((item) => {
                        if (duplicates.has(item.id)) {
                            return false;
                        }
                        duplicates.add(item.id);
                        return true;
                    })
                    .map((item) => {
                        return <QuickPickType>{
                            label: getDisplayNameOrNameOfKernelConnection(item),
                            picked: !this.kernelFilter.isKernelHidden(item),
                            description: getKernelConnectionPath(item, this.pathUtils, this.workspace),
                            detail: item.kind === 'connectToLiveKernel' ? getRemoteKernelSessionInformation(item) : '',
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
                void this.kernelFilter.storeHiddenKernels(hiddenConnections.map((item) => item));
            },
            this,
            disposables
        );
    }
}
