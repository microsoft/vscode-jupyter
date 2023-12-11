// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IJupyterServerProviderRegistry, JupyterServerProviderHandle } from '../types';

export function getJupyterDisplayName(
    serverHandle: JupyterServerProviderHandle,
    jupyterUriProviderRegistration: IJupyterServerProviderRegistry,
    defaultValue?: string
) {
    const collection = jupyterUriProviderRegistration.jupyterCollections.find(
        (c) => c.extensionId === serverHandle.extensionId && c.id === serverHandle.id
    );
    return collection?.label || defaultValue || `${serverHandle.id}:${serverHandle.handle}`;
}
