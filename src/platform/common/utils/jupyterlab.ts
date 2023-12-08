// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IManager } from '@jupyterlab/services/lib/basemanager';
import { ISignal } from '@lumino/signaling';
import { noop } from './misc';
import { raceTimeout } from './async';

export function toPromise<T>(signal: ISignal<unknown, T>): Promise<T> {
    return new Promise<T>((resolve) => {
        const handler = (_sender: unknown, args: T) => {
            resolve(args);
            signal.disconnect(handler);
        };
        signal.connect(handler);
    });
}

export async function disposeManager(manager: IManager) {
    try {
        if (manager.isDisposed) {
            return;
        }
        if (!manager.isReady) {
            await raceTimeout(10_000, manager.ready.catch(noop)).catch(noop);
        }
        const disposed = toPromise(manager.disposed);
        manager.dispose();
        await disposed.catch(noop);
    } catch {
        //
    }
}
