// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { JupyterServerKernelDiscovery } from '../../../api';
import type { IRemoteKernelFinder } from '../../../kernels/jupyter/types';

export function createJupyterServerKernelDiscovery(finder: IRemoteKernelFinder): JupyterServerKernelDiscovery {
    return Object.freeze({
        get status() {
            return finder.status;
        },
        get lastError() {
            return finder.lastError;
        },
        onDidChangeStatus: finder.onDidChangeStatus
    });
}
