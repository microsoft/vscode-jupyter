// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { createDeferred } from '../../client/common/utils/async';

// Basic shape that something needs to support to hook up to this
interface IOnMessageListener {
    addMessageListener(callback: (message: string, payload: any) => void): void;
    removeMessageListener(callback: (message: string, payload: any) => void): void;
}

export type WaitForMessageOptions = {
    /**
     * Timeout for waiting for message.
     * Defaults to 65_000ms.
     *
     * @type {number}
     */
    timeoutMs?: number;
    /**
     * Number of times the message should be received.
     * Defaults to 1.
     *
     * @type {number}
     */
    numberOfTimes?: number;

    // Optional check for the payload of the message
    // will only return (or count) message if this returns true
    // tslint:disable-next-line: no-any
    withPayload?(payload: any): boolean;
};

// This class is for usage in .vscode test to hook up to webviews which expose the addMessageListener and removeMessageListener functions
export class OnMessageListener {
    private target: IOnMessageListener;
    constructor(target: IOnMessageListener) {
        this.target = target;
    }

    // For our target object wait for a specific message to come in from onMessage function
    public async waitForMessage(message: string, options?: WaitForMessageOptions): Promise<void> {
        const timeoutMs = options && options.timeoutMs ? options.timeoutMs : undefined;
        const numberOfTimes = options && options.numberOfTimes ? options.numberOfTimes : 1;

        const promise = createDeferred<void>();

        let handler: (m: string, p: any) => void;
        const timer = timeoutMs
            ? setTimeout(() => {
                  if (!promise.resolved) {
                      promise.reject(new Error(`Waiting for ${message} timed out`));
                  }
              }, timeoutMs)
            : undefined;
        let timesMessageReceived = 0;
        const dispatchedAction = `DISPATCHED_ACTION_${message}`;
        // Create the handler that we will hook up to the on message listener
        handler = (m: string, payload: any) => {
            if (m === message || m === dispatchedAction) {
                // First verify the payload matches
                if (options?.withPayload) {
                    if (!options.withPayload(payload)) {
                        return;
                    }
                }

                timesMessageReceived += 1;
                if (timesMessageReceived < numberOfTimes) {
                    return;
                }
                if (timer) {
                    clearTimeout(timer);
                }
                this.removeMessageListener(handler);
                if (m === message) {
                    promise.resolve();
                } else {
                    // It could a redux dispatched message.
                    // Wait for 10ms, wait for other stuff to finish.
                    // We can wait for 100ms or 1s. But thats too long.
                    // The assumption is that currently we do not have any setTimeouts
                    // in UI code that's in the magnitude of 100ms or more.
                    // We do have a couple of setTiemout's, but they wait for 1ms, not 100ms.
                    // 10ms more than sufficient for all the UI timeouts.
                    setTimeout(() => promise.resolve(), 10);
                }
            }
        };

        this.addMessageListener(handler);
        return promise.promise;
    }

    // Add the callback on the target
    public addMessageListener(callback: (m: string, p: any) => void) {
        this.target.addMessageListener(callback);
    }

    // Remove the callback on the target
    public removeMessageListener(callback: (m: string, p: any) => void) {
        this.target.removeMessageListener(callback);
    }
}
