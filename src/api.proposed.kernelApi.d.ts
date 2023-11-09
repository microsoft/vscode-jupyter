// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Event, Uri } from 'vscode';

declare module './api' {
    export interface Kernel {}
    export interface Kernels {
        /**
         * Finds a kernel for a given resource.
         * For instance if the resource is a notebook, then look for a kernel associated with the given Notebook document.
         * Only kernels which have already been started by the will be returned.
         */
        findKernel(query: { uri: Uri }): Kernel | undefined;
    }
}
