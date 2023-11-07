// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// @ts-ignore Bogus import required for compiler to work
import type { CancellationToken } from 'vscode';

declare module './api' {
    /**
     * Provides access to the Jupyter Kernel API.
     * As Kernels can be used to execute code on local or remote machines, this poses a threat to security.
     * As a result users will be prompted to allow access to the Kernel API.
     */
    export interface Jupyter {
        getKernelApi(): Promise<Kernels | undefined>;
    }
}
