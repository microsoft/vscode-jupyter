// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CancellationToken, Event, Uri } from 'vscode';

declare module './api' {
    interface OutputItem {
        /**
         * The mime type of the output
         */
        mime: string;
        /**
         * The data of this output item.
         */
        data: Uint8Array;
    }
    /**
     * Represents a Jupyter Kernel.
     */
    export interface Kernel {
        /**
         * Executes code in the kernel without affecting the execution count & execution history.
         *
         * @param code Code to be executed.
         * @param token Triggers the cancellation of the execution.
         * @returns Async iterable of output items, that completes when the execution is complete.
         */
        executeCode(code: string, token: CancellationToken): AsyncIterable<OutputItem[]>;
    }
    export interface Kernels {
        /**
         * Gets an the kernel associated with a given resource.
         * For instance if the resource is a notebook, then get the kernel associated with the given Notebook document.
         * Only kernels which have already been started by the user will be returned.
         */
        getKernel(uri: Uri): Thenable<Kernel | undefined>;
    }
    export interface Jupyter {
        /**
         * Access to the Jupyter Kernels API.
         */
        readonly kernels: Kernels;
    }
}
