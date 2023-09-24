// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// @ts-ignore Bogus import required for compiler to work
import type { CancellationToken } from 'vscode';

declare module './api' {
    /**
     * Use of proposed API is not recommended.
     * This could change anytime without any notice.
     */
    export interface JupyterServerConnectionInformation {
        /**
         * The `fetch` method to use.
         */
        readonly fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
        /**
         * The `WebSocket` object constructor.
         */
        readonly WebSocket?: typeof WebSocket;
    }
}
