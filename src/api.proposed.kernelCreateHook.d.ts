// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Event, Uri } from 'vscode';

declare module './api' {
    export interface Kernels {
        /**
         * Event fired when a kernel is created (by user execution) or restarted on a resource.
         */
        onDidCreateOrRestart: Event<{
            uri: Uri;
            kernel: Kernel;
        }>;
    }
}
