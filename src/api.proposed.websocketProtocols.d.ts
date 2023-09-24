// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// @ts-ignore Bogus import required for compiler to work
import type { CancellationToken } from 'vscode';

declare module './api' {
    export interface JupyterServerConnectionInformation {
        /**
         * Returns the sub-protocols to be used. See details of `protocols` here https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
         * Useful if there is a custom authentication scheme that needs to be used for WebSocket connections.
         * Note: The client side npm package @jupyterlab/services uses WebSockets to connect to remote Kernels.
         *
         * This is useful in the context of vscode.dev or github.dev or the like where the remote Jupyter Server is unable to read the cookies/headers sent from client as part of {@link JupyterServerConnectionInformation.headers headers}.
         */
        readonly webSocketProtocols?: string[];
    }
}
