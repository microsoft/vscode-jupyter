// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// import { CancellationTokenSource } from 'vscode';
import { generateIdFromRemoteProvider } from '../jupyterUtils';
import { IJupyterServerProviderRegistry, JupyterServerProviderHandle } from '../types';

const displayNames = new Map<string, string>();
export function trackRemoteServerDisplayName(serverHandle: JupyterServerProviderHandle, displayName: string) {
    displayNames.set(generateIdFromRemoteProvider(serverHandle), displayName);
}
export function getJupyterDisplayName(
    serverHandle: JupyterServerProviderHandle,
    jupyterUriProviderRegistration: IJupyterServerProviderRegistry,
    defaultValue?: string
) {
    const collection = jupyterUriProviderRegistration.jupyterCollections.find(
        (c) => c.extensionId === serverHandle.extensionId && c.id === serverHandle.id
    );
    return (
        displayNames.get(generateIdFromRemoteProvider(serverHandle)) ||
        collection?.label ||
        defaultValue ||
        `${serverHandle.id}:${serverHandle.handle}`
    );
}
