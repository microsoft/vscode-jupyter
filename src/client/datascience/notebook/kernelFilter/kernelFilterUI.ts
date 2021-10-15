// import { INotebookControllerManager } from './types';

import { inject, injectable } from 'inversify';
import { QuickPickItem } from 'vscode';
import { IExtensionSyncActivationService } from '../../../activation/types';
import { IApplicationShell, ICommandManager } from '../../../common/application/types';
import { disposeAllDisposables } from '../../../common/helpers';
import { IDisposable, IDisposableRegistry } from '../../../common/types';
import { JupyterNotebookView } from '../constants';
import { INotebookControllerManager } from '../types';
import { VSCodeNotebookController } from '../vscodeNotebookController';
import { KernelFilterService } from './kernelFilterService';
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
        @inject(KernelFilterService) private readonly filter: KernelFilterService
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
        const controllers = this.controllers.registeredNotebookControllers();
        type QuickPickType = QuickPickItem & { controller: VSCodeNotebookController };
        // We end up duplicating controllers, one for interactive & one for ipynb.
        const nbControllers = controllers.filter((item) => item.controller.notebookType === JupyterNotebookView);
        const quickPick = this.appShell.createQuickPick<QuickPickType>();
        const createQuickPickItems = (controllers: VSCodeNotebookController[], _favorite?: VSCodeNotebookController) => {
            return controllers.map((item) => {
                return <QuickPickType>{
                    label: item.label,
                    picked: !this.filter.isKernelHidden(item.connection),
                    detail: item.controller.detail,
                    controller: item
                };
            });
        }
        const items = createQuickPickItems(nbControllers);
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
        quickPick.onDidAccept(() => {
            quickPick.hide();
            const selectedItems = new Set(quickPick.selectedItems.map((item) => item.controller));
            const hiddenItems = items.map((item) => item.controller).filter((item) => !selectedItems.has(item));
            hiddenItems.map((item) => item.dispose());
            this.updateSelection(hiddenItems);
            quickPick.dispose();
        });
    }
    private async updateSelection(itemsToHide: VSCodeNotebookController[]) {
        await this.storage.storeHiddenKernels(itemsToHide.map((item) => item.connection));
    }
}
