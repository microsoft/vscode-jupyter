// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Event } from 'vscode';
import { IDisposable } from '../types';

/**
 * Given an event, returns another event which only fires once.
 */
export function once<T>(event: Event<T>): Event<T> {
    return (listener, thisArgs = null, disposables?) => {
        // we need this, in case the event fires during the listener call
        let didFire = false;
        let result: IDisposable | undefined = undefined;
        result = event(
            (e) => {
                if (didFire) {
                    return;
                } else if (result) {
                    result.dispose();
                } else {
                    didFire = true;
                }

                return listener.call(thisArgs, e);
            },
            null,
            disposables
        );

        if (didFire) {
            result.dispose();
        }

        return result;
    };
}

/**
 * Creates a promise out of an event, using the once helper.
 */
export function toPromise<T>(event: Event<T>): Promise<T> {
    return new Promise((resolve) => once(event)(resolve));
}
