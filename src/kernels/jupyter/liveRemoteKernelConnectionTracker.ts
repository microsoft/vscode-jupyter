// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento, NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { GLOBAL_MEMENTO, IDisposableRegistry, IMemento } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { JupyterServerUriStorage } from './launcher/serverUriStorage';
import { LiveRemoteKernelConnectionMetadata } from '../types';
import { computeServerId } from './jupyterUtils';

const mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources = 'removeKernelUrisAndSessionsUsedByResources';

type ServerId = string;
type KernelId = string;
type UriString = string;
type UriSessionUsedByResources = Record<ServerId, Record<KernelId, UriString[]>>;

/**
 * Class to track the remote kernels that have been used by notebooks.
 */
@injectable()
export class LiveRemoteKernelConnectionUsageTracker implements IExtensionSyncActivationService {
    private usedRemoteKernelServerIdsAndSessions: UriSessionUsedByResources = {};
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(JupyterServerUriStorage) private readonly uriStorage: JupyterServerUriStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento
    ) {}
    public activate(): void {
        this.usedRemoteKernelServerIdsAndSessions = this.memento.get<UriSessionUsedByResources>(
            mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources,
            {}
        );
        this.uriStorage.onDidRemoveUri(this.onDidRemoveUri, this, this.disposables);
    }

    public wasKernelUsed(connection: LiveRemoteKernelConnectionMetadata) {
        return (
            connection.serverId in this.usedRemoteKernelServerIdsAndSessions &&
            connection.id in this.usedRemoteKernelServerIdsAndSessions[connection.serverId]
        );
    }
    public trackKernelIdAsUsed(serverId: string, kernelId: string, notebook: NotebookDocument) {
        this.usedRemoteKernelServerIdsAndSessions[serverId] = this.usedRemoteKernelServerIdsAndSessions[serverId] || {};
        this.usedRemoteKernelServerIdsAndSessions[serverId][kernelId] =
            this.usedRemoteKernelServerIdsAndSessions[serverId][kernelId] || [];
        this.usedRemoteKernelServerIdsAndSessions[serverId][kernelId].push(notebook.uri.toString());
        this.memento
            .update(
                mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources,
                this.usedRemoteKernelServerIdsAndSessions
            )
            .then(noop, noop);
    }
    public trackKernelIdAsNotUsed(serverId: string, kernelId: string, notebook: NotebookDocument) {
        if (!(serverId in this.usedRemoteKernelServerIdsAndSessions)) {
            return;
        }
        if (!(kernelId in this.usedRemoteKernelServerIdsAndSessions[serverId])) {
            return;
        }
        const uris = this.usedRemoteKernelServerIdsAndSessions[serverId][kernelId];
        if (!Array.isArray(uris) || !uris.includes(notebook.uri.toString())) {
            return;
        }
        uris.splice(uris.indexOf(notebook.uri.toString()), 1);
        this.memento
            .update(
                mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources,
                this.usedRemoteKernelServerIdsAndSessions
            )
            .then(noop, noop);
    }
    private onDidRemoveUri(uri: string) {
        const serverId = computeServerId(uri);
        delete this.usedRemoteKernelServerIdsAndSessions[serverId];
        this.memento
            .update(
                mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources,
                this.usedRemoteKernelServerIdsAndSessions
            )
            .then(noop, noop);
    }
}
