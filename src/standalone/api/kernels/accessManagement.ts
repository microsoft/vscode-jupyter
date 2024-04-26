// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { QuickPickItem, commands, extensions, l10n, window } from 'vscode';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { DisposableStore, dispose } from '../../../platform/common/utils/lifecycle';
import { toPromise } from '../../../platform/common/utils/events';
import { getExtensionAccessListForManagement, updateListOfExtensionsAllowedToAccessApi } from './apiAccess';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { injectable } from 'inversify';

@injectable()
export class KernelApi implements IExtensionSyncActivationService {
    activate(): void {
        const disposables = ServiceContainer.instance.get<IDisposableRegistry>(IDisposableRegistry);
        const disposableStore = new DisposableStore();
        disposables.push(disposableStore);
        disposables.push(
            commands.registerCommand('jupyter.manageAccessToKernels', () => manageKernelAccess(disposableStore))
        );
    }
}

async function manageKernelAccess(toDispose: DisposableStore) {
    const accessInfo = await getExtensionAccessListForManagement();
    const quickPickItems: (QuickPickItem & { extensionId: string })[] = [];
    Array.from(accessInfo.entries()).forEach(([extensionId]) => {
        const displayName = extensions.getExtension(extensionId)?.packageJSON?.displayName;
        if (!displayName) {
            return;
        }
        quickPickItems.push({ label: displayName, description: extensionId, extensionId });
    });
    let disposables: IDisposable[] = [];
    toDispose.add({
        dispose: () => {
            disposables = dispose(disposables);
        }
    });
    const quickPick = window.createQuickPick<QuickPickItem & { extensionId: string }>();
    quickPick.title = l10n.t('Manage Access To Jupyter Kernels');
    quickPick.placeholder = l10n.t('Choose which extensions can access Jupyter Kernels');
    quickPick.items = quickPickItems;
    quickPick.selectedItems = quickPickItems.filter((item) => accessInfo.get(item.extensionId) === true);
    quickPick.canSelectMany = true;
    quickPick.ignoreFocusOut = false;
    let accepted = false;
    disposables.push(quickPick);
    quickPick.show();
    await Promise.race([
        toPromise(quickPick.onDidAccept, undefined, disposables).then(() => (accepted = true)),
        toPromise(quickPick.onDidHide, undefined, disposables)
    ]);
    if (!accepted) {
        return;
    }
    await updateListOfExtensionsAllowedToAccessApi(quickPick.selectedItems.map((item) => item.extensionId));
    disposables = dispose(disposables);
}
