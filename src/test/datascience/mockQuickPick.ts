// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { Event, EventEmitter, QuickInputButton, QuickPick, QuickPickItem, QuickPickItemButtonEvent } from 'vscode';

export class MockQuickPick implements QuickPick<QuickPickItem> {
    public value: string = '';
    public placeholder: string | undefined;
    public title: string | undefined = 'foo';
    public step: number | undefined;
    public totalSteps: number | undefined;
    public enabled: boolean = true;
    public busy: boolean = false;
    public ignoreFocusOut: boolean = true;
    public items: QuickPickItem[] = [];
    public canSelectMany: boolean = false;
    public matchOnDescription: boolean = false;
    public matchOnDetail: boolean = false;
    public buttons: QuickInputButton[] = [];
    public sortByLabel: boolean = true;
    private didChangeValueEmitter: EventEmitter<string> = new EventEmitter<string>();
    private didTriggerItemButton: EventEmitter<QuickPickItemButtonEvent<QuickPickItem>> = new EventEmitter<
        QuickPickItemButtonEvent<QuickPickItem>
    >();
    private didAcceptEmitter: EventEmitter<void> = new EventEmitter<void>();
    private didTriggerButtonEmitter: EventEmitter<QuickInputButton> = new EventEmitter<QuickInputButton>();
    private didChangeActiveEmitter: EventEmitter<QuickPickItem[]> = new EventEmitter<QuickPickItem[]>();
    private didChangeSelectedEmitter: EventEmitter<QuickPickItem[]> = new EventEmitter<QuickPickItem[]>();
    private didHideEmitter: EventEmitter<void> = new EventEmitter<void>();
    private _activeItems: QuickPickItem[] = [];
    private _pickedItem: string;
    private _hidden: boolean = false;
    constructor(pickedItem: string) {
        this._pickedItem = pickedItem;
    }

    public get onDidTriggerItemButton(): Event<QuickPickItemButtonEvent<QuickPickItem>> {
        return this.didTriggerItemButton.event;
    }

    public get onDidChangeValue(): Event<string> {
        return this.didChangeValueEmitter.event;
    }
    public get onDidAccept(): Event<void> {
        return this.didAcceptEmitter.event;
    }
    public get onDidTriggerButton(): Event<QuickInputButton> {
        return this.didTriggerButtonEmitter.event;
    }
    public get activeItems(): QuickPickItem[] {
        return this._activeItems;
    }
    public set activeItems(items: QuickPickItem[]) {
        this._activeItems = items;
        this.didChangeActiveEmitter.fire(items);
    }
    public get onDidChangeActive(): Event<QuickPickItem[]> {
        return this.didChangeActiveEmitter.event;
    }
    public get selectedItems(): readonly QuickPickItem[] {
        return [];
    }
    public get onDidChangeSelection(): Event<QuickPickItem[]> {
        return this.didChangeSelectedEmitter.event;
    }
    public get onDidHide(): Event<void> {
        return this.didHideEmitter.event;
    }
    public show(): void {
        // After a timeout select the item
        setTimeout(() => {
            const item = this.items.find((a) => a.label === this._pickedItem);
            if (item) {
                this.didChangeSelectedEmitter.fire([item]);
            } else if (this._pickedItem) {
                this.value = this._pickedItem;
                this.didAcceptEmitter.fire();
                setTimeout(() => {
                    if (!this._hidden) {
                        // Validation should have failed.
                        this.didHideEmitter.fire();
                    }
                }, 1);
            } else {
                this.didHideEmitter.fire();
            }
        }, 1);
    }
    public hide(): void {
        this._hidden = true;
    }
    public dispose(): void {
        // Do nothing.
    }
}
