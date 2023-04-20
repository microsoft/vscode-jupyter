// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionApi } from './standalone/api/api';
import { noop } from './platform/common/utils/misc';

export async function activate(): Promise<IExtensionApi> {
    return {
        ready: Promise.resolve(),
        registerPythonApi: noop,
        registerRemoteServerProvider: noop,
        showDataViewer: () => Promise.resolve(),
        getKernelService: () => Promise.resolve(undefined),
        getSuggestedController: () => Promise.resolve(undefined),
        addRemoteJupyterServer: () => Promise.resolve(undefined),
        openNotebook: () => Promise.reject()
    };
}

export function deactivate(): Thenable<void> {
    return Promise.resolve();
}
