// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CancellationToken, Event } from 'vscode';

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

    interface ExecutionResult {
        /**
         * Resolves when the execution has completed.
         */
        done: Promise<void>;

        /**
         * Event fired with the output items emitted as a result of the execution.
         */
        onDidEmitOutput: Event<OutputItem[]>;
    }
    export interface Kernel {
        /**
         * Executes code in the kernel.
         * The code executed will not result in changes to the execution count
         * & will not show up in the Kernel execution history.
         *
         * @param {string} code Code to be executed.
         * @param {CancellationToken} token Triggers the cancellation of the execution.
         * @return {*}  {ExecutionResult}
         */
        executeCode(code: string, token: CancellationToken): ExecutionResult;
    }
}
