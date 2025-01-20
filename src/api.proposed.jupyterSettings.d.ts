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
         * The types of the parameters are not defined so as to avoid enforcing the use of `DOM` in `tsconfig.json`.
         * The signature of this method matches the `fetch` method in the browser.
         * https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch
         * fetch(input: RequestInfo, init?: RequestInit) =>Promise<Response>;
         */
        readonly fetch?: (input: any, init?: any) => Promise<any>;
        /**
         * The `WebSocket` object constructor.
         * This matches the `WebSocket` object in the browser.
         * https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
         * `typeof WebSocket`, made `any` so that `DOM` is not required in tsconfig for those not using this.
         */
        readonly WebSocket?: any;
    }
}
