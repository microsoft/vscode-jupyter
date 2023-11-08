// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Event } from 'vscode';
import { IDisposable } from '../types';

/**
 * Given an event, returns another event which only fires once.
 *
 * @param event The event source for the new event.
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
