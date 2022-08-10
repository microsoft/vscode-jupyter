// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

'use strict';

import { NotebookDocument, Uri, Event } from 'vscode';
import { IExtensionApi } from '../standalone/api/api';
import { IDisposable } from '../platform/common/types';
import { IServiceContainer, IServiceManager } from '../platform/ioc/types';
import * as hashjs from 'hash.js';

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

/**
 * Helper class to test events.
 *
 * Usage: Assume xyz.onDidSave is the event we want to test.
 * const handler = new TestEventHandler(xyz.onDidSave);
 * // Do something that would trigger the event.
 * assert.ok(handler.fired)
 * assert.equal(handler.first, 'Args Passed to first onDidSave')
 * assert.equal(handler.count, 1)// Only one should have been fired.
 */
export class TestEventHandler<T extends void | any = any> implements IDisposable {
    public get fired() {
        return this.handledEvents.length > 0;
    }
    public get first(): T {
        return this.handledEvents[0];
    }
    public get second(): T {
        return this.handledEvents[1];
    }
    public get last(): T {
        return this.handledEvents[this.handledEvents.length - 1];
    }
    public get count(): number {
        return this.handledEvents.length;
    }
    public get all(): T[] {
        return this.handledEvents;
    }
    private readonly handler: IDisposable;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly handledEvents: any[] = [];
    constructor(event: Event<T>, private readonly eventNameForErrorMessages: string, disposables: IDisposable[] = []) {
        disposables.push(this);
        this.handler = event(this.listener, this);
    }
    public reset() {
        while (this.handledEvents.length) {
            this.handledEvents.pop();
        }
    }
    public async assertFired(waitPeriod: number = 100): Promise<void> {
        await waitForCondition(async () => this.fired, waitPeriod, `${this.eventNameForErrorMessages} event not fired`);
    }
    public async assertFiredExactly(numberOfTimesFired: number, waitPeriod: number = 2_000): Promise<void> {
        await waitForCondition(
            async () => this.count === numberOfTimesFired,
            waitPeriod,
            `${this.eventNameForErrorMessages} event fired ${this.count}, expected ${numberOfTimesFired}`
        );
    }
    public async assertFiredAtLeast(numberOfTimesFired: number, waitPeriod: number = 2_000): Promise<void> {
        await waitForCondition(
            async () => this.count >= numberOfTimesFired,
            waitPeriod,
            `${this.eventNameForErrorMessages} event fired ${this.count}, expected at least ${numberOfTimesFired}.`
        );
    }
    public atIndex(index: number): T {
        return this.handledEvents[index];
    }

    public dispose() {
        this.handler.dispose();
    }

    private listener(e: T) {
        this.handledEvents.push(e);
    }
}

export function createEventHandler<T, K extends keyof T>(
    obj: T,
    eventName: K,
    disposables: IDisposable[] = []
): T[K] extends Event<infer TArgs> ? TestEventHandler<TArgs> : TestEventHandler<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new TestEventHandler(obj[eventName] as any, eventName as string, disposables) as any;
}
/**
 * API common to web & desktop tests, but with different implementations
 */
export type CommonApi = {
    createTemporaryFile(options: { extension: string; contents?: string }): Promise<{ file: Uri } & IDisposable>;
    startJupyterServer(notebook?: NotebookDocument, useCert?: boolean): Promise<void>;
    stopJupyterServer?(): Promise<void>;
    captureScreenShot?(contextOrFileName: string | Mocha.Context): Promise<void>;
    initialize(): Promise<IExtensionTestApi>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API: CommonApi = {} as any;

export function initializeCommonApi(api: CommonApi) {
    Object.assign(API, api);
}

export async function createTemporaryFile(options: {
    contents?: string;
    extension: string;
}): Promise<{ file: Uri } & IDisposable> {
    return API.createTemporaryFile(options);
}

export async function startJupyterServer(notebook?: NotebookDocument, useCert: boolean = false): Promise<void> {
    return API.startJupyterServer(notebook, useCert);
}

export async function stopJupyterServer() {
    if (API.stopJupyterServer) {
        return API.stopJupyterServer();
    }
}
export async function captureScreenShot(contextOrFileName: string | Mocha.Context) {
    if (API.captureScreenShot) {
        await API.captureScreenShot(contextOrFileName);
    }
}

export async function initialize() {
    return API.initialize();
}

const screenShotCount = new Map<string, number>();
export function generateScreenShotFileName(contextOrFileName: string | Mocha.Context) {
    const fullTestNameHash =
        typeof contextOrFileName === 'string'
            ? ''
            : hashjs
                  .sha256()
                  .update(contextOrFileName.currentTest?.fullTitle() || '')
                  .digest('hex')
                  .substring(0, 10); // Ensure file names are short enough for windows.
    const testTitle = typeof contextOrFileName === 'string' ? '' : contextOrFileName.currentTest?.title || '';
    const counter = (screenShotCount.get(fullTestNameHash) || 0) + 1;
    screenShotCount.set(fullTestNameHash, counter);
    const fileNamePrefix =
        typeof contextOrFileName === 'string' ? contextOrFileName : `${testTitle}_${fullTestNameHash}`;
    const name = `${fileNamePrefix}_${counter}`.replace(/[\W]+/g, '_');
    return `${name}-screenshot.png`;
}
