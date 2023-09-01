// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { IDisposable, IDisposableRegistry, IExtensionContext } from '../../platform/common/types';
import { Disposables } from '../../platform/common/utils';
import { IKernel, ResumeCellExecutionInformation, isRemoteConnection } from '../types';
import type { KernelMessage } from '@jupyterlab/services';
import { IAnyMessageArgs } from '@jupyterlab/services/lib/kernel/kernel';
import { dispose } from '../../platform/common/helpers';
import { Disposable, NotebookCell, NotebookDocument, Uri } from 'vscode';
import { swallowExceptions } from '../../platform/common/utils/misc';
import { getParentHeaderMsgId } from './cellExecutionMessageHandler';
import { IJupyterServerUriEntry, IJupyterServerUriStorage } from '../jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { generateIdFromRemoteProvider } from '../jupyter/jupyterUtils';

const MAX_TRACKING_TIME = 1_000 * 60 * 60 * 24 * 2; // 2 days
type CellExecutionInfo = Omit<ResumeCellExecutionInformation, 'token'> & { kernelId: string; cellIndex: number };
type StorageExecutionInfo = CellExecutionInfo & { serverId: string; sessionId: string };

/**
 * Keeps track of the last cell that was executed for a notebook along with the time and execution count.
 */
@injectable()
export class LastCellExecutionTracker extends Disposables implements IExtensionSyncActivationService {
    private readonly executedCells = new WeakMap<NotebookCell, Partial<CellExecutionInfo>>();
    private chainedPromises = Promise.resolve();
    private readonly storageFile: Uri;
    private ensureStorageExistsPromise?: Promise<Uri>;
    private staleState?: Record<string, StorageExecutionInfo>;

    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IJupyterServerUriStorage) private readonly serverStorage: IJupyterServerUriStorage,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {
        super();
        context.globalStorageUri;
        disposables.push(this);
        this.storageFile = Uri.joinPath(this.context.globalStorageUri, 'lastExecutedRemoteCell.json');
    }
    public activate(): void {
        this.serverStorage.onDidRemove(this.onDidRemoveServerUris, this, this.disposables);
    }
    public async getLastTrackedCellExecution(
        notebook: NotebookDocument,
        kernel: IKernel
    ): Promise<CellExecutionInfo | undefined> {
        if (notebook.isUntitled) {
            return;
        }
        if (!isRemoteConnection(kernel.kernelConnectionMetadata) || !kernel.session?.id) {
            return;
        }
        if (this.staleState && this.staleState[notebook.uri.toString()]) {
            return this.staleState[notebook.uri.toString()];
        }

        const file = await this.getStorageFile();
        let store: Record<string, StorageExecutionInfo> = {};
        try {
            const data = await this.fs.readFile(file);
            store = JSON.parse(data.toString()) as Record<string, StorageExecutionInfo>;
            this.staleState = store;
        } catch {
            // Ignore, as this indicates the file does not exist.
            return;
        }
        return store[notebook.uri.toString()];
    }
    public trackCellExecution(cell: NotebookCell, kernel: IKernel) {
        // For now we are only interested in remote kernel connections.
        if (!isRemoteConnection(kernel.kernelConnectionMetadata) || cell.document.isUntitled) {
            return;
        }
        this.executedCells.delete(cell);

        let disposable: IDisposable | undefined;
        const disposables: IDisposable[] = [];
        const anyMessageHandler = (_: unknown, msg: IAnyMessageArgs) => {
            if (msg.direction === 'send') {
                const request = msg.msg as KernelMessage.IExecuteRequestMsg;
                if (
                    request.header.msg_type === 'execute_request' &&
                    request.metadata &&
                    typeof request.metadata === 'object' &&
                    request.metadata &&
                    'cellId' in request.metadata &&
                    typeof request.metadata.cellId === 'string' &&
                    request.metadata.cellId === cell.document.uri.toString()
                ) {
                    const msg_id = request.header.msg_id;
                    this.executedCells.set(cell, {
                        msg_id,
                        kernelId: kernel.session?.kernel?.id || '',
                        cellIndex: cell.index
                    });
                }
            } else if (msg.direction === 'recv') {
                const ioPub = msg.msg as KernelMessage.IIOPubMessage;
                const info = this.executedCells.get(cell);
                if (info?.msg_id && getParentHeaderMsgId(ioPub) === info.msg_id) {
                    if (!info.startTime) {
                        info.startTime = new Date().getTime();
                        try {
                            // Time from the kernel is more accurate.
                            info.startTime = new Date(ioPub.header.date).getTime();
                        } catch {
                            // Ignore.
                        }
                        this.executedCells.set(cell, info);
                    }
                    if (
                        'execution_count' in ioPub.content &&
                        typeof ioPub.content.execution_count === 'number' &&
                        !info.executionCount
                    ) {
                        if (info.executionCount !== ioPub.content.execution_count) {
                            info.executionCount = ioPub.content.execution_count;
                            this.executedCells.set(cell, info);
                            this.trackLastExecution(cell, kernel, info);
                            dispose(disposables);
                        }
                    }
                }
            }
        };

        const hookUpSession = () => {
            const session = kernel.session;
            if (!session) {
                return;
            }
            session.anyMessage.connect(anyMessageHandler);
            disposable = new Disposable(() =>
                swallowExceptions(() => session.anyMessage?.disconnect(anyMessageHandler))
            );
            disposables.push(disposable);
        };
        kernel.onStarted(() => hookUpSession(), disposables);
        if (kernel.session) {
            hookUpSession();
        }
    }
    public deleteTrackedCellExecution(cell: NotebookCell, kernel: IKernel) {
        if (cell.notebook.isUntitled) {
            return;
        }
        if (!isRemoteConnection(kernel.kernelConnectionMetadata) || !kernel.session?.id) {
            return;
        }

        this.chainedPromises = this.chainedPromises.finally(async () => {
            let store: Record<string, StorageExecutionInfo> = {};
            try {
                const data = await this.getStorageFile().then(() => this.fs.readFile(this.storageFile));
                store = JSON.parse(data.toString()) as Record<string, StorageExecutionInfo>;
            } catch {
                // Ignore, as this indicates the file does not exist.
                return;
            }
            const notebookId = cell.notebook.uri.toString();
            if (store[notebookId].cellIndex === cell.index) {
                delete store[notebookId];
                this.staleState = store;
                await this.fs.writeFile(this.storageFile, JSON.stringify(store));
            }
        });
    }
    private getStorageFile() {
        this.ensureStorageExistsPromise =
            this.ensureStorageExistsPromise ||
            (async () => {
                await this.fs.createDirectory(this.context.globalStorageUri);
                return this.storageFile;
            })();
        return this.ensureStorageExistsPromise;
    }
    private trackLastExecution(cell: NotebookCell, kernel: IKernel, info: Partial<CellExecutionInfo>) {
        if (!info.executionCount || !info.msg_id || !info.startTime) {
            return;
        }
        if (!isRemoteConnection(kernel.kernelConnectionMetadata) || !kernel.session?.id) {
            return;
        }
        const storageInfo: StorageExecutionInfo = {
            cellIndex: cell.index,
            executionCount: info.executionCount,
            kernelId: kernel.session?.kernel?.id || '',
            msg_id: info.msg_id,
            serverId: generateIdFromRemoteProvider(kernel.kernelConnectionMetadata.serverProviderHandle),
            sessionId: kernel.session?.id,
            startTime: info.startTime
        };
        this.chainedPromises = this.chainedPromises.finally(async () => {
            let store: Record<string, StorageExecutionInfo> = {};
            try {
                const data = await this.getStorageFile().then(() => this.fs.readFile(this.storageFile));
                store = JSON.parse(data.toString()) as Record<string, StorageExecutionInfo>;
            } catch {
                // Ignore, as this indicates the file does not exist.
            }
            const notebookId = cell.notebook.uri.toString();
            store[notebookId] = storageInfo;
            this.removeOldItems(store);
            this.staleState = store;
            await this.fs.writeFile(this.storageFile, JSON.stringify(store));
        });
    }
    private onDidRemoveServerUris(removedServers: IJupyterServerUriEntry[]) {
        if (removedServers.length === 0) {
            return;
        }
        this.chainedPromises = this.chainedPromises.finally(async () => {
            await this.getStorageFile();
            let store: Record<string, StorageExecutionInfo> = {};
            try {
                const data = await this.fs.readFile(this.storageFile);
                store = JSON.parse(data.toString()) as Record<string, StorageExecutionInfo>;
            } catch {
                // Ignore, as this indicates the file does not exist.
            }
            let removed = false;
            const removedServerIds = new Set(removedServers.map((s) => generateIdFromRemoteProvider(s.provider)));
            Object.keys(store).forEach((key) => {
                const data = store[key];
                if (
                    removedServerIds.has(data.serverId) || // No longer a valid server
                    Date.now() - data.startTime > MAX_TRACKING_TIME // If its too old, then remove it.
                ) {
                    delete store[key];
                    removed = true;
                }
            });

            if (removed) {
                this.removeOldItems(store);
                this.staleState = store;
                await this.fs.writeFile(this.storageFile, JSON.stringify(store));
            }
        });
    }
    private removeOldItems(store: Record<string, StorageExecutionInfo>) {
        Object.keys(store).forEach((key) => {
            const data = store[key];
            if (data && Date.now() - data.startTime > MAX_TRACKING_TIME) {
                delete store[key];
            }
        });
    }
}
