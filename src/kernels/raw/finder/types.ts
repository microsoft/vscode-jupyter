// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';

export const ITrustedKernelPaths = Symbol('ITrustedKernelPaths');
export interface ITrustedKernelPaths {
    isTrusted(kernelPath: Uri): boolean;
}
