// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JupyterServerCollection } from '../../../api';
import { JupyterServerProviderHandle, IRemoteKernelFinder } from '../types';

export const IRemoteKernelFinderController = Symbol('RemoteKernelFinderController');
export interface IRemoteKernelFinderController {
    getOrCreateRemoteKernelFinder(
        serverProviderHandle: JupyterServerProviderHandle,
        displayName: string
    ): IRemoteKernelFinder;
    startJupyterServerKernelDiscovery(
        collection: JupyterServerCollection,
        serverId: string
    ): Promise<IRemoteKernelFinder>;
}
