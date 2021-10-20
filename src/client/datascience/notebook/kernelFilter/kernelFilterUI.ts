// import { INotebookControllerManager } from './types';

import { inject, injectable } from 'inversify';
import { QuickPickItem } from 'vscode';
import { IExtensionSyncActivationService } from '../../../activation/types';
import { IApplicationShell, ICommandManager } from '../../../common/application/types';
import { disposeAllDisposables } from '../../../common/helpers';
import { IDisposable, IDisposableRegistry, IPathUtils } from '../../../common/types';
import { getDetailOfKernelConnection, getDisplayNameOrNameOfKernelConnection } from '../../jupyter/kernels/helpers';
import { KernelConnectionMetadata } from '../../jupyter/kernels/types';
import { getControllerDisplayName } from '../notebookControllerManager';
import { INotebookControllerManager } from '../types';
import { KernelFilterStorage } from './kernelFilterStorage';

@injectable()
export class KernelFilterUI implements IExtensionSyncActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(INotebookControllerManager) private readonly controllers: INotebookControllerManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IDisposableRegistry) disposales: IDisposableRegistry,
        @inject(KernelFilterStorage) private readonly storage: KernelFilterStorage,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils
    ) {
        disposales.push(this);
    }
    public activate() {
        this.disposables.push(this.commandManager.registerCommand('jupyter.manageKernels', this.showUI, this));
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    private showUI() {
        type QuickPickType = QuickPickItem & { connection: KernelConnectionMetadata };
        const quickPick = this.appShell.createQuickPick<QuickPickType>();
        const duplicates = new Set<string>();
        const items = this.controllers.kernelConnections
            .filter((item) => {
                if (duplicates.has(item.id)) {
                    return false;
                }
                duplicates.add(item.id);
                return true;
            })
            .map((item) => {
                return <QuickPickType>{
                    label: getControllerDisplayName(item, getDisplayNameOrNameOfKernelConnection(item)),
                    picked: !this.storage.isKernelHidden(item),
                    detail: getDetailOfKernelConnection(item, this.pathUtils),
                    connection: item
                };
            });
        items.sort((a, b) => {
            if (a.label > b.label) {
                return 1;
            } else if (a.label === b.label) {
                return 0;
            } else {
                return -1;
            }
        });

        quickPick.canSelectMany = true;
        quickPick.activeItems = items;
        quickPick.items = items;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.sortByLabel = true; // Doesnt work, hence we sort manually.
        quickPick.selectedItems = items.filter((item) => item.picked);
        quickPick.placeholder = 'Unselect items you wish to hide from the kernel picker';
        quickPick.show();
        const disposables: IDisposable[] = [];
        quickPick.onDidHide(
            () => {
                disposeAllDisposables(disposables);
            },
            this,
            disposables
        );
        quickPick.onDidAccept(
            () => {
                quickPick.hide();
                disposeAllDisposables(disposables);
                const selectedItems = new Set(quickPick.selectedItems.map((item) => item.connection));
                const hiddenConnections = items
                    .map((item) => item.connection)
                    .filter((item) => !selectedItems.has(item));
                void this.storage.storeHiddenKernels(hiddenConnections.map((item) => item));
            },
            this,
            disposables
        );
    }
}
