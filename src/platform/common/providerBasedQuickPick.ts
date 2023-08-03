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
import { Common, DataScience } from './utils/localize';
import { noop } from './utils/misc';
import { IDisposable } from './types';
import { disposeAllDisposables } from './helpers';

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
interface SelectorQuickPickItem<T extends { id: string }> extends QuickPickItem {
    item: T;
}
class CategoryQuickPickItem extends BaseQuickPickItem {
    constructor(
        label: string,
        public readonly sortKey: string
    ) {
        super(label);
        this.kind = QuickPickItemKind.Separator;
    }
}

export interface IQuickPickItemProvider<T extends { id: string }> {
    readonly title: string;
    onDidChange: Event<void>;
    onDidChangeStatus: Event<void>;
    readonly items: readonly T[];
    readonly status: 'discovering' | 'idle';
    refresh: () => Promise<void>;
}
interface CommandQuickPickItem<T extends { id: string }> extends QuickPickItem {
    execute: () => Promise<T | undefined | typeof InputFlowAction.back>;
}

export class BaseProviderBasedQuickPick<T extends { id: string }> extends Disposables {
    private readonly categories = new Map<QuickPickItem, Set<SelectorQuickPickItem<T>>>();
    private quickPickItems: QuickPickItem[] = [];
    private quickPick?: QuickPick<QuickPickItem>;
    private previouslyEnteredValue: string = '';
    private previouslySelectedItem?: CommandQuickPickItem<T>;
    constructor(
        private readonly provider: IQuickPickItemProvider<T>,
        private readonly createQuickPickItem: (item: T, provider: BaseProviderBasedQuickPick<T>) => QuickPickItem,
        private readonly getCategory: (
            item: T,
            provider: BaseProviderBasedQuickPick<T>
        ) => { label: string; sortKey?: string },
        private readonly options: {
            supportsBack: boolean;
        }
    ) {
        super();
    }
    private commands = new Set<CommandQuickPickItem<T>>();
    private _recommended?: T;
    public set recommended(item: T | undefined) {
        this._recommended = item;
    }
    public get recommended() {
        return this._recommended;
    }
    private _placeholder = '';
    public set placeholder(value: string) {
        if (this.quickPick) {
            this.quickPick.placeholder = value;
        }
        this._placeholder = value;
    }
    public get placeholder() {
        return this._placeholder;
    }
    private _selected?: T;
    public set selected(item: T | undefined) {
        const changed = this._selected !== item;
        this._selected = item;
        if (changed && this.quickPick) {
            this.rebuildQuickPickItems(this.quickPick);
        }
    }
    public get selected() {
        return this._selected;
    }
    private readonly quickPickItemMap = new WeakSet<SelectorQuickPickItem<T>>();
    private createQuickPick() {
        const disposables: IDisposable[] = [];
        const refreshButton: QuickInputButton = { iconPath: new ThemeIcon('refresh'), tooltip: Common.refresh };
        const quickPick = (this.quickPick = window.createQuickPick());
        disposables.push(quickPick);
        this.quickPickItems = [];
        quickPick.title = this.provider.title;
        quickPick.placeholder = this.placeholder;
        quickPick.buttons = this.options.supportsBack ? [QuickInputButtons.Back, refreshButton] : [refreshButton];
        quickPick.ignoreFocusOut = true;
        quickPick.busy = this.provider.status === 'discovering';
        quickPick.value = this.previouslyEnteredValue;
        quickPick.onDidChangeValue((e) => (this.previouslyEnteredValue = e), this, disposables);
        quickPick.onDidHide(() => disposeAllDisposables(disposables), this, disposables);
        this.provider.onDidChange(() => this.updateQuickPickItems(quickPick), this, disposables);
        quickPick.onDidTriggerButton(
            async (e) => {
                if (e === refreshButton) {
                    quickPick.busy = true;
                    await this.provider.refresh().catch(noop);
                    quickPick.busy = false;
                }
            },
            this,
            disposables
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
                        disposables.push(new Disposable(() => timeout && clearTimeout(timeout)));
                        break;
                }
            },
            this,
            disposables
        );

        groupBy(
            this.provider.items.map((item) => this.toQuickPickItem(item)),
            (a, b) => compareIgnoreCase(this.getCategory(a.item, this), this.getCategory(b.item, this))
        ).forEach((items) => {
            const item = this.connectionToCategory(items[0].item);
            this.quickPickItems.push(item);
            items.sort((a, b) => a.label.localeCompare(b.label));
            this.quickPickItems.push(...items);
            this.categories.set(item, new Set(items));
        });

        this.updateQuickPickItems(this.quickPick);

        this.disposables.push(...disposables);
        return { quickPick, disposables };
    }
    private isCommandQuickPickItem(item: QuickPickItem): item is CommandQuickPickItem<T> {
        return this.commands.has(item as CommandQuickPickItem<T>);
    }
    public addCommand(item: QuickPickItem, execute: () => Promise<T | undefined | typeof InputFlowAction.back>) {
        const quickPickItem = item as CommandQuickPickItem<T>;
        quickPickItem.execute = execute;
        this.commands.add(quickPickItem);
        if (this.quickPick) {
            this.rebuildQuickPickItems(this.quickPick);
        }
        return {
            dispose: () => {
                this.commands.delete(quickPickItem);
            }
        };
    }
    public async selectItem(
        token: CancellationToken
    ): Promise<T | typeof InputFlowAction.back | typeof InputFlowAction.cancel | undefined> {
        while (!token.isCancellationRequested) {
            const { quickPick, disposables } = this.createQuickPick();
            quickPick.show();
            try {
                this.previouslySelectedItem = undefined;
                const result = await new Promise<T | undefined | typeof InputFlowAction.back | CommandQuickPickItem<T>>(
                    (resolve, _reject) => {
                        quickPick.onDidChangeSelection((e) => {
                            if (e.length) {
                                const selection = e[0];
                                if (this.isSelectorQuickPickItem(selection)) {
                                    resolve(selection.item);
                                } else if (this.isCommandQuickPickItem(selection)) {
                                    resolve(selection);
                                }
                            }
                        });
                        quickPick.onDidTriggerButton(
                            (e) => (e === QuickInputButtons.Back ? resolve(InputFlowAction.back) : undefined),
                            this,
                            disposables
                        );
                        quickPick.onDidHide(() => resolve(undefined), this, disposables);
                    }
                );

                if (token.isCancellationRequested) {
                    return;
                }

                if (!result) {
                    // User escaped the quick pick.
                    return;
                }
                if (result instanceof InputFlowAction) {
                    return result === InputFlowAction.back ? InputFlowAction.back : undefined;
                }

                if (result && 'label' in result && this.isCommandQuickPickItem(result)) {
                    this.previouslySelectedItem = result;
                    // We have a command, execute it, check the result and display the quick pick again.
                    const commandResult = await result.execute();
                    if (!commandResult) {
                        // Re-display the quick pick.
                        continue;
                    }
                    if (commandResult === InputFlowAction.back) {
                        continue;
                    }
                    if (commandResult instanceof InputFlowAction) {
                        return commandResult;
                    }
                    return commandResult;
                }
                return result ? result : undefined;
            } finally {
                disposeAllDisposables(disposables);
            }
        }
    }

    private updateQuickPickItems(quickPick: QuickPick<QuickPickItem>) {
        const currentItems = new Map(
            quickPick.items
                .filter((item) => this.isSelectorQuickPickItem(item))
                .map((item) => item as SelectorQuickPickItem<T>)
                .map((item) => [item.item.id, item.item])
        );

        // Possible some information has changed, update the quick pick items.
        this.quickPickItems = this.quickPickItems.map((item) => {
            if (this.isSelectorQuickPickItem(item)) {
                const latestInfo = currentItems.get(item.item.id);
                if (latestInfo && latestInfo !== item.item) {
                    return this.toQuickPickItem(latestInfo);
                }
            }
            return item;
        });

        const newQuickPickItems = this.provider.items
            .filter((item) => !currentItems.has(item.id))
            .map((item) => this.toQuickPickItem(item));

        this.removeOutdatedQuickPickItems(quickPick);

        groupBy(newQuickPickItems, (a, b) =>
            compareIgnoreCase(this.getCategory(a.item, this), this.getCategory(b.item, this))
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
                const currentCategories: [CategoryQuickPickItem, number][] = this.quickPickItems
                    .filter((item) => item instanceof CategoryQuickPickItem)
                    .map((item, index) => [item as CategoryQuickPickItem, index]);

                currentCategories.push([newCategory, -1]);
                currentCategories.sort((a, b) => a[0].sortKey.localeCompare(b[0].sortKey));

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
        let recommendedItemQuickPick = this.recommended ? this.toQuickPickItem(this.recommended) : undefined;
        const recommendedItems: QuickPickItem[] = [];
        if (recommendedItemQuickPick) {
            recommendedItems.push(
                <QuickPickItem>{
                    label: DataScience.recommendedItemCategoryInQuickPick,
                    kind: QuickPickItemKind.Separator
                },
                recommendedItemQuickPick
            );
        }

        let selectedQuickPickItem = recommendedItemQuickPick;
        selectedQuickPickItem = !this.selected
            ? selectedQuickPickItem
            : this.quickPickItems
                  .filter((item) => this.isSelectorQuickPickItem(item))
                  .map((item) => item as SelectorQuickPickItem<T>)
                  .find((item) => item.item.id === this.selected?.id);

        // Ensure the recommended items isn't duplicated in the list.
        const connections = this.quickPickItems.filter(
            (item) => !this.isSelectorQuickPickItem(item) || item.item.id !== recommendedItemQuickPick?.item?.id
        );
        const currentActiveItem = quickPick.activeItems.length ? quickPick.activeItems[0] : undefined;
        if (selectedQuickPickItem && currentActiveItem) {
            if (!this.isSelectorQuickPickItem(currentActiveItem)) {
                // If user has selected a non-kernel item, then we need to ensure the recommended item is not selected.
                // Else always select the recommended item
                selectedQuickPickItem = undefined;
            } else if (currentActiveItem.item.id !== selectedQuickPickItem.item.id) {
                // If user has selected a different kernel, then do not change the selection, leave it as is.
                // Except when the selection is the recommended item (as thats the default).
                selectedQuickPickItem = undefined;
            }
        }
        const items = (<QuickPickItem[]>[])
            .concat(Array.from(this.commands.values()))
            .concat(recommendedItems)
            .concat(connections);
        const activeItems = selectedQuickPickItem
            ? [selectedQuickPickItem]
            : quickPick.activeItems.length
            ? [quickPick.activeItems[0]]
            : [];
        if (activeItems.length && !items.includes(activeItems[0])) {
            const oldActiveItem = activeItems[0];
            const newActiveQuickPickItem =
                this.isSelectorQuickPickItem(oldActiveItem) &&
                items.find((item) => this.isSelectorQuickPickItem(item) && item.item.id === oldActiveItem.item.id);
            // Find this same quick pick item.
            if (newActiveQuickPickItem) {
                activeItems[0] = newActiveQuickPickItem;
            } else {
                activeItems.length = 0;
            }
        }
        quickPick.items = items;
        quickPick.activeItems = activeItems;

        if (
            !quickPick.activeItems.length &&
            this.previouslySelectedItem &&
            items.includes(this.previouslySelectedItem)
        ) {
            quickPick.activeItems = [this.previouslySelectedItem];
        }
    }
    private isSelectorQuickPickItem(item: QuickPickItem): item is SelectorQuickPickItem<T> {
        return this.quickPickItemMap.has(item as unknown as SelectorQuickPickItem<T>);
    }
    private toQuickPickItem(item: T): SelectorQuickPickItem<T> {
        const quickPickItem = this.createQuickPickItem(item, this) as SelectorQuickPickItem<T>;
        quickPickItem.item = item;
        this.quickPickItemMap.add(quickPickItem);
        return quickPickItem;
    }
    private removeOutdatedQuickPickItems(quickPick: QuickPick<QuickPickItem>) {
        const currentConnections = quickPick.items
            .filter((item) => this.isSelectorQuickPickItem(item))
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

    private connectionToCategory(item: T) {
        const category = this.getCategory(item, this);
        return new CategoryQuickPickItem(category.label, category.sortKey || category.label);
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
