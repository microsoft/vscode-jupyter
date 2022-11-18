// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { Event, EventEmitter, InputBox, QuickInputButton } from 'vscode';

export class MockInputBox implements InputBox {
    public value: string = '';
    public placeholder: string | undefined;
    public password: boolean = false;
    public buttons: QuickInputButton[] = [];
    public prompt: string | undefined;
    public validationMessage: string | undefined;
    public title: string | undefined;
    public step: number | undefined;
    public totalSteps: number | undefined;
    public enabled: boolean = true;
    public busy: boolean = false;
    public ignoreFocusOut: boolean = true;
    private didChangeValueEmitter: EventEmitter<string> = new EventEmitter<string>();
    private didAcceptEmitter: EventEmitter<void> = new EventEmitter<void>();
    private didHideEmitter: EventEmitter<void> = new EventEmitter<void>();
    private didTriggerButtonEmitter: EventEmitter<QuickInputButton> = new EventEmitter<QuickInputButton>();
    private _value: string;
    private _fired: number = 0;
    private _times: number;
    constructor(value: string, times: number = 1) {
        this._value = value;
        this._times = times;
    }
    valueSelection: readonly [number, number] | undefined;
    public get onDidChangeValue(): Event<string> {
        return this.didChangeValueEmitter.event;
    }
    public get onDidAccept(): Event<void> {
        return this.didAcceptEmitter.event;
    }
    public get onDidTriggerButton(): Event<QuickInputButton> {
        return this.didTriggerButtonEmitter.event;
    }
    public get onDidHide(): Event<void> {
        return this.didHideEmitter.event;
    }
    public show(): void {
        // Unless we have specified more, we only want to fire the input one time (in case show is called more)
        if (this._fired < this._times) {
            // After 10 ms set the value, then accept it
            setTimeout(() => {
                this.value = this._value;
                this.didChangeValueEmitter.fire(this._value);
                setTimeout(() => {
                    if (this.validationMessage) {
                        this.value = this.validationMessage;
                        this.didHideEmitter.fire();
                    } else {
                        this.didAcceptEmitter.fire();

                        // Accept may cause validation failure. Check for that
                        setTimeout(() => {
                            if (this.validationMessage) {
                                this.value = this.validationMessage;
                                this.didHideEmitter.fire();
                            }
                        }, 100);
                    }
                }, 10);
            }, 10);
            this._fired++;
        }
    }
    public hide(): void {
        // Do nothing
    }
    public dispose(): void {
        // Do nothing
    }
}
