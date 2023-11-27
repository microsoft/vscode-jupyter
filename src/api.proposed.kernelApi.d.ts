// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CancellationToken, Uri } from 'vscode';

declare module './api' {
    interface OutputItem {
        /**
         * The mime type of the output.
         * Includes standard mime types (but not limited to) `text/plain`, `application/json`, `text/html`, etc.
         *
         * Special mime types are:
         * - `application/x.notebook.stream.stdout`: The output is a stream of stdout. (same as `NotebookCellOutputItem.stdout('').mime`)
         * - `application/x.notebook.stream.stderr`: The output is a stream of stderr. (same as `NotebookCellOutputItem.stderr('').mime`)
         * - `application/vnd.code.notebook.error`: The output is a stream of stderr. (same as NotebookCellOutputItem.error(...).mime)
         *
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
         * Language of the kernel.
         * E.g. python, r, julia, etc.
         */
        language: string;
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
         * Only kernels which have already been started by the user and belonging to Notebooks that are currently opened will be returned.
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
