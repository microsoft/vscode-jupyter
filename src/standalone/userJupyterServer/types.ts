// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JupyterServerProviderHandle } from '../../kernels/jupyter/types';

export interface IJupyterPasswordConnectInfo {
    requiresPassword: boolean;
    requestHeaders?: Record<string, string>;
    remappedBaseUrl?: string;
    remappedToken?: string;
}

export const IJupyterPasswordConnect = Symbol('IJupyterPasswordConnect');
export interface IJupyterPasswordConnect {
    getPasswordConnectionInfo(options: {
        url: string;
        isTokenEmpty: boolean;
        serverHandle: JupyterServerProviderHandle;
        displayName?: string;
    }): Promise<IJupyterPasswordConnectInfo>;
}
