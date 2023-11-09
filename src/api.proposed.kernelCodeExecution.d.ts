// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CancellationToken } from 'vscode';

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
    export interface Kernel {
        /**
         * Executes code in the kernel.
         * The code executed will not result in changes to the execution count
         * & will not show up in the Kernel execution history.
         *
         * @param code Code to be executed.
         * @param token Triggers the cancellation of the execution.
         * @returns Async iterable of output items, that completes when the execution is complete.
         */
        executeCode(code: string, token: CancellationToken): AsyncIterable<OutputItem[]>;
    }
}
