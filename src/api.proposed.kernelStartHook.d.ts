// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Event, Uri } from 'vscode';

declare module './api' {
    export interface Kernels {
        /**
         * Event fired when a kernel is started or restarted by a user on a resource.
         */
        onDidStart: Event<{
            uri: Uri;
            kernel: Kernel;
        }>;
    }
}
