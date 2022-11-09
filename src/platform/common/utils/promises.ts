// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from 'vscode';

/**
 * Keeps track of the promises and notifies when all are completed.
 */
export class PromiseMonitor {
    private readonly promises = new Set<Promise<unknown>>();
    private readonly _onStateChange = new EventEmitter<void>();
    public readonly onStateChange = this._onStateChange.event;
    public get isComplete() {
        return this.promises.size === 0;
    }
    public dispose() {
        this._onStateChange.dispose();
    }
    push(promise: Promise<unknown>) {
        this.promises.add(promise);
        this._onStateChange.fire();
        promise.finally(() => {
            this.promises.delete(promise);
            if (this.isComplete) {
                this._onStateChange.fire();
            }
        });
    }
}
