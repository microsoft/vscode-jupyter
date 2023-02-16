// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationToken,
    CancellationTokenSource,
    commands,
    Disposable,
    NotebookDocument,
    QuickInputButton,
    QuickPick,
    QuickPickItem,
    QuickPickItemKind,
    ThemeIcon
} from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { KernelConnectionMetadata } from '../../../kernels/types';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { Commands } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import { ServiceContainer } from '../../../platform/ioc/container';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { ConnectionDisplayDataProvider } from '../connectionDisplayData';
import { PythonEnvKernelConnectionCreator } from '../pythonEnvKernelConnectionCreator';
import {
    CommandQuickPickItem,
    ConnectionQuickPickItem,
    KernelListErrorQuickPickItem,
    ConnectionSeparatorQuickPickItem,
    IQuickPickKernelItemProvider
} from './types';
type CompoundQuickPickItem =
    | CommandQuickPickItem
    | ConnectionQuickPickItem
    | KernelListErrorQuickPickItem
    | ConnectionSeparatorQuickPickItem
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
    items: CompoundQuickPickItem[];
    buttons: QuickInputButton[];
    onDidTriggerButton: (e: QuickInputButton) => void;
}) => {
    quickPick: QuickPick<CompoundQuickPickItem>;
    selection: Promise<CompoundQuickPickItem>;
};

/**
 * Exclude Conda environments that do not have Python (until https://github.com/microsoft/vscode-jupyter/issues/11855).
 */
function removeCondaEnvWithoutPython(kernel: KernelConnectionMetadata) {
    if (kernel.kind !== 'startUsingPythonInterpreter') {
        return true;
    }
    if (kernel.interpreter.isCondaEnvWithoutPython) {
        return false;
    }
    return true;
}
/**
 * Used to indicate the fact that the quick pick workflow
 * has been successfully completed.
 * Do not use `CancellationError` as that indicates the user stopped the workflow.
 * & VS Code will re-display the quick pick, & that's not something we want as the user has taken an action.
 */
class SomeOtherActionError extends Error {}

export class KernelSelector implements IDisposable {
    private disposables: IDisposable[] = [];
    private readonly displayDataProvider: ConnectionDisplayDataProvider;
    private readonly extensionChecker: IPythonExtensionChecker;
    private readonly recommendedItems: (QuickPickItem | ConnectionQuickPickItem)[] = [];
    private readonly createPythonItems: CompoundQuickPickItem[] = [];
    private readonly installPythonExtItems: CompoundQuickPickItem[] = [];
    private readonly installPythonItems: CompoundQuickPickItem[] = [];
    private readonly categories = new Map<QuickPickItem, Set<ConnectionQuickPickItem>>();
    private quickPickItems: (QuickPickItem | ConnectionQuickPickItem)[] = [];
    private readonly installPythonExtension: CommandQuickPickItem;
    private readonly installPythonItem: CommandQuickPickItem;
    private readonly createPythonEnvQuickPickItem: CommandQuickPickItem;
    constructor(
        private readonly workspace: IWorkspaceService,
        private readonly notebook: NotebookDocument,
        private readonly provider: IQuickPickKernelItemProvider,
        private readonly token: CancellationToken
    ) {
        this.displayDataProvider =
            ServiceContainer.instance.get<ConnectionDisplayDataProvider>(ConnectionDisplayDataProvider);
        this.extensionChecker = ServiceContainer.instance.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        this.createPythonEnvQuickPickItem = {
            label: `$(add) ${DataScience.createPythonEnvironmentInQuickPick}`,
            command: this.onCreatePythonEnvironment.bind(this)
        };
        this.installPythonItem = {
            label: DataScience.installPythonTitle,
            command: async () => {
                // Timeout as we want the quick pick to close before we start this process.
                setTimeout(() => commands.executeCommand(Commands.InstallPythonViaKernelPicker).then(noop, noop));
                throw new SomeOtherActionError();
            }
        };
        this.installPythonExtension = {
            label: DataScience.installPythonExtensionViaKernelPickerTitle,
            command: async () => {
                // TODO: Once user installs Python wait here and refresh this UI so we display the Python Envs.
                const installed = await commands.executeCommand(Commands.InstallPythonExtensionViaKernelPicker);
                if (installed === true) {
                    // refresh the view and wait here
                    this.provider.refresh().catch(noop);
                    // TODO: Re-display the quick pick so user can pick a kernel.
                    return undefined;
                } else {
                    throw new SomeOtherActionError();
                }
            }
        };
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public async selectKernel(
        quickPickFactory: CreateAndSelectItemFromQuickPick
    ): Promise<
        | { selection: 'controller'; finder: IContributedKernelFinder; connection: KernelConnectionMetadata }
        | { selection: 'userPerformedSomeOtherAction' }
        | undefined
    > {
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

        const connectionPickItems = this.provider.kernels
            .filter(removeCondaEnvWithoutPython)
            .map((connection) => connectionToQuickPick(connection));

        // Insert separators into the right spots in the list
        groupBy(connectionPickItems, (a, b) =>
            compareIgnoreCase(
                getCategoryForSorting(a.connection, this.displayDataProvider),
                getCategoryForSorting(b.connection, this.displayDataProvider)
            )
        ).forEach((items) => {
            const item = connectionToCategory(items[0].connection);
            this.quickPickItems.push(item);
            items.sort((a, b) => a.label.localeCompare(b.label));
            this.quickPickItems.push(...items);
            this.categories.set(item, new Set(items));
        });

        const refreshButton: QuickInputButton = { iconPath: new ThemeIcon('refresh'), tooltip: Common.refresh };
        const refreshingButton: QuickInputButton = {
            iconPath: new ThemeIcon('loading~spin'),
            tooltip: Common.refreshing
        };

        if (
            !this.extensionChecker.isPythonExtensionInstalled &&
            this.provider.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) {
            this.installPythonExtItems.push(this.installPythonExtension);
        }

        let quickPickToBeUpdated: QuickPick<CompoundQuickPickItem> | undefined;
        if (
            this.extensionChecker.isPythonExtensionInstalled &&
            this.provider.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) {
            if (
                this.provider.kernels.filter(removeCondaEnvWithoutPython).length === 0 &&
                this.provider.status === 'idle'
            ) {
                if (this.workspace.isTrusted) {
                    // Python extension cannot create envs if there are no python environments.
                    this.installPythonItems.push(this.installPythonItem);
                }
            } else {
                const updatePythonItems = () => {
                    if (
                        this.provider.kernels.filter(removeCondaEnvWithoutPython).length === 0 &&
                        this.installPythonItems.length === 0 &&
                        this.provider.status === 'idle'
                    ) {
                        if (this.workspace.isTrusted) {
                            this.installPythonItems.push(this.installPythonItem);
                            if (quickPickToBeUpdated) {
                                this.updateQuickPickItems(quickPickToBeUpdated);
                            }
                        }
                    } else if (this.provider.kernels.filter(removeCondaEnvWithoutPython).length) {
                        this.installPythonItems.length = 0;
                        if (quickPickToBeUpdated) {
                            this.updateQuickPickItems(quickPickToBeUpdated);
                        }
                    }
                };
                this.provider.onDidChangeStatus(updatePythonItems, this, this.disposables);
                this.provider.onDidChange(updatePythonItems, this, this.disposables);
            }
        }
        if (
            this.extensionChecker.isPythonExtensionInstalled &&
            this.provider.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) {
            if (this.provider.kernels.filter(removeCondaEnvWithoutPython).length > 0) {
                // Python extension cannot create envs if there are no python environments.
                this.createPythonItems.push(this.createPythonEnvQuickPickItem);
            } else {
                this.provider.onDidChange(
                    () => {
                        if (
                            this.provider.kernels.filter(removeCondaEnvWithoutPython).length > 0 &&
                            this.createPythonItems.length === 0
                        ) {
                            this.createPythonItems.push(this.createPythonEnvQuickPickItem);
                        }
                    },
                    this,
                    this.disposables
                );
            }
        }
        const { quickPick, selection } = quickPickFactory({
            title: this.provider.title,
            items: this.installPythonItems
                .concat(this.installPythonExtItems)
                .concat(this.createPythonItems)
                .concat(this.quickPickItems),
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
        quickPickToBeUpdated = quickPick;
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
        this.provider.onDidFailToListKernels(
            (error) => this.updateListWithError(quickPick, error),
            this,
            this.disposables
        );
        this.provider.onDidChange(() => this.updateQuickPickItems(quickPick), this, this.disposables);

        const result = await selection;
        if (this.token.isCancellationRequested) {
            return;
        }

        if (isCommandQuickPickItem(result)) {
            try {
                const connection = await result.command();
                return connection
                    ? { selection: 'controller', finder: this.provider.finder!, connection: connection }
                    : undefined;
            } catch (ex) {
                if (ex instanceof SomeOtherActionError) {
                    return { selection: 'userPerformedSomeOtherAction' };
                }
                throw ex;
            }
        }
        if (result && 'connection' in result) {
            return { selection: 'controller', finder: this.provider.finder!, connection: result.connection };
        } else if (result && 'error' in result) {
            throw InputFlowAction.back;
        }
    }
    private onCreatePythonEnvironment() {
        const cancellationToken = new CancellationTokenSource();
        this.disposables.push(new Disposable(() => cancellationToken.cancel()));
        this.disposables.push(cancellationToken);

        const creator = new PythonEnvKernelConnectionCreator(this.notebook, cancellationToken.token);
        this.disposables.push(creator);
        return creator.createPythonEnvFromKernelPicker();
    }
    private updateQuickPickItems(quickPick: QuickPick<CompoundQuickPickItem>) {
        quickPick.title = this.provider.title;
        const currentConnections = new Set(
            quickPick.items
                .filter((item) => isKernelPickItem(item))
                .map((item) => item as ConnectionQuickPickItem)
                .map((item) => item.connection.id)
        );
        const newQuickPickItems = this.provider.kernels
            .filter(removeCondaEnvWithoutPython)
            .filter((kernel) => !currentConnections.has(kernel.id))
            .map((item) => this.connectionToQuickPick(item));

        if (
            this.extensionChecker.isPythonExtensionInstalled &&
            this.provider.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) {
            this.installPythonExtItems.length = 0;
        }
        if (
            this.provider.kind === ContributedKernelFinderKind.LocalPythonEnvironment &&
            this.provider.kernels
                .filter(removeCondaEnvWithoutPython)
                .some((k) => k.kind === 'startUsingPythonInterpreter')
        ) {
            this.installPythonItems.length = 0;
        }
        this.updateQuickPickWithLatestConnection(quickPick);
        this.removeMissingKernels(quickPick);
        this.updateRecommended(quickPick);

        groupBy(newQuickPickItems, (a, b) =>
            compareIgnoreCase(
                getCategoryForSorting(a.connection, this.displayDataProvider),
                getCategoryForSorting(b.connection, this.displayDataProvider)
            )
        ).forEach((items) => {
            items.sort((a, b) => a.label.localeCompare(b.label));
            const newCategory = this.connectionToCategory(items[0].connection);
            // Check if we already have a item for this category in the quick pick.
            const existingCategory = this.quickPickItems.find(
                (item) =>
                    item.kind === QuickPickItemKind.Separator &&
                    item.label === newCategory.label &&
                    (newCategory.isEmptyCondaEnvironment
                        ? 'isEmptyCondaEnvironment' in item && item.isEmptyCondaEnvironment
                        : true)
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
    private buildErrorQuickPickItem(error?: Error): KernelListErrorQuickPickItem[] {
        if (this.provider.kind === ContributedKernelFinderKind.Remote && error) {
            this.provider.finder?.displayName;
            return [
                {
                    error,
                    label: DataScience.failedToFetchKernelSpecsRemoteErrorMessageForQuickPickLabel,
                    detail: DataScience.failedToFetchKernelSpecsRemoteErrorMessageForQuickPickDetail
                }
            ];
        }
        // This is an unlikely scenario, and we don't want to display an messages here.
        // The only other providers are local kernels pecs and local python environments.
        return [];
    }
    private rebuildQuickPickItems(quickPick: QuickPick<CompoundQuickPickItem>, error?: Error) {
        const recommendedItem = this.recommendedItems.find((item) => isKernelPickItem(item));
        const recommendedConnections = new Set(
            this.recommendedItems.filter(isKernelPickItem).map((item) => item.connection.id)
        );
        // Ensure the recommended items isn't duplicated in the list.
        const connections = this.quickPickItems.filter(
            (item) => !isKernelPickItem(item) || !recommendedConnections.has(item.connection.id)
        );
        const errorItems = this.buildErrorQuickPickItem(error);
        updateKernelQuickPickWithNewItems(
            quickPick,
            this.installPythonItems
                .concat(this.installPythonExtItems)
                .concat(this.createPythonItems)
                .concat(this.recommendedItems)
                .concat(connections)
                .concat(errorItems),
            recommendedItem
        );
    }
    private removeMissingKernels(quickPick: QuickPick<CompoundQuickPickItem>) {
        const currentConnections = quickPick.items
            .filter((item) => isKernelPickItem(item))
            .map((item) => item as ConnectionQuickPickItem)
            .map((item) => item.connection.id);
        const kernels = new Map<string, KernelConnectionMetadata>(
            this.provider.kernels.filter(removeCondaEnvWithoutPython).map((kernel) => [kernel.id, kernel])
        );
        const removedIds = currentConnections.filter((id) => !kernels.has(id));
        if (removedIds.length) {
            const itemsRemoved: CompoundQuickPickItem[] = [];
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
            this.quickPickItems = this.quickPickItems.filter((item) => !itemsRemoved.includes(item));
            this.rebuildQuickPickItems(quickPick);
        }
    }

    private updateListWithError(quickPick: QuickPick<CompoundQuickPickItem>, error: Error) {
        this.rebuildQuickPickItems(quickPick, error);
    }
    private updateRecommended(quickPick: QuickPick<CompoundQuickPickItem>) {
        if (!this.provider.recommended) {
            this.recommendedItems.length = 0;
            return;
        }
        if (!this.recommendedItems.length) {
            this.recommendedItems.push(<QuickPickItem>{
                label: DataScience.recommendedKernelCategoryInQuickPick,
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
            this.provider.kernels.filter(removeCondaEnvWithoutPython).map((kernel) => [kernel.id, kernel])
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
        this.rebuildQuickPickItems(quickPick);
    }

    private connectionToQuickPick(
        connection: KernelConnectionMetadata,
        recommended: boolean = false
    ): ConnectionQuickPickItem {
        const displayData = this.displayDataProvider.getDisplayData(connection);
        const icon = recommended
            ? '$(star-full) '
            : connection.kind === 'startUsingPythonInterpreter' && connection.interpreter.isCondaEnvWithoutPython
            ? '$(warning) '
            : '';
        return {
            label: `${icon}${displayData.label}`,
            isRecommended: recommended,
            detail: displayData.detail,
            description: displayData.description,
            connection: connection
        };
    }

    private connectionToCategory(connection: KernelConnectionMetadata): ConnectionSeparatorQuickPickItem {
        const kind = this.displayDataProvider.getDisplayData(connection).category || 'Other';
        const isEmptyCondaEnvironment =
            connection.kind === 'startUsingPythonInterpreter' &&
            connection.interpreter.isCondaEnvWithoutPython === true;
        return {
            kind: QuickPickItemKind.Separator,
            label: kind,
            isEmptyCondaEnvironment
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
function getCategoryForSorting(
    connection: KernelConnectionMetadata,
    displayDataProvider: ConnectionDisplayDataProvider
) {
    if (connection.kind === 'startUsingPythonInterpreter' && connection.interpreter.isCondaEnvWithoutPython) {
        // Conda environments without Python are always at the bottom.
        return 'zCondaWithoutPython';
    }
    return displayDataProvider.getDisplayData(connection).category || 'z';
}
