// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationToken,
    Disposable,
    Event,
    MarkdownString,
    QuickInputButton,
    QuickInputButtons,
    QuickPick,
    QuickPickItem,
    QuickPickItemKind,
    ThemeIcon,
    Uri,
    window
} from 'vscode';
import { InputFlowAction } from './utils/multiStepInput';
import { Disposables } from './utils';
import { Common } from './utils/localize';
import { noop } from './utils/misc';

abstract class BaseQuickPickItem implements QuickPickItem {
    label: string;
    kind?: QuickPickItemKind | undefined;
    iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri } | undefined;
    description?: string | undefined;
    detail?: string | undefined;
    picked?: boolean | undefined;
    alwaysShow?: boolean | undefined;
    buttons?: readonly QuickInputButton[] | undefined;
    tooltip?: string | MarkdownString | undefined;
    constructor(label: string) {
        this.label = label;
    }
}
export class SelectorQuickPickItem<T extends { id: string }> extends BaseQuickPickItem {
    constructor(
        label: string,
        public readonly item: T
    ) {
        super(label);
    }
}

export interface IQuickPickItemProvider<T extends { id: string }> {
    readonly title: string;
    onDidChange: Event<void>;
    onDidChangeStatus: Event<void>;
    readonly items: T[];
    readonly status: 'discovering' | 'idle';
    refresh: () => Promise<void>;
}
interface SeparatorQuickPickItem extends QuickPickItem {
    isEmptyCondaEnvironment?: boolean;
}
class CommandQuickPickItem<T extends { id: string }> extends BaseQuickPickItem {
    constructor(
        label: string,
        public readonly execute: () => Promise<T | undefined | typeof InputFlowAction.back>
    ) {
        super(label);
    }
}
function isSelectorQuickPickItem<T extends { id: string }>(item: QuickPickItem): item is SelectorQuickPickItem<T> {
    return item instanceof SelectorQuickPickItem;
}

export class BaseProviderBasedQuickPick<T extends { id: string }> extends Disposables {
    private readonly categories = new Map<QuickPickItem, Set<SelectorQuickPickItem<T>>>();
    private quickPickItems: QuickPickItem[] = [];
    private readonly quickPick: QuickPick<QuickPickItem>;
    private readonly provider: IQuickPickItemProvider<T>;
    private readonly token: CancellationToken;

    constructor(
        private readonly options: {
            provider: IQuickPickItemProvider<T>;
            token: CancellationToken;
            placeholder?: string;
            supportsBack: boolean;
            isSelected?: (item: T) => boolean;
            isRecommended?: (item: T) => boolean;
            toQuickPick: (item: T) => SelectorQuickPickItem<T>;
            getCategory: (item: T) => { label: string; sortKey?: string };
        }
    ) {
        super();
        this.provider = options.provider;
        this.token = options.token;
        const refreshButton: QuickInputButton = { iconPath: new ThemeIcon('refresh'), tooltip: Common.refresh };
        const quickPick = (this.quickPick = window.createQuickPick());
        this.disposables.push(quickPick);
        quickPick.title = this.provider.title;
        quickPick.placeholder = options.placeholder || '';
        quickPick.items = this.getAdditionalQuickPickItems().concat(this.quickPickItems);
        quickPick.buttons = options.supportsBack ? [QuickInputButtons.Back, refreshButton] : [refreshButton];
        quickPick.ignoreFocusOut = true;
        quickPick.busy = this.provider.status === 'discovering';
        quickPick.onDidTriggerButton(
            async (e) => {
                if (e === refreshButton) {
                    quickPick.busy = true;
                    await this.provider.refresh().catch(noop);
                    quickPick.busy = false;
                }
            },
            this,
            this.disposables
        );
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
        this.provider.onDidChange(() => this.updateQuickPickItems(quickPick), this, this.disposables);

        groupBy(
            this.provider.items.map((item) => this.options.toQuickPick(item)),
            (a, b) => compareIgnoreCase(this.options.getCategory(a.item), this.options.getCategory(b.item))
        ).forEach((items) => {
            const item = this.connectionToCategory(items[0].item);
            this.quickPickItems.push(item);
            items.sort((a, b) => a.label.localeCompare(b.label));
            this.quickPickItems.push(...items);
            this.categories.set(item, new Set(items));
        });

        this.updateQuickPickItems(quickPick);
    }

    public async selectItem(): Promise<T | typeof InputFlowAction.back | typeof InputFlowAction.cancel | undefined> {
        if (this.token.isCancellationRequested) {
            return;
        }

        while (true) {
            if (this.token.isCancellationRequested) {
                return;
            }
            this.quickPick.show();
            const result = await new Promise<T | undefined | typeof InputFlowAction.back | CommandQuickPickItem<T>>(
                (resolve, _reject) => {
                    this.quickPick.onDidChangeSelection((e) => {
                        if (e.length) {
                            const selection = e[0];
                            if (isSelectorQuickPickItem<T>(selection)) {
                                resolve(selection.item);
                            } else if (selection instanceof CommandQuickPickItem) {
                                resolve(selection);
                            }
                        }
                    });
                    this.quickPick.onDidTriggerButton(
                        (e) => (e === QuickInputButtons.Back ? resolve(InputFlowAction.back) : undefined),
                        this,
                        this.disposables
                    );
                    this.quickPick.onDidHide(() => resolve(undefined), this, this.disposables);
                }
            );

            if (this.token.isCancellationRequested) {
                return;
            }

            if (!result) {
                // User escaped the quick pick.
                return;
            }
            if (result instanceof InputFlowAction) {
                return result === InputFlowAction.back ? InputFlowAction.back : undefined;
            }

            if (result && result instanceof CommandQuickPickItem) {
                // We have a command, execute it, check the result and display the quick pick again.
                const commandResult = await result.execute();
                if (!commandResult) {
                    // Re-display the quick pick.
                    continue;
                }

                if (commandResult instanceof InputFlowAction) {
                    return commandResult === InputFlowAction.back ? InputFlowAction.back : undefined;
                }
                return commandResult;
            }
            return result ? result : undefined;
        }
    }
    private getAdditionalQuickPickItems(): QuickPickItem[] {
        return [];
    }

    private updateQuickPickItems(quickPick: QuickPick<QuickPickItem>) {
        const currentItems = new Map(
            quickPick.items
                .filter((item) => isSelectorQuickPickItem(item))
                .map((item) => item as SelectorQuickPickItem<T>)
                .map((item) => [item.item.id, item.item])
        );

        // Possible some information has changed, update the quick pick items.
        this.quickPickItems = this.quickPickItems.map((item) => {
            if (isSelectorQuickPickItem(item)) {
                const latestInfo = currentItems.get(item.item.id);
                if (latestInfo && latestInfo !== item.item) {
                    return this.options.toQuickPick(latestInfo);
                }
            }
            return item;
        });

        const newQuickPickItems = this.provider.items
            .filter((item) => !currentItems.has(item.id))
            .map((item) => this.options.toQuickPick(item));

        this.removeOutdatedQuickPickItems(quickPick);

        groupBy(newQuickPickItems, (a, b) =>
            compareIgnoreCase(this.options.getCategory(a.item), this.options.getCategory(b.item))
        ).forEach((items) => {
            items.sort((a, b) => a.label.localeCompare(b.label));
            const newCategory = this.connectionToCategory(items[0].item);
            // Check if we already have a item for this category in the quick pick.
            const existingCategory = this.quickPickItems.find(
                (item) => item.kind === QuickPickItemKind.Separator && item.label === newCategory.label
            );
            if (existingCategory) {
                const indexOfExistingCategory = this.quickPickItems.indexOf(existingCategory);
                const currentItemsInCategory = this.categories.get(existingCategory)!;
                const currentItemIdsInCategory = new Map(
                    Array.from(currentItemsInCategory).map((item) => [item.item.id, item])
                );
                const oldItemCount = currentItemsInCategory.size;
                items.forEach((item) => {
                    const existingItem = currentItemIdsInCategory.get(item.item.id);
                    if (existingItem) {
                        currentItemsInCategory.delete(existingItem);
                    }
                    currentItemsInCategory.add(item);
                });
                const newItems = Array.from(currentItemsInCategory);
                newItems.sort((a, b) => a.label.localeCompare(b.label));
                this.quickPickItems.splice(indexOfExistingCategory + 1, oldItemCount, ...newItems);
            } else {
                // Since we sort items by Env type, ensure this new item is inserted in the right place.
                const currentCategories = this.quickPickItems
                    .map((item, index) => [item, index])
                    .filter(([item, _]) => (item as QuickPickItem).kind === QuickPickItemKind.Separator)
                    .map(([item, index]) => [(item as QuickPickItem).label, index]);

                currentCategories.push([newCategory.label, -1]);
                if (!newCategory.isEmptyCondaEnvironment) {
                    currentCategories.sort((a, b) => a[0].toString().localeCompare(b[0].toString()));
                }

                // Find where we need to insert this new category.
                const indexOfNewCategoryInList = currentCategories.findIndex((item) => item[1] === -1);
                let newIndex = 0;
                if (indexOfNewCategoryInList > 0) {
                    newIndex =
                        currentCategories.length === indexOfNewCategoryInList + 1
                            ? this.quickPickItems.length
                            : (currentCategories[indexOfNewCategoryInList + 1][1] as number);
                }

                items.sort((a, b) => a.label.localeCompare(b.label));
                this.quickPickItems.splice(newIndex, 0, newCategory, ...items);
                this.categories.set(newCategory, new Set(items));
            }
        });
        this.rebuildQuickPickItems(quickPick);
    }
    private rebuildQuickPickItems(quickPick: QuickPick<QuickPickItem>) {
        const recommendedItem = this.provider.items.find((item) =>
            this.options.isRecommended ? this.options.isRecommended(item) : false
        );
        let recommendedItemQuickPick = recommendedItem ? this.options.toQuickPick(recommendedItem) : undefined;
        const recommendedItems: QuickPickItem[] = [];
        if (recommendedItemQuickPick) {
            recommendedItems.push(
                <QuickPickItem>{
                    label: DataScience.recommendedKernelCategoryInQuickPick,
                    kind: QuickPickItemKind.Separator
                },
                recommendedItemQuickPick
            );
        }

        let selectedQuickPickItem = recommendedItemQuickPick;

        const isSelected = this.options.isSelected;
        if (isSelected) {
            selectedQuickPickItem =
                this.quickPickItems
                    .filter((item) => isSelectorQuickPickItem(item))
                    .map((item) => item as SelectorQuickPickItem<T>)
                    .find((item) => isSelected!(item.item as T)) || selectedQuickPickItem;
        }
        // Ensure the recommended items isn't duplicated in the list.
        const connections = this.quickPickItems.filter(
            (item) => !isSelectorQuickPickItem(item) || item.item.id !== recommendedItemQuickPick?.item?.id
        );
        const currentActiveItem = quickPick.activeItems.length ? quickPick.activeItems[0] : undefined;
        if (selectedQuickPickItem && currentActiveItem) {
            if (!isSelectorQuickPickItem(currentActiveItem)) {
                // If user has selected a non-kernel item, then we need to ensure the recommended item is not selected.
                // Else always select the recommended item
                selectedQuickPickItem = undefined;
            } else if (currentActiveItem.item.id !== selectedQuickPickItem.item.id) {
                // If user has selected a different kernel, then do not change the selection, leave it as is.
                // Except when the selection is the recommended item (as thats the default).
                selectedQuickPickItem = undefined;
            }
        }
        const items = this.getAdditionalQuickPickItems().concat(recommendedItems).concat(connections);
        const activeItems = selectedQuickPickItem
            ? [selectedQuickPickItem]
            : quickPick.activeItems.length
            ? [quickPick.activeItems[0]]
            : [];
        if (activeItems.length && !items.includes(activeItems[0])) {
            const oldActiveItem = activeItems[0];
            const newActiveQuickPickItem =
                isSelectorQuickPickItem(oldActiveItem) &&
                items.find((item) => isSelectorQuickPickItem(item) && item.item.id === oldActiveItem.item.id);
            // Find this same quick pick item.
            if (newActiveQuickPickItem) {
                activeItems[0] = newActiveQuickPickItem;
            } else {
                activeItems.length = 0;
            }
        }
        quickPick.items = items;
        quickPick.activeItems = activeItems;
    }
    private removeOutdatedQuickPickItems(quickPick: QuickPick<QuickPickItem>) {
        const currentConnections = quickPick.items
            .filter((item) => isSelectorQuickPickItem(item))
            .map((item) => item as SelectorQuickPickItem<T>)
            .map((item) => item.item.id);
        const items = new Map<string, T>(this.provider.items.map((item) => [item.id, item]));
        const removedIds = currentConnections.filter((id) => !items.has(id));
        if (removedIds.length) {
            const itemsRemoved: QuickPickItem[] = [];
            this.categories.forEach((items, category) => {
                items.forEach((item) => {
                    if (removedIds.includes(item.item.id)) {
                        items.delete(item);
                        itemsRemoved.push(item);
                    }
                });
                if (!items.size) {
                    itemsRemoved.push(category);
                    this.categories.delete(category);
                }
            });
            this.quickPickItems = this.quickPickItems.filter((item) => !itemsRemoved.includes(item));
            this.rebuildQuickPickItems(quickPick);
        }
    }

    private connectionToCategory(item: T): SeparatorQuickPickItem {
        return {
            kind: QuickPickItemKind.Separator,
            label: this.options.getCategory(item).label
        };
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

function compareIgnoreCase(a: { label: string; sortKey?: string }, b: { label: string; sortKey?: string }) {
    return (a.sortKey || a.label).localeCompare(b.sortKey || b.label, undefined, { sensitivity: 'accent' });
}
