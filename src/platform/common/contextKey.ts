// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { commands } from 'vscode';
import { ContextKeyValue } from '../../commands';

/**
 * Utility case used to [setContext](https://code.visualstudio.com/api/extension-guides/command#using-a-custom-when-clause-context) for VS code state.
 */
export class ContextKey<T extends ContextKeyValue = boolean> {
    public get value(): T | undefined {
        return this.lastValue;
    }
    private lastValue?: T;

    constructor(private name: string) {}

    public async set(value: T): Promise<void> {
        if (this.lastValue === value) {
            return;
        }
        this.lastValue = value;
        await commands.executeCommand('setContext', this.name, this.lastValue);
    }
}
