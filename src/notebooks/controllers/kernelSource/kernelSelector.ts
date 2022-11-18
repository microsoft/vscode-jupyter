// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import {
    CancellationToken,
    CancellationTokenSource,
    Disposable,
    NotebookDocument,
    QuickInputButton,
    QuickPick,
    QuickPickItem,
    QuickPickItemKind,
    ThemeIcon
} from 'vscode';
import { ContributedKernelFinderKind } from '../../../kernels/internalTypes';
import { KernelConnectionMetadata } from '../../../kernels/types';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { ServiceContainer } from '../../../platform/ioc/container';
import { ConnectionDisplayDataProvider } from '../connectionDisplayData';
import { PythonEnvKernelConnectionCreator } from '../pythonEnvKernelConnectionCreator';
import { IControllerSelection } from '../types';
import { ConnectionQuickPickItem, IQuickPickKernelItemProvider } from './types';

export function isKernelPickItem(item: ConnectionQuickPickItem | QuickPickItem): item is ConnectionQuickPickItem {
    return 'connection' in item;
}
function updateKernelQuickPickWithNewItems<T extends ConnectionQuickPickItem | QuickPickItem>(
    quickPick: QuickPick<T>,
    items: T[],
    activeItem?: T
) {
    const activeItems = quickPick.activeItems.length ? [quickPick.activeItems[0]] : activeItem ? [activeItem] : [];
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
    quickPick.activeItems = activeItems;
}

export type CreateAndSelectItemFromQuickPick = (options: {
    title: string;
    items: (ConnectionQuickPickItem | QuickPickItem)[];
    buttons: QuickInputButton[];
    onDidTriggerButton: (e: QuickInputButton) => void;
}) => {
    quickPick: QuickPick<ConnectionQuickPickItem | QuickPickItem>;
    selection: Promise<ConnectionQuickPickItem | QuickPickItem>;
};

export class KernelSelector implements IDisposable {
    private disposables: IDisposable[] = [];
    private readonly displayDataProvider: ConnectionDisplayDataProvider;
    private readonly extensionChecker: IPythonExtensionChecker;
    private readonly recommendedItems: (QuickPickItem | ConnectionQuickPickItem)[] = [];
    private readonly createPythonItems: (ConnectionQuickPickItem | QuickPickItem)[] = [];
    private readonly categories = new Map<QuickPickItem, Set<ConnectionQuickPickItem>>();
    private quickPickItems: (QuickPickItem | ConnectionQuickPickItem)[] = [];
    private readonly trackedKernelIds = new Set<string>();
    constructor(
        private readonly notebook: NotebookDocument,
        private readonly provider: IQuickPickKernelItemProvider,
        private readonly token: CancellationToken
    ) {
        this.displayDataProvider =
            ServiceContainer.instance.get<ConnectionDisplayDataProvider>(ConnectionDisplayDataProvider);
        this.extensionChecker = ServiceContainer.instance.get<IPythonExtensionChecker>(IPythonExtensionChecker);
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public async selectKernel(
        quickPickFactory: CreateAndSelectItemFromQuickPick
    ): Promise<KernelConnectionMetadata | undefined> {
        if (this.token.isCancellationRequested) {
            return;
        }

        const connectionToQuickPick = (connection: KernelConnectionMetadata): ConnectionQuickPickItem => {
            const displayData = this.displayDataProvider.getDisplayData(connection);
            return {
                label: displayData.label,
                detail: displayData.detail,
                description: displayData.description,
                connection: connection
            };
        };

        const connectionToCategory = (connection: KernelConnectionMetadata): QuickPickItem => {
            const kind = this.displayDataProvider.getDisplayData(connection).category || 'Other';
            return {
                kind: QuickPickItemKind.Separator,
                label: kind
            };
        };

        const connectionPickItems = this.provider.kernels.map((connection) => connectionToQuickPick(connection));

        // Insert separators into the right spots in the list
        groupBy(connectionPickItems, (a, b) =>
            compareIgnoreCase(
                this.displayDataProvider.getDisplayData(a.connection).category || 'z',
                this.displayDataProvider.getDisplayData(b.connection).category || 'z'
            )
        ).forEach((items) => {
            const item = connectionToCategory(items[0].connection);
            this.quickPickItems.push(item);
            items.sort((a, b) => a.label.localeCompare(b.label));
            this.quickPickItems.push(...items);
            this.categories.set(item, new Set(items));
        });

        const refreshButton: QuickInputButton = { iconPath: new ThemeIcon('refresh'), tooltip: Common.refresh() };
        const refreshingButton: QuickInputButton = {
            iconPath: new ThemeIcon('loading~spin'),
            tooltip: Common.refreshing()
        };

        let createPythonQuickPickItem: QuickPickItem | undefined;
        if (
            this.extensionChecker.isPythonExtensionInstalled &&
            this.provider.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) {
            createPythonQuickPickItem = {
                label: `$(add) ${DataScience.createPythonEnvironmentInQuickPick()}`
            };
            this.createPythonItems.push(createPythonQuickPickItem);
        }
        const { quickPick, selection } = quickPickFactory({
            title: this.provider.title,
            items: this.createPythonItems.concat(this.quickPickItems),
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

        if (createPythonQuickPickItem && result === createPythonQuickPickItem) {
            const creator = new PythonEnvKernelConnectionCreator();
            this.disposables.push(creator);
            const cancellationToken = new CancellationTokenSource();
            this.disposables.push(cancellationToken);
            const controllerSelection = ServiceContainer.instance.get<IControllerSelection>(IControllerSelection);
            // If user selects another controller for this notebook, then stop waiting for the environment to be created.
            controllerSelection.onControllerSelected(
                (e) => e.notebook === this.notebook && cancellationToken.cancel(),
                this,
                this.disposables
            );

            return creator.createPythonEnvFromKernelPicker(this.notebook, cancellationToken.token);
        }
        if (result && 'connection' in result) {
            return result.connection;
        }
    }
    private updateQuickPickItems(quickPick: QuickPick<ConnectionQuickPickItem | QuickPickItem>) {
        quickPick.title = this.provider.title;
        const newQuickPickItems = this.provider.kernels
            .filter((kernel) => {
                if (!this.trackedKernelIds.has(kernel.id)) {
                    this.trackedKernelIds.add(kernel.id);
                    return true;
                }
                return false;
            })
            .map((item) => this.connectionToQuickPick(item));

        this.updateQuickPickWithLatestConnection(quickPick);
        this.removeMissingKernels(quickPick);
        groupBy(newQuickPickItems, (a, b) =>
            compareIgnoreCase(
                this.displayDataProvider.getDisplayData(a.connection).category || 'z',
                this.displayDataProvider.getDisplayData(b.connection).category || 'z'
            )
        ).forEach((items) => {
            items.sort((a, b) => a.label.localeCompare(b.label));
            const newCategory = this.connectionToCategory(items[0].connection);
            // Check if we already have a item for this category in the quick pick.
            const existingCategory = this.quickPickItems.find(
                (item) => item.kind === QuickPickItemKind.Separator && item.label === newCategory.label
            );
            if (existingCategory) {
                const indexOfExistingCategory = this.quickPickItems.indexOf(existingCategory);
                const currentItemsInCategory = this.categories.get(existingCategory)!;
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
            } else {
                // Since we sort items by Env type, ensure this new item is inserted in the right place.
                const currentCategories = this.quickPickItems
                    .map((item, index) => [item, index])
                    .filter(([item, _]) => (item as QuickPickItem).kind === QuickPickItemKind.Separator)
                    .map(([item, index]) => [(item as QuickPickItem).label, index]);

                currentCategories.push([newCategory.label, -1]);
                currentCategories.sort((a, b) => a[0].toString().localeCompare(b[0].toString()));

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
            updateKernelQuickPickWithNewItems(
                quickPick,
                this.createPythonItems.concat(this.recommendedItems).concat(this.quickPickItems)
            );
        });
    }

    private removeMissingKernels(quickPick: QuickPick<ConnectionQuickPickItem | QuickPickItem>) {
        const kernels = new Map<string, KernelConnectionMetadata>(
            this.provider.kernels.map((kernel) => [kernel.id, kernel])
        );
        const removedIds = Array.from(this.trackedKernelIds).filter((id) => !kernels.has(id));
        if (removedIds.length) {
            const itemsRemoved: (ConnectionQuickPickItem | QuickPickItem)[] = [];
            this.categories.forEach((items, category) => {
                items.forEach((item) => {
                    if (removedIds.includes(item.connection.id)) {
                        items.delete(item);
                        itemsRemoved.push(item);
                    }
                });
                if (!items.size) {
                    itemsRemoved.push(category);
                    this.categories.delete(category);
                }
            });
            updateKernelQuickPickWithNewItems(
                quickPick,
                this.createPythonItems
                    .concat(this.recommendedItems)
                    .concat(this.quickPickItems.filter((item) => !itemsRemoved.includes(item))),
                this.recommendedItems[1]
            );
        }
    }
    private updateRecommended(quickPick: QuickPick<ConnectionQuickPickItem | QuickPickItem>) {
        if (!this.provider.recommended) {
            return;
        }
        if (!this.recommendedItems.length) {
            this.recommendedItems.push(<QuickPickItem>{
                label: DataScience.recommendedKernelCategoryInQuickPick(),
                kind: QuickPickItemKind.Separator
            });
        }
        const recommendedItem = this.connectionToQuickPick(this.provider.recommended, true);
        if (this.recommendedItems.length === 2) {
            this.recommendedItems[1] = recommendedItem;
        } else {
            this.recommendedItems.push(recommendedItem);
        }
        updateKernelQuickPickWithNewItems(
            quickPick,
            this.createPythonItems.concat(this.recommendedItems).concat(this.quickPickItems),
            this.recommendedItems[1]
        );
    }
    /**
     * Possible the labels have changed, hence update the quick pick labels.
     * E.g. we got more information about an interpreter or a display name of a kernelSpec has changed.
     *
     * Similarly its possible the user updated the kernelSpec args or the like and we need to update the quick pick to have the latest connection object.
     */
    private updateQuickPickWithLatestConnection(quickPick: QuickPick<ConnectionQuickPickItem | QuickPickItem>) {
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
            item.connection = kernel; // Possible some other information since then has changed, hence keep the connection up to date.
        });
        updateKernelQuickPickWithNewItems(
            quickPick,
            this.createPythonItems.concat(this.recommendedItems).concat(this.quickPickItems),
            this.recommendedItems[1]
        );
    }

    private connectionToQuickPick(
        connection: KernelConnectionMetadata,
        recommended: boolean = false
    ): ConnectionQuickPickItem {
        const displayData = this.displayDataProvider.getDisplayData(connection);
        return {
            label: `${recommended ? '$(star-full) ' : ''}${displayData.label}`,
            isRecommended: recommended,
            detail: displayData.detail,
            description: displayData.description,
            connection: connection
        };
    }

    private connectionToCategory(connection: KernelConnectionMetadata): QuickPickItem {
        const kind = this.displayDataProvider.getDisplayData(connection).category || 'Other';
        return {
            kind: QuickPickItemKind.Separator,
            label: kind
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

function compareIgnoreCase(a: string, b: string) {
    return a.localeCompare(b, undefined, { sensitivity: 'accent' });
}
