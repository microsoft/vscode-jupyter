// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento, Uri } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { GLOBAL_MEMENTO, IDisposableRegistry, IMemento } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { LiveRemoteKernelConnectionMetadata } from '../../types';
import { generateUriFromRemoteProvider } from '../jupyterUtils';
import {
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    ILiveRemoteKernelConnectionUsageTracker,
    JupyterServerProviderHandle
} from '../types';

export const mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources = 'removeKernelUrisAndSessionsUsedByResources';

type ServerId = string;
type KernelId = string;
type UriString = string;
type UriSessionUsedByResources = Record<ServerId, Record<KernelId, UriString[]>>;

/**
 * Keeps track of the kernel id and server id that was last used by a resource.
 * If a kernel is no longer used by a resource (e.g. another kernel is selected),
 * then the previous kernel would be removed from the list of kernels for this resource.
 */
@injectable()
export class LiveRemoteKernelConnectionUsageTracker
    implements IExtensionSyncActivationService, ILiveRemoteKernelConnectionUsageTracker
{
    private usedRemoteKernelServerIdsAndSessions: UriSessionUsedByResources = {};
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IJupyterServerUriStorage) private readonly uriStorage: IJupyterServerUriStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento
    ) {}
    public activate(): void {
        this.usedRemoteKernelServerIdsAndSessions = this.memento.get<UriSessionUsedByResources>(
            mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources,
            {}
        );
        this.uriStorage.onDidRemove(this.onDidRemoveUris, this, this.disposables);
    }

    public wasKernelUsed(connection: LiveRemoteKernelConnectionMetadata) {
        const id = generateUriFromRemoteProvider(
            connection.serverProviderHandle.id,
            connection.serverProviderHandle.handle
        );
        return (
            id in this.usedRemoteKernelServerIdsAndSessions &&
            typeof connection.kernelModel.id === 'string' &&
            connection.kernelModel.id in this.usedRemoteKernelServerIdsAndSessions[id]
        );
    }
    public trackKernelIdAsUsed(resource: Uri, serverId: JupyterServerProviderHandle, kernelId: string) {
        const id = generateUriFromRemoteProvider(serverId.id, serverId.handle);
        this.usedRemoteKernelServerIdsAndSessions[id] = this.usedRemoteKernelServerIdsAndSessions[id] || {};
        this.usedRemoteKernelServerIdsAndSessions[id][kernelId] =
            this.usedRemoteKernelServerIdsAndSessions[id][kernelId] || [];
        const uris = this.usedRemoteKernelServerIdsAndSessions[id][kernelId];
        if (uris.includes(resource.toString())) {
            return;
        }
        uris.push(resource.toString());
        this.memento
            .update(
                mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources,
                this.usedRemoteKernelServerIdsAndSessions
            )
            .then(noop, noop);
    }
    public trackKernelIdAsNotUsed(resource: Uri, serverId: JupyterServerProviderHandle, kernelId: string) {
        const id = generateUriFromRemoteProvider(serverId.id, serverId.handle);
        if (!(id in this.usedRemoteKernelServerIdsAndSessions)) {
            return;
        }
        if (!(kernelId in this.usedRemoteKernelServerIdsAndSessions[id])) {
            return;
        }
        const uris = this.usedRemoteKernelServerIdsAndSessions[id][kernelId];
        if (!Array.isArray(uris) || !uris.includes(resource.toString())) {
            return;
        }
        uris.splice(uris.indexOf(resource.toString()), 1);
        if (uris.length === 0) {
            delete this.usedRemoteKernelServerIdsAndSessions[id][kernelId];
        }
        if (Object.keys(this.usedRemoteKernelServerIdsAndSessions[id]).length === 0) {
            delete this.usedRemoteKernelServerIdsAndSessions[id];
        }

        this.memento
            .update(
                mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources,
                this.usedRemoteKernelServerIdsAndSessions
            )
            .then(noop, noop);
    }
    private onDidRemoveUris(uriEntries: IJupyterServerUriEntry[]) {
        uriEntries.forEach((uriEntry) => {
            const id = generateUriFromRemoteProvider(uriEntry.provider.id, uriEntry.provider.handle);
            delete this.usedRemoteKernelServerIdsAndSessions[id];
            this.memento
                .update(
                    mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources,
                    this.usedRemoteKernelServerIdsAndSessions
                )
                .then(noop, noop);
        });
    }
}
