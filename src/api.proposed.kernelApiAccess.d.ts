// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// @ts-ignore Bogus import required for compiler to work
import type { CancellationToken } from 'vscode';

declare module './api' {
    export interface Jupyter {
        /**
         * Request access to Kernels.
         * As Kernels can be used to execute code on local or remote machines, user concent will be required.
         */
        requestKernelAccess(): Thenable<Kernels>;
    }
}
