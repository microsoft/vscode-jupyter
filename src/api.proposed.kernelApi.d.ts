// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Event, Uri } from 'vscode';

declare module './api' {
    export interface Kernel {
        status: 'unknown' | 'starting' | 'idle' | 'busy' | 'terminating' | 'restarting' | 'autorestarting' | 'dead';
        onDidChangeStatus: Event<
            'unknown' | 'starting' | 'idle' | 'busy' | 'terminating' | 'restarting' | 'autorestarting' | 'dead'
        >;
    }
    export interface Kernels {
        /**
         * Finds a kernel for a given resource.
         * For instance if the resource is a notebook, then look for a kernel associated with the given Notebook document.
         * Only kernels which have already been started by the will be returned.
         */
        findKernel(query: { uri: Uri }): Kernel | undefined;
    }
}
