// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CancellationToken, Event, Uri } from 'vscode';

declare module './api' {
    export interface Kernels {
        /**
         * Event fired when a kernel is started or restarted by a user on a resource.
         */
        onDidStart: Event<{
            uri: Uri;
            kernel: Kernel;
            token: CancellationToken;
            /**
             * Allows to pause the event loop until the provided thenable resolved.
             * This can be useful to ensure startup code is executed before user code.
             *
             * *Note:* This function can only be called during event dispatch.
             *
             * @param thenable A thenable that delays kernel startup.
             */
            waitUntil(thenable: Thenable<unknown>): void;
        }>;
    }
}
