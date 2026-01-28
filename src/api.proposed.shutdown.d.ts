// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Importing a type to ensure this is treated as a module
import type {} from 'vscode';

declare module './api' {
    /**
     * Represents a Jupyter Kernel.
     */
    export interface Kernel {
        /**
         * Shuts down the kernel and all its associated resources.
         * This operation will terminate the kernel process and cannot be undone.
         * After shutdown, the kernel becomes unusable and should be disposed of.
         */
        shutdown(): Promise<void>;
    }
}
