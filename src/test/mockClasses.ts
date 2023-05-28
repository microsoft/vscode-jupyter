// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';

export class MockOutputChannel implements vscode.OutputChannel {
    public name: string;
    public output: string;
    public isShown!: boolean;
    constructor(name: string) {
        this.name = name;
        this.output = '';
    }
    public append(value: string) {
        this.output += value;
    }
    public appendLine(value: string) {
        this.append(value);
        this.append('\n');
    }
    // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
    public clear() {}
    public show(preservceFocus?: boolean): void;
    public show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public show(_x?: any, _y?: any): void {
        this.isShown = true;
    }
    public hide() {
        this.isShown = false;
    }
    // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
    public dispose() {}
    public replace(value: string) {
        this.output = value;
    }
}
