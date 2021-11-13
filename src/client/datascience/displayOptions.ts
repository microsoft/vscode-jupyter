// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Event, EventEmitter } from 'vscode';
import { IDisplayOptions } from './types';

export class DisplayOptions implements IDisplayOptions {
    private _disableUI: boolean;
    public get disableUI(): boolean {
        return this._disableUI;
    }
    public set disableUI(value: boolean) {
        this._disableUI = value;
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
