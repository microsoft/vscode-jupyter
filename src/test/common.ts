// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { type Uri, type Event, Disposable } from 'vscode';
import { IExtensionApi } from '../standalone/api/api';
import { IDisposable } from '../platform/common/types';
import { IServiceContainer, IServiceManager } from '../platform/ioc/types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { isPromise } from '../platform/common/utils/async';
import { computeHash } from '../platform/common/crypto';
import { AsyncFunc, Func, Suite, Test } from 'mocha';

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
export async function waitForCondition<T>(
    condition: () => Promise<T> | T,
    timeoutMs: number,
    errorMessage: string | (() => string),
    intervalTimeoutMs: number = 10,
    throwOnError: boolean = false,
    cancelToken?: { isCancellationRequested: boolean; onCancellationRequested: Function }
): Promise<NonNullable<T>> {
    return new Promise<NonNullable<T>>(async (resolve, reject) => {
        const disposables: IDisposable[] = [];
        let timer: NodeJS.Timer;
        const timerFunc = async () => {
            if (cancelToken?.isCancellationRequested) {
                disposeAllDisposables(disposables);
                reject(new Error('Cancelled Wait Condition via cancellation token'));
                return;
            }
            let success: T | undefined = undefined;
            try {
                const promise = condition();
                success = isPromise(promise) ? await promise : promise;
            } catch (exc) {
                if (throwOnError) {
                    disposeAllDisposables(disposables);
                    reject(exc);
                }
            }
            if (!success) {
                // Start up a timer again, but don't do it until after
                // the condition is false.
                timer = setTimeout(timerFunc, intervalTimeoutMs);
                disposables.push(new Disposable(() => clearTimeout(timer)));
            } else {
                disposeAllDisposables(disposables);
                resolve(success as NonNullable<T>);
            }
        };
        disposables.push(new Disposable(() => clearTimeout(timer)));
        timer = setTimeout(timerFunc, 0);
        if (cancelToken) {
            cancelToken.onCancellationRequested(
                () => {
                    disposeAllDisposables(disposables);
                    reject(new Error('Cancelled Wait Condition via cancellation token'));
                    return;
                },
                undefined,
                disposables
            );
        }
        const timeout = setTimeout(() => {
            disposeAllDisposables(disposables);
            errorMessage = typeof errorMessage === 'string' ? errorMessage : errorMessage();
            if (!cancelToken?.isCancellationRequested) {
                console.log(`Test failing --- ${errorMessage}`);
            }
            reject(new Error(errorMessage));
        }, timeoutMs);
        disposables.push(new Disposable(() => clearTimeout(timeout)));

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
    private readonly cancellationToken: {
        isCancellationRequested: boolean;
        onCancellationRequested: (cb: Function) => IDisposable;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly handledEvents: any[] = [];
    private readonly cancellationHandlers = new Set<Function>();
    constructor(event: Event<T>, private readonly eventNameForErrorMessages: string, disposables: IDisposable[] = []) {
        disposables.push(this);
        this.cancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: (cb: Function) => {
                this.cancellationHandlers.add(cb);
                return {
                    dispose: () => {
                        this.cancellationHandlers.delete(cb);
                    }
                };
            }
        };
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
            () => `${this.eventNameForErrorMessages} event fired ${this.count} time(s), expected ${numberOfTimesFired}`,
            undefined,
            undefined,
            this.cancellationToken
        );
    }
    public async assertFiredAtLeast(numberOfTimesFired: number, waitPeriod: number = 2_000): Promise<void> {
        await waitForCondition(
            async () => this.count >= numberOfTimesFired,
            waitPeriod,
            () =>
                `${this.eventNameForErrorMessages} event fired ${this.count}, expected at least ${numberOfTimesFired}.`,
            undefined,
            undefined,
            this.cancellationToken
        );
    }
    public atIndex(index: number): T {
        return this.handledEvents[index];
    }

    public dispose() {
        this.handler.dispose();
        this.cancellationToken.isCancellationRequested = true;
        this.cancellationHandlers.forEach((cb) => cb());
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
    startJupyterServer(options?: {
        token?: string;
        port?: number;
        useCert?: boolean;
        jupyterLab?: boolean;
        password?: string;
        detached?: boolean;
        standalone?: boolean;
    }): Promise<{ url: string } & IDisposable>;
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

export async function startJupyterServer(options?: {
    token?: string;
    port?: number;
    useCert?: boolean;
    jupyterLab?: boolean;
    password?: string;
    detached?: boolean;
    standalone?: boolean;
}): Promise<{ url: string } & IDisposable> {
    return API.startJupyterServer(options);
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
export async function generateScreenShotFileName(contextOrFileName: string | Mocha.Context) {
    const fullTestNameHash =
        typeof contextOrFileName === 'string'
            ? ''
            : (await computeHash(contextOrFileName.currentTest?.fullTitle() || '', 'SHA-256')).substring(0, 10); // Ensure file names are short enough for windows.
    const testTitle = typeof contextOrFileName === 'string' ? '' : contextOrFileName.currentTest?.title || '';
    const counter = (screenShotCount.get(fullTestNameHash) || 0) + 1;
    screenShotCount.set(fullTestNameHash, counter);
    const fileNamePrefix =
        typeof contextOrFileName === 'string' ? contextOrFileName : `${testTitle}_${fullTestNameHash}`;
    const name = `${fileNamePrefix}_${counter}`.replace(/[\W]+/g, '_');
    return `${name}-screenshot.png`;
}

const mandatoryTestFlag = '@mandatory';

export function suiteMandatory(title: string, fn: (this: Suite) => void): Suite {
    return suite(`${title} ${mandatoryTestFlag}`, fn);
}

export function testMandatory(title: string, fn?: Func): Test | AsyncFunc {
    return test(`${title} ${mandatoryTestFlag}`, fn);
}
