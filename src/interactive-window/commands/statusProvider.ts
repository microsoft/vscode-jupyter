// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { injectable } from 'inversify';
import { Disposable, ProgressLocation, ProgressOptions } from 'vscode';

import { IApplicationShell } from '../../platform/common/application/types';
import { createDeferred, Deferred } from '../../platform/common/utils/async';
import { noop } from '../../platform/common/utils/misc';

class StatusItem implements Disposable {
    private deferred: Deferred<void>;
    private disposed: boolean = false;
    private timeout: NodeJS.Timer | number | undefined;
    private disposeCallback: () => void;

    constructor(_title: string, disposeCallback: () => void, timeout?: number) {
        this.deferred = createDeferred<void>();
        this.disposeCallback = disposeCallback;

        // A timeout is possible too. Auto dispose if that's the case
        if (timeout) {
            this.timeout = setTimeout(this.dispose, timeout);
        }
    }

    public dispose = () => {
        if (!this.disposed) {
            this.disposed = true;
            if (this.timeout) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                clearTimeout(this.timeout as any);
                this.timeout = undefined;
            }
            this.disposeCallback();
            if (!this.deferred.completed) {
                this.deferred.resolve();
            }
        }
    };

    public promise = (): Promise<void> => {
        return this.deferred.promise;
    };

    public reject = () => {
        this.deferred.reject();
        this.dispose();
    };
}

/**
 * Turns a withProgress callback into a promise.
 */
export class StatusProvider {
    private statusCount: number = 0;

    constructor(private applicationShell: IApplicationShell) {}

    private set(message: string, timeout?: number, cancel?: () => void): Disposable {
        // Start our progress
        this.incrementCount();

        // Create a StatusItem that will return our promise
        const statusItem = new StatusItem(message, () => this.decrementCount(), timeout);

        const progressOptions: ProgressOptions = {
            location: cancel ? ProgressLocation.Notification : ProgressLocation.Window,
            title: message,
            cancellable: cancel !== undefined
        };

        // Set our application shell status with a busy icon
        this.applicationShell
            .withProgress(progressOptions, (_p, c) => {
                if (c && cancel) {
                    c.onCancellationRequested(() => {
                        cancel();
                        statusItem.reject();
                    });
                }
                return statusItem.promise();
            })
            .then(noop, noop);

        return statusItem;
    }

    public async waitWithStatus<T>(
        promise: () => Promise<T>,
        message: string,
        timeout?: number,
        cancel?: () => void
    ): Promise<T> {
        // Create a status item and wait for our promise to either finish or reject
        const status = this.set(message, timeout, cancel);
        let result: T;
        try {
            result = await promise();
        } finally {
            status.dispose();
        }
        return result;
    }

    private incrementCount = () => {
        this.statusCount += 1;
    };

    private decrementCount = () => {
        const updatedCount = this.statusCount - 1;
        this.statusCount = Math.max(updatedCount, 0);
    };
}
