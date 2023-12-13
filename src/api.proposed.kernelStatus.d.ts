// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Event } from 'vscode';

declare module './api' {
    export type KernelStatus =
        | 'unknown'
        | 'starting'
        | 'idle'
        | 'busy'
        | 'terminating'
        | 'restarting'
        | 'autorestarting'
        | 'dead';
    /**
     * Represents a Jupyter Kernel.
     */
    export interface Kernel {
        /**
         * The current status of the kernel.
         */
        readonly status: KernelStatus;
        /**
         * An event emitted when the kernel status changes.
         */
        onDidChangeStatus: Event<KernelStatus>;
    }
}
