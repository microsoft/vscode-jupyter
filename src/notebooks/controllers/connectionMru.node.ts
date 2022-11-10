// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from '../../platform/vscode-path/resources';
import { NotebookDocument, Uri } from 'vscode';
import { KernelConnectionMetadata } from '../../kernels/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { IExtensionContext } from '../../platform/common/types';
import { getNotebookMetadata } from '../../platform/common/utils';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import { traceWarning } from '../../platform/logging';
import { IKernelRankingHelper, IConnectionMru } from './types';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { createDeferredFromPromise } from '../../platform/common/utils/async';
import { IWorkspaceService } from '../../platform/common/application/types';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import * as fs from 'fs';
import { MaxMRUSizePerNotebook, MRUItem } from './connectionMru';

const MruFolder = 'notebook-connection-mru';
@injectable()
export class ConnectionMru implements IConnectionMru {
    private documentSourceMapping = new WeakMap<NotebookDocument, Set<KernelConnectionMetadata>>();
    private documentMruContents = new WeakMap<NotebookDocument, Promise<MRUItem[]>>();
    private notebookCacheFileName = new WeakMap<NotebookDocument, Promise<Uri>>();

    constructor(
        @inject(IKernelRankingHelper) private readonly kernelRankingHelper: IKernelRankingHelper,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}

    public async add(notebook: NotebookDocument, connection: KernelConnectionMetadata): Promise<void> {
        const connections = this.documentSourceMapping.get(notebook) || new Set<KernelConnectionMetadata>();
        connections.add(connection);
        this.documentSourceMapping.set(notebook, connections);

        // Keep track of this connection in the FS for future sessions.
        await this.storeSelections(notebook);
    }
    @swallowExceptions('Notebook Connection MRU')
    private async storeSelections(notebook: NotebookDocument) {
        const connections = this.documentSourceMapping.get(notebook);
        if (!this.context.storageUri || !connections || connections.size === 0) {
            return;
        }
        const file = await this.getCacheFileName(notebook);
        if (!(await this.fs.exists(path.dirname(file)))) {
            try {
                await this.fs.createDirectory(path.dirname(file));
            } catch (ex) {
                traceWarning(`Failed to create directory ${getDisplayPath(this.context.storageUri)}`, ex);
            }
        }
        if (await this.fs.exists(path.dirname(file))) {
            const connectionIdsUsedInSession = new Set<string>();
            const [currentMru, connectionsUsedInSession] = await Promise.all([
                this.loadNotebookCache(notebook),
                Promise.all(
                    Array.from(connections).map(async (item) => {
                        const id = await item.getHashId();
                        connectionIdsUsedInSession.add(id);
                        return <MRUItem>[Date.now(), id];
                    })
                )
            ]);
            const idsInMru = new Set<string>();

            // For existing items, update the last used time.
            currentMru.forEach((mru) => {
                idsInMru.add(mru[1]);
                if (connectionIdsUsedInSession.has(mru[1])) {
                    mru[0] = Date.now();
                }
            });
            // If we have more than 10 items, then remove the oldest items.
            const newMruItems = currentMru
                .concat(connectionsUsedInSession.filter((item) => !idsInMru.has(item[1])))
                .sort((a, b) => b[0] - a[0])
                .slice(0, MaxMRUSizePerNotebook);

            this.documentMruContents.set(notebook, Promise.resolve(newMruItems));
            await this.fs.writeFile(file, JSON.stringify(newMruItems));
        }
    }
    public async clear(): Promise<void> {
        const cacheFolder = Uri.joinPath(this.context.globalStorageUri, MruFolder);
        new Promise<void>((resolve, reject) =>
            fs.rmdir(cacheFolder.fsPath, { recursive: true }, (ex) => (ex ? reject(ex) : resolve()))
        ).catch((ex) => traceWarning(`Failed to delete MRU cache folder ${getDisplayPath(cacheFolder)}`, ex));
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
        const existsInFilePromise = createDeferredFromPromise(this.existsInFile(notebook, connection));

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
    private async getCacheFileName(notebook: NotebookDocument) {
        if (!this.notebookCacheFileName.has(notebook)) {
            const promise = (async () => {
                const workspaceId = this.workspace.getWorkspaceFolderIdentifier(notebook.uri, 'global');
                const workspaceHash = await getTelemetrySafeHashedString(workspaceId);
                return Uri.joinPath(
                    this.context.storageUri || this.context.globalStorageUri,
                    MruFolder,
                    workspaceHash,
                    `${path.basename(notebook.uri)}.last_used_connections.json`
                );
            })();
            this.notebookCacheFileName.set(notebook, promise);
        }
        return this.notebookCacheFileName.get(notebook)!;
    }
    private async loadNotebookCache(notebook: NotebookDocument) {
        const mruFileContents = this.documentMruContents.get(notebook);
        if (!mruFileContents) {
            const promise = (async () => {
                try {
                    const file = await this.getCacheFileName(notebook);
                    const contents = await this.fs.readFile(file);
                    return JSON.parse(contents) as MRUItem[];
                } catch {
                    // File doesn't exist.
                    return [];
                }
            })();
            this.documentMruContents.set(notebook, promise);
        }
        return this.documentMruContents.get(notebook)!;
    }
    private async existsInFile(notebook: NotebookDocument, connection: KernelConnectionMetadata) {
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
            const [contents, connectionIdHash] = await Promise.all([
                this.loadNotebookCache(notebook),
                connection.getHashId()
            ]);
            return contents.some((item) => item[1] === connectionIdHash);
        } catch {
            return false;
        }
    }
}
