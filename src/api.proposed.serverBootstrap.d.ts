// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Event } from 'vscode';

declare module './api' {
    export interface JupyterServerKernelDiscovery {
        readonly status: 'discovering' | 'idle';
        readonly lastError?: Error;
        readonly onDidChangeStatus: Event<void>;
    }

    export interface Jupyter {
        /**
         * Starts kernel discovery for a Jupyter Server from a collection owned by the calling extension only when no finder
         * is active. If a finder is already active, the method immediately returns a monitor for the existing discovery
         * state without re-enumerating the collection's server provider or refreshing.
         *
         * This is an idempotent activation/start API, not a refresh command.
         * It does not select a kernel or start a kernel session.
         */
        startJupyterServerKernelDiscovery(
            collectionId: string,
            serverId: string
        ): Promise<JupyterServerKernelDiscovery>;
    }
}
