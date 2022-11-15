// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { KernelConnectionMetadata } from '../../kernels/types';
import { IExtensionContext } from '../../platform/common/types';
import { getNotebookMetadata } from '../../platform/common/utils';
import { createDeferredFromPromise } from '../../platform/common/utils/async';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import { noop } from '../../platform/common/utils/misc';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { MaxMRUSizePerNotebook, MRUItem } from './connectionMru';
import { IKernelRankingHelper, IConnectionMru } from './types';

export const MRUListKey = 'WorkspaceNotebookConnectionMruList';
type NotebookUriHash = string;
export type WorkspaceMRUList = Record<NotebookUriHash, MRUItem[]>;

@injectable()
export class ConnectionMru implements IConnectionMru {
    private documentSourceMapping = new WeakMap<NotebookDocument, Set<KernelConnectionMetadata>>();
    private workspaceMru?: Promise<WorkspaceMRUList>;
    private pendingUpdates = Promise.resolve();
    constructor(
        @inject(IKernelRankingHelper) private readonly kernelRankingHelper: IKernelRankingHelper,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}

    public async add(notebook: NotebookDocument, connection: KernelConnectionMetadata): Promise<void> {
        const connections = this.documentSourceMapping.get(notebook) || new Set<KernelConnectionMetadata>();
        connections.add(connection);
        this.documentSourceMapping.set(notebook, connections);

        // Keep track of this connection in the FS for future sessions.
        const promise = this.storeSelections(notebook);
        // Run the updates sequentially as we're updating the same source.
        this.pendingUpdates = this.pendingUpdates.finally(() => promise.catch(noop));
        await promise;
    }
    @swallowExceptions('Notebook Connection MRU')
    private async storeSelections(notebook: NotebookDocument): Promise<unknown> {
        const connections = this.documentSourceMapping.get(notebook);
        if (!this.context.storageUri || !connections || connections.size === 0) {
            return;
        }
        const connectionIdsUsedInSession = new Set<string>();
        const [currentMru, notebookUriHash, connectionsUsedInSession] = await Promise.all([
            this.mruCache(),
            this.getNotebookUriHash(notebook),
            Promise.all(
                Array.from(connections).map(async (item) => {
                    const id = await item.getHashId();
                    connectionIdsUsedInSession.add(id);
                    return <MRUItem>[Date.now(), id];
                })
            )
        ]);
        const idsInMru = new Set<string>();

        currentMru[notebookUriHash] = currentMru[notebookUriHash] || [];

        // For existing items, update the last used time.
        currentMru[notebookUriHash].forEach((mru) => {
            idsInMru.add(mru[1]);
            if (connectionIdsUsedInSession.has(mru[1])) {
                mru[0] = Date.now();
            }
        });
        // If we have more than 10 items, then remove the oldest items.
        currentMru[notebookUriHash] = currentMru[notebookUriHash]
            .concat(connectionsUsedInSession.filter((item) => !idsInMru.has(item[1])))
            .sort((a, b) => b[0] - a[0])
            .slice(0, MaxMRUSizePerNotebook);

        this.workspaceMru = Promise.resolve(currentMru);
        await this.context.workspaceState.update(MRUListKey, JSON.stringify(currentMru));
    }
    public async clear(): Promise<void> {
        this.workspaceMru = undefined;
        this.documentSourceMapping = new WeakMap<NotebookDocument, Set<KernelConnectionMetadata>>();
        this.pendingUpdates = Promise.resolve();
        await this.context.workspaceState.update(MRUListKey, undefined);
    }
    /**
     * Checks whether a connection was used by a notebook.
     * We store the connections against notebooks in a simple file on disk, and check against that.
     * This way when we reload vscode we know whether a connection was used by a notebook or not.
     *
     * Also if a connection matches exactly against a notebook, then we know that's the connection that was used.
     */
    public async exists(notebook: NotebookDocument, connection: KernelConnectionMetadata): Promise<boolean> {
        const exactMatchPromise = createDeferredFromPromise(
            this.kernelRankingHelper.isExactMatch(notebook.uri, connection, getNotebookMetadata(notebook))
        );
        const existsInFilePromise = createDeferredFromPromise(this.existsMru(notebook, connection));

        await Promise.race([existsInFilePromise.promise, exactMatchPromise.promise]);
        if (existsInFilePromise.completed && existsInFilePromise.value) {
            return true;
        }
        if (exactMatchPromise.completed && exactMatchPromise.value) {
            return true;
        }
        await Promise.all([existsInFilePromise.promise, exactMatchPromise.promise]);

        return exactMatchPromise.value || existsInFilePromise.value ? true : false;
    }
    private async getNotebookUriHash(notebook: NotebookDocument) {
        return getTelemetrySafeHashedString(notebook.uri.toString());
    }
    private async mruCache() {
        if (!this.workspaceMru) {
            this.workspaceMru = (async () => {
                try {
                    const contents = await this.context.workspaceState.get<string>(MRUListKey, '{}');
                    return JSON.parse(contents) as WorkspaceMRUList;
                } catch {
                    // File doesn't exist.
                    return {};
                }
            })();
        }
        return this.workspaceMru;
    }
    private async existsMru(notebook: NotebookDocument, connection: KernelConnectionMetadata) {
        const connections = this.documentSourceMapping.get(notebook);
        if (
            connections &&
            connections.size &&
            Array.from(connections)
                .map((item) => item.id)
                .includes(connection.id)
        ) {
            return true;
        }
        try {
            const [mru, connectionIdHash, notebookUriHash] = await Promise.all([
                this.mruCache(),
                connection.getHashId(),
                this.getNotebookUriHash(notebook)
            ]);
            return mru && mru[notebookUriHash] && mru[notebookUriHash].some((item) => item[1] === connectionIdHash);
        } catch {
            return false;
        }
    }
}
