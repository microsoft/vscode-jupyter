/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IExtensionApi } from '../platform/api';
import { IServiceContainer, IServiceManager } from '../platform/ioc/types';

export interface IExtensionTestApi extends IExtensionApi {
    serviceContainer: IServiceContainer;
    serviceManager: IServiceManager;
}

const pendingTimers: any[] = [];
export function clearPendingTimers() {
    while (pendingTimers.length) {
        const timer = pendingTimers.shift();
        try {
            clearTimeout(timer);
        } catch {
            // Noop.
        }
        try {
            clearInterval(timer);
        } catch {
            // Noop.
        }
    }
}

/**
 * Wait for a condition to be fulfilled within a timeout.
 *
 * @export
 * @param {() => Promise<boolean>} condition
 * @param {number} timeoutMs
 * @param {string} errorMessage
 * @returns {Promise<void>}
 */
export async function waitForCondition(
    condition: () => Promise<boolean> | boolean,
    timeoutMs: number,
    errorMessage: string | (() => string),
    intervalTimeoutMs: number = 10,
    throwOnError: boolean = false
): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => {
            clearTimeout(timeout);
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            clearTimeout(timer);
            errorMessage = typeof errorMessage === 'string' ? errorMessage : errorMessage();
            console.log(`Test failing --- ${errorMessage}`);
            reject(new Error(errorMessage));
        }, timeoutMs);
        let timer: NodeJS.Timer;
        const timerFunc = async () => {
            let success = false;
            try {
                const promise = condition();
                success = typeof promise === 'boolean' ? promise : await promise;
            } catch (exc) {
                if (throwOnError) {
                    reject(exc);
                }
            }
            if (!success) {
                // Start up a timer again, but don't do it until after
                // the condition is false.
                timer = setTimeout(timerFunc, intervalTimeoutMs);
            } else {
                clearTimeout(timer);
                clearTimeout(timeout);
                resolve();
            }
        };
        timer = setTimeout(timerFunc, intervalTimeoutMs);

        pendingTimers.push(timer);
        pendingTimers.push(timeout);
    });
}
