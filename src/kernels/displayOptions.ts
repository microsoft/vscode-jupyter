// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, EventEmitter } from 'vscode';
import { IDisplayOptions } from '../platform/common/types';

/**
 * Settings used when doing auto starts to determine if messages should be shown to the user or not.
 */
export class DisplayOptions implements IDisplayOptions {
    private _disableUI: boolean;
    public get disableUI(): boolean {
        return this._disableUI;
    }
    public set disableUI(value: boolean) {
        const fireEvent = this._disableUI !== value;
        this._disableUI = value;
        if (fireEvent) {
            this._event.fire();
        }
    }
    private _event = new EventEmitter<void>();
    public get onDidChangeDisableUI(): Event<void> {
        return this._event.event;
    }
    constructor(disableUI: boolean) {
        this._disableUI = disableUI;
    }
    public dispose() {
        this._event.dispose();
    }
}
