// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationToken,
    Disposable,
    QuickInputButton,
    QuickPick,
    QuickPickItem,
    QuickPickItemKind,
    ThemeIcon
} from 'vscode';
import { KernelConnectionMetadata } from '../../../kernels/types';
import { IDisposable } from '../../../platform/common/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import { ServiceContainer } from '../../../platform/ioc/container';
import {
    CommandQuickPickItem,
    ConnectionQuickPickItem,
    KernelListErrorQuickPickItem,
    IQuickPickKernelItemProvider
} from './types';
import { IConnectionDisplayData, IConnectionDisplayDataProvider } from '../types';
import { Disposables } from '../../../platform/common/utils';
import { traceVerbose } from '../../../platform/logging';
export type CompoundQuickPickItem =
    | CommandQuickPickItem
    | ConnectionQuickPickItem
    | KernelListErrorQuickPickItem
    | QuickPickItem;
export function isKernelPickItem(item: CompoundQuickPickItem): item is ConnectionQuickPickItem {
    return 'connection' in item;
}
export function isCommandQuickPickItem(item: CompoundQuickPickItem): item is CommandQuickPickItem {
    return 'command' in item;
}
function updateKernelQuickPickWithNewItems<T extends CompoundQuickPickItem>(
    quickPick: QuickPick<T>,
    items: T[],
    activeItem?: T
) {
    const activeItems = activeItem ? [activeItem] : quickPick.activeItems.length ? [quickPick.activeItems[0]] : [];
    if (activeItems.length && !items.includes(activeItems[0])) {
        const oldActiveItem = activeItems[0];
        const newActiveKernelQuickPickItem =
            isKernelPickItem(oldActiveItem) &&
            items.find((item) => isKernelPickItem(item) && item.connection.id === oldActiveItem.connection.id);
        // Find this same quick pick item.
        if (newActiveKernelQuickPickItem) {
            activeItems[0] = newActiveKernelQuickPickItem;
        } else {
            activeItems.length = 0;
        }
    }
    quickPick.items = items;
    traceVerbose(`KernelSelector Quick Pick Items: ${JSON.stringify(items)}`);
    quickPick.activeItems = activeItems;
}

export type CreateAndSelectItemFromQuickPick = (options: {
    title: string;
    items: CompoundQuickPickItem[];
    buttons: QuickInputButton[];
    onDidTriggerButton: (e: QuickInputButton) => void;
}) => {
    quickPick: QuickPick<CompoundQuickPickItem>;
    selection: Promise<CompoundQuickPickItem>;
};

/**
 * Used to indicate the fact that the quick pick workflow
 * has been successfully completed.
 * Do not use `CancellationError` as that indicates the user stopped the workflow.
 * & VS Code will re-display the quick pick, & that's not something we want as the user has taken an action.
 */
class SomeOtherActionError extends Error {}

export class BaseKernelSelector extends Disposables implements IDisposable {
    protected readonly displayDataProvider: IConnectionDisplayDataProvider;
    protected readonly recommendedItems: (QuickPickItem | ConnectionQuickPickItem)[] = [];
    protected existingItems = new Set<ConnectionQuickPickItem>();
    protected quickPickItems: (QuickPickItem | ConnectionQuickPickItem)[] = [];
    constructor(
        protected readonly provider: IQuickPickKernelItemProvider,
        protected readonly token: CancellationToken
    ) {
        super();
        this.displayDataProvider =
            ServiceContainer.instance.get<IConnectionDisplayDataProvider>(IConnectionDisplayDataProvider);
    }
    public async selectKernel(
        quickPickFactory: CreateAndSelectItemFromQuickPick
    ): Promise<
        | { selection: 'controller'; connection: KernelConnectionMetadata }
        | { selection: 'userPerformedSomeOtherAction' }
        | undefined
    > {
        return this.selectKernelImpl(quickPickFactory, { quickPick: undefined });
    }

    protected async selectKernelImpl(
        quickPickFactory: CreateAndSelectItemFromQuickPick,
        quickPickToBeUpdated: { quickPick: QuickPick<CompoundQuickPickItem> | undefined }
    ): Promise<
        | { selection: 'controller'; connection: KernelConnectionMetadata }
        | { selection: 'userPerformedSomeOtherAction' }
        | undefined
    > {
        if (this.token.isCancellationRequested) {
            return;
        }
        const items = this.provider.kernels.map((connection) => this.connectionToQuickPick(connection));
        this.quickPickItems.push({
            kind: QuickPickItemKind.Separator,
            label: DataScience.kernelCategoryForJupyterKernel
        });
        items.sort((a, b) => a.label.localeCompare(b.label));
        this.quickPickItems.push(...items);
        this.existingItems = new Set(items);

        return this.selectKernelImplInternal(quickPickFactory, quickPickToBeUpdated);
    }
    private async selectKernelImplInternal(
        quickPickFactory: CreateAndSelectItemFromQuickPick,
        quickPickToBeUpdated: { quickPick: QuickPick<CompoundQuickPickItem> | undefined }
    ): Promise<
        | { selection: 'controller'; connection: KernelConnectionMetadata }
        | { selection: 'userPerformedSomeOtherAction' }
        | undefined
    > {
        const refreshButton: QuickInputButton = { iconPath: new ThemeIcon('refresh'), tooltip: Common.refresh };
        const refreshingButton: QuickInputButton = {
            iconPath: new ThemeIcon('loading~spin'),
            tooltip: Common.refreshing
        };
        const { quickPick, selection } = quickPickFactory({
            title: this.provider.title,
            items: this.quickPickItems,
            buttons: [refreshButton],
            onDidTriggerButton: async (e) => {
                if (e === refreshButton) {
                    const buttons = quickPick.buttons;
                    quickPick.buttons = buttons.filter((btn) => btn !== refreshButton).concat(refreshingButton);
                    await this.provider.refresh().catch(noop);
                    quickPick.buttons = buttons;
                }
            }
        });
        quickPickToBeUpdated.quickPick = quickPick;
        if (this.provider.status === 'discovering') {
            quickPick.busy = true;
        }
        let timeout: NodeJS.Timer | undefined;
        this.provider.onDidChangeStatus(
            () => {
                timeout && clearTimeout(timeout);
                switch (this.provider.status) {
                    case 'discovering':
                        quickPick.busy = true;
                        break;
                    case 'idle':
                        timeout = setTimeout(() => (quickPick.busy = false), 500);
                        this.disposables.push(new Disposable(() => timeout && clearTimeout(timeout)));
                        break;
                }
            },
            this,
            this.disposables
        );

        this.updateRecommended(quickPick);
        this.updateQuickPickItems(quickPick);
        this.provider.onDidChangeRecommended(() => this.updateRecommended(quickPick), this, this.disposables);
        this.provider.onDidChange(() => this.updateQuickPickItems(quickPick), this, this.disposables);

        const result = await selection;
        if (this.token.isCancellationRequested) {
            return;
        }

        if (isCommandQuickPickItem(result)) {
            try {
                const connection = await result.command();
                return connection ? { selection: 'controller', connection: connection } : undefined;
            } catch (ex) {
                if (ex instanceof SomeOtherActionError) {
                    return { selection: 'userPerformedSomeOtherAction' };
                } else if (ex === InputFlowAction.back) {
                    return this.selectKernelImplInternal(quickPickFactory, quickPickToBeUpdated);
                }
                throw ex;
            }
        }
        if (result && 'connection' in result) {
            return { selection: 'controller', connection: result.connection };
        } else if (result && 'error' in result) {
            throw InputFlowAction.back;
        }
    }
    protected updateQuickPickItems(quickPick: QuickPick<CompoundQuickPickItem>) {
        quickPick.title = this.provider.title;
        const currentConnections = new Set(
            quickPick.items
                .filter((item) => isKernelPickItem(item))
                .map((item) => item as ConnectionQuickPickItem)
                .map((item) => item.connection.id)
        );
        const items = this.provider.kernels
            .filter((kernel) => !currentConnections.has(kernel.id))
            .map((item) => this.connectionToQuickPick(item));

        this.updateQuickPickWithLatestConnection(quickPick);
        this.removeMissingKernels(quickPick);
        this.updateRecommended(quickPick);

        items.sort((a, b) => a.label.localeCompare(b.label));
        const indexOfExistingCategory = 0;
        const currentItemsInCategory = this.existingItems;
        const currentItemIdsInCategory = new Map(
            Array.from(currentItemsInCategory).map((item) => [item.connection.id, item])
        );
        const oldItemCount = currentItemsInCategory.size;
        items.forEach((item) => {
            const existingItem = currentItemIdsInCategory.get(item.connection.id);
            if (existingItem) {
                currentItemsInCategory.delete(existingItem);
            }
            currentItemsInCategory.add(item);
        });
        const newItems = Array.from(currentItemsInCategory);
        newItems.sort((a, b) => a.label.localeCompare(b.label));
        this.quickPickItems.splice(indexOfExistingCategory + 1, oldItemCount, ...newItems);

        this.rebuildQuickPickItems(quickPick);
    }
    private rebuildQuickPickItems(quickPick: QuickPick<CompoundQuickPickItem>) {
        let recommendedItem = this.recommendedItems.find((item) => isKernelPickItem(item));
        const recommendedConnections = new Set(
            this.recommendedItems.filter(isKernelPickItem).map((item) => item.connection.id)
        );
        // Ensure the recommended items isn't duplicated in the list.
        const connections = this.quickPickItems.filter(
            (item) => !isKernelPickItem(item) || !recommendedConnections.has(item.connection.id)
        );
        const currentActiveItem = quickPick.activeItems.length ? quickPick.activeItems[0] : undefined;
        if (recommendedItem && isKernelPickItem(recommendedItem) && currentActiveItem) {
            if (!isKernelPickItem(currentActiveItem)) {
                // If user has selected a non-kernel item, then we need to ensure the recommended item is not selected.
                // Else always select the recommended item
                recommendedItem = undefined;
            } else if (currentActiveItem.connection.id !== recommendedItem.connection.id) {
                // If user has selected a different kernel, then do not change the selection, leave it as is.
                // Except when the selection is the recommended item (as thats the default).
                recommendedItem = undefined;
            }
        }

        updateKernelQuickPickWithNewItems(quickPick, this.recommendedItems.concat(connections), recommendedItem);
    }
    private removeMissingKernels(quickPick: QuickPick<CompoundQuickPickItem>) {
        const currentConnections = quickPick.items
            .filter((item) => isKernelPickItem(item))
            .map((item) => item as ConnectionQuickPickItem)
            .map((item) => item.connection.id);
        const kernels = new Map<string, KernelConnectionMetadata>(
            this.provider.kernels.map((kernel) => [kernel.id, kernel])
        );
        const removedIds = currentConnections.filter((id) => !kernels.has(id));
        if (removedIds.length) {
            const itemsRemoved: CompoundQuickPickItem[] = [];
            this.existingItems.forEach((item) => {
                if (removedIds.includes(item.connection.id)) {
                    this.existingItems.delete(item);
                    itemsRemoved.push(item);
                }
            });
            this.quickPickItems = this.quickPickItems.filter((item) => !itemsRemoved.includes(item));
            this.rebuildQuickPickItems(quickPick);
        }
    }

    private updateRecommended(quickPick: QuickPick<CompoundQuickPickItem>) {
        if (!this.provider.recommended) {
            this.recommendedItems.length = 0;
            return;
        }
        if (!this.recommendedItems.length) {
            this.recommendedItems.push(<QuickPickItem>{
                label: DataScience.recommendedItemCategoryInQuickPick,
                kind: QuickPickItemKind.Separator
            });
        }
        const recommendedItem = this.connectionToQuickPick(this.provider.recommended, true);
        if (this.recommendedItems.length === 2) {
            this.recommendedItems[1] = recommendedItem;
        } else {
            this.recommendedItems.push(recommendedItem);
        }
        this.rebuildQuickPickItems(quickPick);
    }
    /**
     * Possible the labels have changed, hence update the quick pick labels.
     * E.g. we got more information about an interpreter or a display name of a kernelSpec has changed.
     *
     * Similarly its possible the user updated the kernelSpec args or the like and we need to update the quick pick to have the latest connection object.
     */
    private updateQuickPickWithLatestConnection(quickPick: QuickPick<CompoundQuickPickItem>) {
        const kernels = new Map<string, KernelConnectionMetadata>(
            this.provider.kernels.map((kernel) => [kernel.id, kernel])
        );
        this.recommendedItems.concat(this.quickPickItems).forEach((item) => {
            if (!isKernelPickItem(item) || !kernels.has(item.connection.id)) {
                return;
            }
            const kernel = kernels.get(item.connection.id);
            if (!kernel) {
                return;
            }
            item.label = this.connectionToQuickPick(kernel, item.isRecommended).label;
            item.tooltip = this.connectionToQuickPick(kernel, item.isRecommended).tooltip;
            item.detail = this.connectionToQuickPick(kernel, item.isRecommended).detail;
            item.description = this.connectionToQuickPick(kernel, item.isRecommended).description;
            item.isRecommended = this.connectionToQuickPick(kernel, item.isRecommended).isRecommended;
            item.connection = kernel; // Possible some other information since then has changed, hence keep the connection up to date.
        });
        this.rebuildQuickPickItems(quickPick);
    }

    private connectionToQuickPick(
        connection: KernelConnectionMetadata,
        recommended: boolean = false
    ): ConnectionQuickPickItem {
        // If the recommended item is actually the selected item, then do not display the star.
        const icon = recommended ? '$(star-full) ' : '';
        const setData = (
            info: ConnectionQuickPickItem,
            e: IConnectionDisplayData,
            connection: KernelConnectionMetadata
        ) => {
            info.label = `${icon}${e.label}`;
            info.detail = e.detail;
            info.description = e.description;

            this.quickPickItems.forEach((q) => {
                if ('connection' in q && q.connection.id === connection.id) {
                    q.label = e.label;
                    q.detail = e.detail;
                    q.description = e.description;
                }
            });
        };

        const displayData = this.displayDataProvider.getDisplayData(connection);
        const info: ConnectionQuickPickItem = {
            label: '',
            detail: '',
            description: '',
            isRecommended: recommended,
            connection: connection
        };
        setData(info, displayData, connection);
        displayData.onDidChange((e) => setData(info, e, connection), this, this.disposables);
        traceVerbose(`KernelSelector Quick Pick Item: ${JSON.stringify(info)}`);
        return info;
    }
}
