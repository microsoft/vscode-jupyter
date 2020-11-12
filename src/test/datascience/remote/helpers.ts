// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IPersistentStateFactory } from '../../../client/common/types';
import { GlobalStateUserAllowsInsecureConnections } from '../../../client/remote/connection/remoteConnectionsService';
import { RemoteFileSystemFactory } from '../../../client/remote/ui/fileSystemFactory';
import { IJupyterServerConnectionService } from '../../../client/remote/ui/types';
import { noop } from '../../core';
import { initialize } from '../../initialize';

export async function disposeAllFileSystems() {
    const api = await initialize();
    const fileSystemFactory = api.serviceContainer.get<RemoteFileSystemFactory>(RemoteFileSystemFactory);
    await Promise.all(
        Array.from(fileSystemFactory.fileSystems.values()).map(async (item) => {
            const fileSystem = await item.catch(noop);
            if (fileSystem) {
                try {
                    fileSystem.dispose();
                } catch {
                    //
                }
            }
        })
    );
}
export async function removeAllJupyterServerConnections() {
    const api = await initialize();
    const jupyterServerConnectionService = api.serviceContainer.get<IJupyterServerConnectionService>(
        IJupyterServerConnectionService
    );

    // Ensure we're not logged into any server.
    const connections = await jupyterServerConnectionService.getConnections();
    connections.forEach((item) => jupyterServerConnectionService.disconnect(item.id));
    await disposeAllFileSystems();
}
export async function allowInSecureJupyterServerConnections(allowInSecureConnections: boolean) {
    const api = await initialize();
    const stateFactory = api.serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
    const userAllowsInsecureConnections = stateFactory.createGlobalPersistentState(
        GlobalStateUserAllowsInsecureConnections
    );
    if (userAllowsInsecureConnections.value === allowInSecureConnections) {
        return;
    }
    await userAllowsInsecureConnections.updateValue(allowInSecureConnections);
}
