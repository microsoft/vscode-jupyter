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
import { EOL } from 'os';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { createDeferredFromPromise } from '../../platform/common/utils/async';
import { IWorkspaceService } from '../../platform/common/application/types';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';

const MruFolder = 'notebook-connection-mru';
@injectable()
export class ConnectionMRU implements IConnectionMru {
    private documentSourceMapping = new WeakMap<NotebookDocument, Set<KernelConnectionMetadata>>();
    private documentMruContents = new WeakMap<NotebookDocument, Promise<string | undefined>>();
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
                await this.fs.createDirectory(this.context.storageUri);
            } catch (ex) {
                traceWarning(`Failed to create directory ${getDisplayPath(this.context.storageUri)}`, ex);
            }
        }
        if (await this.fs.exists(path.dirname(file))) {
            const [connectionIdsInMru, connectionIds] = await Promise.all([
                this.fs
                    .readFile(file)
                    .then((c) => c.splitLines({ trim: true, removeEmptyEntries: true }))
                    .catch(() => <string[]>[]),
                Promise.all(Array.from(connections).map((item) => item.getHashId()))
            ]);
            const updatedConnectionIds = Array.from(new Set(connectionIdsInMru.concat(connectionIds)));
            const newContents = updatedConnectionIds.join(EOL);
            this.documentMruContents.set(notebook, Promise.resolve(newContents));
            await this.fs.writeFile(file, newContents);
        }
    }
    public async clear(): Promise<void> {
        const cacheFolder = Uri.joinPath(this.context.globalStorageUri, MruFolder);
        await this.fs
            .delete(cacheFolder)
            .catch((ex) => traceWarning(`Failed to delete MRU cache folder ${getDisplayPath(cacheFolder)}`, ex));
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
                    this.context.globalStorageUri,
                    MruFolder,
                    workspaceHash,
                    `${path.basename(notebook.uri)}.last_used_connections.txt`
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
                const file = await this.getCacheFileName(notebook);
                return this.fs.readFile(file);
            })();
            this.documentMruContents.set(notebook, promise);
        }
        return this.documentMruContents.get(notebook);
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
            return (contents || '').includes(connectionIdHash);
        } catch {
            return false;
        }
    }
}
