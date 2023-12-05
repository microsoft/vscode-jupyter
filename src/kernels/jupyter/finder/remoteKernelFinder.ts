// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, CancellationToken, CancellationTokenSource, Disposable, EventEmitter, Uri } from 'vscode';
import { getKernelId } from '../../helpers';
import {
    BaseKernelConnectionMetadata,
    IJupyterKernelSpec,
    IKernelProvider,
    IJupyterConnection,
    isRemoteConnection,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../types';
import { IAsyncDisposable, IDisposable, IExtensionContext } from '../../../platform/common/types';
import { IJupyterRemoteCachedKernelValidator, IRemoteKernelFinder, JupyterServerProviderHandle } from '../types';
import { sendKernelSpecTelemetry } from '../../raw/finder/helper';
import { traceError, traceWarning, traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import { raceCancellation } from '../../../platform/common/cancellation';
import { areObjectsWithUrisTheSame, noop } from '../../../platform/common/utils/misc';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { KernelFinder } from '../../kernelFinder';
import { ContributedKernelFinderKind } from '../../internalTypes';
import { DisposableBase, dispose } from '../../../platform/common/utils/lifecycle';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { JupyterConnection } from '../connection/jupyterConnection';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';
import { IFileSystem } from '../../../platform/common/platform/types';
import { computeServerId, generateIdFromRemoteProvider } from '../jupyterUtils';
import { RemoteKernelSpecCacheFileName } from '../constants';
import { JupyterLabHelper } from '../session/jupyterLabHelper';

// Even after shutting down a kernel, the server API still returns the old information.
// Re-query after 2 seconds to ensure we don't get stale information.
const REMOTE_KERNEL_REFRESH_INTERVAL = 2_000;

export type CacheDataFormat = {
    extensionVersion: string;
    data: Record<string, ReturnType<RemoteKernelConnectionMetadata['toJSON']>[]>;
};

// This class watches a single jupyter server URI and returns kernels from it
export class RemoteKernelFinder extends DisposableBase implements IRemoteKernelFinder {
    private _status: 'discovering' | 'idle' = 'idle';
    public get status() {
        return this._status;
    }
    private set status(value: typeof this._status) {
        if (this._status === value) {
            return;
        }
        this._status = value;
        this._onDidChangeStatus.fire();
    }
    private readonly _onDidChangeStatus = new EventEmitter<void>();
    public readonly onDidChangeStatus = this._onDidChangeStatus.event;
    private _lastError?: Error;
    public get lastError() {
        return this._lastError;
    }
    private readonly promiseMonitor = new PromiseMonitor();
    /**
     * List of ids of kernels that should be hidden from the kernel picker.
     */
    private readonly kernelIdsToHide = new Set<string>();
    kind: ContributedKernelFinderKind.Remote = ContributedKernelFinderKind.Remote;
    private _cacheUpdateCancelTokenSource: CancellationTokenSource | undefined;
    private cache: RemoteKernelConnectionMetadata[] = [];
    private _onDidChangeKernels = new EventEmitter<{
        removed?: { id: string }[];
    }>();
    onDidChangeKernels = this._onDidChangeKernels.event;
    private readonly _onDidChange = new EventEmitter<void>();
    onDidChange = this._onDidChange.event;

    // Track our delay timer for when we update on kernel dispose
    private kernelDisposeDelayTimer?: Disposable;

    private readonly cacheKey: string;
    private readonly cacheFile: Uri;
    private cachedConnection?: Promise<IJupyterConnection | undefined>;

    /**
     *
     * Remote kernel finder is resource agnostic.
     */
    public get kernels(): RemoteKernelConnectionMetadata[] {
        return this.cache;
    }
    get items(): RemoteKernelConnectionMetadata[] {
        return this.kernels;
    }
    get title(): string {
        return this.displayName;
    }
    constructor(
        readonly id: string,
        readonly displayName: string,
        private readonly env: IApplicationEnvironment,
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        kernelFinder: KernelFinder,
        private readonly kernelProvider: IKernelProvider,
        readonly serverProviderHandle: JupyterServerProviderHandle,
        private readonly jupyterConnection: JupyterConnection,
        private readonly fs: IFileSystem,
        private readonly context: IExtensionContext
    ) {
        super();
        this.cacheFile = Uri.joinPath(context.globalStorageUri, RemoteKernelSpecCacheFileName);
        this.cacheKey = generateIdFromRemoteProvider(serverProviderHandle);
        // When we register, add a disposable to clean ourselves up from the main kernel finder list
        // Unlike the Local kernel finder universal remote kernel finders will be added on the fly
        this._register(kernelFinder.registerKernelFinder(this));

        this._register(this._onDidChangeKernels.event(() => this._onDidChange.fire(), this));
        this._register(this._onDidChangeKernels);
        this._register(this._onDidChange);
        this._register(this._onDidChangeStatus);
        this._register(this.promiseMonitor);
    }

    override dispose(): void | undefined {
        super.dispose();
        this._cacheUpdateCancelTokenSource?.dispose();
        this.kernelDisposeDelayTimer?.dispose();
    }

    async activate(): Promise<void> {
        this.promiseMonitor.onStateChange(() => {
            this.status = this.promiseMonitor.isComplete ? 'idle' : 'discovering';
        });

        // warm up the cache
        this.loadCache().then(noop, noop);

        // If we create a new kernel, we need to refresh if the kernel is remote (because
        // we have live sessions possible)
        // Note, this is a perf optimization for right now. We should not need
        // to check for remote if the future when we support live sessions on local
        this._register(
            this.kernelProvider.onDidStartKernel((k) => {
                if (isRemoteConnection(k.kernelConnectionMetadata)) {
                    // update remote kernels
                    this.updateCache().then(noop, noop);
                }
            }, this)
        );

        // For kernel dispose we need to wait a bit, otherwise the list comes back the
        // same
        this._register(
            this.kernelProvider.onDidDisposeKernel((k) => {
                if (k && isRemoteConnection(k.kernelConnectionMetadata)) {
                    this.kernelDisposeDelayTimer?.dispose();
                    const timer = setTimeout(() => {
                        this.updateCache().then(noop, noop);
                    }, REMOTE_KERNEL_REFRESH_INTERVAL);

                    this.kernelDisposeDelayTimer = new Disposable(() => clearTimeout(timer));
                    return timer;
                }
            }, this)
        );
    }

    public async refresh(): Promise<void> {
        // Display a progress indicator only when user refreshes the list.
        await this.loadCache(true, true);
    }
    private getListOfKernelsWithCachedConnection(
        displayProgress: boolean,
        ignoreCache: boolean = false
    ): Promise<RemoteKernelConnectionMetadata[]> {
        const usingCache = !!this.cachedConnection;
        this.cachedConnection = this.cachedConnection || this.getRemoteConnectionInfo(displayProgress);
        return this.cachedConnection
            .then((connInfo) => {
                if (connInfo && !usingCache) {
                    this.cachedConnection = Promise.resolve(connInfo);
                }
                return connInfo ? this.listKernelsFromConnection(connInfo) : Promise.resolve([]);
            })
            .catch((ex) => {
                if (this.isDisposed) {
                    return Promise.reject(ex);
                }
                if (usingCache) {
                    return this.getListOfKernelsWithCachedConnection(displayProgress, ignoreCache);
                }
                this.cachedConnection = undefined;
                return Promise.reject(ex);
            });
    }

    public async loadCache(ignoreCache: boolean = false, displayProgress: boolean = false): Promise<void> {
        traceInfoIfCI(`Remote Kernel Finder load cache Server: ${this.id}`);
        const promise = (async () => {
            const kernelsFromCache = ignoreCache ? [] : await this.getFromCache();

            let kernels: RemoteKernelConnectionMetadata[] = [];

            // If we finish the cache first, and we don't have any items, in the cache, then load without cache.
            if (!ignoreCache && Array.isArray(kernelsFromCache) && kernelsFromCache.length > 0) {
                kernels = kernelsFromCache;
                // kick off a cache update request
                this.updateCache().then(noop, noop);
                // It is however still possible that the cache is old and the connection is outdated
                // In this case users might end up getting old outdated data which would be incorrect.
                // I.e. server could be dead and user is able to select a dead kernel.
                // To avoid such cases we should always refresh the list of kernels.
                this.loadCache(true).then(noop, noop);
            } else {
                try {
                    kernels = await this.getListOfKernelsWithCachedConnection(displayProgress);
                    this._lastError = undefined;
                } catch (ex) {
                    // CancellationError is when user cancels the request, no need to log errors related to that.
                    if (!(ex instanceof CancellationError)) {
                        traceError('UniversalRemoteKernelFinder: Failed to get kernels without cache', ex);
                        this._lastError = ex;
                        this._onDidChange.fire();
                    }
                }
            }

            await this.writeToCache(kernels);
        })();
        this.promiseMonitor.push(promise);
        await promise;
    }

    private async updateCache() {
        const promise = (async () => {
            let kernels: RemoteKernelConnectionMetadata[] = [];
            this._cacheUpdateCancelTokenSource?.dispose();
            const updateCacheCancellationToken = new CancellationTokenSource();
            this._cacheUpdateCancelTokenSource = updateCacheCancellationToken;

            try {
                kernels = await this.getListOfKernelsWithCachedConnection(false);
            } catch (ex) {
                traceWarning(`Could not fetch kernels from the ${this.kind} server, falling back to cache: ${ex}`);
                // Since fetching the remote kernels failed, we fall back to the cache,
                // at this point no need to display all of the kernel specs,
                // Its possible the connection is dead, just display the live kernels we had.
                // I.e. if user had a notebook connected to a remote kernel, then just display that live kernel.
                kernels = await this.getFromCache(updateCacheCancellationToken.token);
                kernels = kernels.filter((item) => item.kind === 'connectToLiveRemoteKernel');
            }

            if (updateCacheCancellationToken.token.isCancellationRequested) {
                return;
            }

            await this.writeToCache(kernels);
        })();
        this.promiseMonitor.push(promise);
        await promise;
    }

    private async getRemoteConnectionInfo(displayProgress: boolean = true): Promise<IJupyterConnection | undefined> {
        const disposables: IDisposable[] = [];
        if (displayProgress) {
            disposables.push(KernelProgressReporter.createProgressReporter(undefined, DataScience.connectingToJupyter));
        }
        return this.jupyterConnection
            .createConnectionInfo(this.serverProviderHandle)
            .finally(() => dispose(disposables));
    }

    private async getFromCache(cancelToken?: CancellationToken): Promise<RemoteKernelConnectionMetadata[]> {
        try {
            if (cancelToken?.isCancellationRequested) {
                throw new CancellationError();
            }
            let results: RemoteKernelConnectionMetadata[] = this.cache;

            // If not in memory, check memento
            if (!results || results.length === 0) {
                // Check memento too
                results = await this.getCacheContents();
            }
            // Validate
            const validValues: RemoteKernelConnectionMetadata[] = [];
            const promise = Promise.all(
                results.map(async (item) => {
                    if (await this.isValidCachedKernel(item)) {
                        validValues.push(item);
                    }
                })
            );
            await raceCancellation(cancelToken, promise);
            return validValues;
        } catch (ex) {
            traceError('UniversalRemoteKernelFinder: Failed to get from cache', ex);
        }

        return [];
    }
    private async getCacheContents(): Promise<RemoteKernelConnectionMetadata[]> {
        try {
            const data = await this.fs.readFile(this.cacheFile);
            const json = JSON.parse(data) as CacheDataFormat;
            if (json.extensionVersion !== this.env.extensionVersion) {
                return [];
            }
            const cache = json.data[this.cacheKey] || [];
            if (Array.isArray(cache)) {
                return cache.map((item) =>
                    BaseKernelConnectionMetadata.fromJSON(item)
                ) as RemoteKernelConnectionMetadata[];
            } else {
                return [];
            }
        } catch {
            // File does not exist.
            return [];
        }
    }
    // Talk to the remote server to determine sessions
    public async listKernelsFromConnection(connInfo: IJupyterConnection): Promise<RemoteKernelConnectionMetadata[]> {
        const disposables: IAsyncDisposable[] = [];
        try {
            const sessionManager = JupyterLabHelper.create(connInfo.settings);
            disposables.push(sessionManager);

            // Get running and specs at the same time
            const [running, specs, sessions, serverId] = await Promise.all([
                sessionManager.getRunningKernels(),
                sessionManager.getKernelSpecs(),
                sessionManager.getRunningSessions(),
                computeServerId(connInfo.serverProviderHandle)
            ]);

            // Turn them both into a combined list
            const mappedSpecs = specs.map((s) => {
                sendKernelSpecTelemetry(s, 'remote');
                return RemoteKernelSpecConnectionMetadata.create({
                    kernelSpec: s,
                    id: getKernelId(s, undefined, serverId),
                    baseUrl: connInfo.baseUrl,
                    serverProviderHandle: connInfo.serverProviderHandle
                });
            });
            const mappedLive = sessions.map((s) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const liveKernel = s.kernel as any;
                const lastActivityTime = liveKernel.last_activity
                    ? new Date(Date.parse(liveKernel.last_activity.toString()))
                    : new Date();
                const numberOfConnections = liveKernel.connections
                    ? parseInt(liveKernel.connections.toString(), 10)
                    : 0;
                const activeKernel = running.find((active) => active.id === s.kernel?.id) || {};
                const matchingSpec: Partial<IJupyterKernelSpec> =
                    specs.find((spec) => spec.name === s.kernel?.name) || {};

                const kernel = LiveRemoteKernelConnectionMetadata.create({
                    kernelModel: {
                        ...s.kernel,
                        ...matchingSpec,
                        ...activeKernel,
                        name: s.kernel?.name || '',
                        lastActivityTime,
                        numberOfConnections,
                        model: s
                    },
                    baseUrl: connInfo.baseUrl,
                    id: s.kernel?.id || '',
                    serverProviderHandle: connInfo.serverProviderHandle
                });
                return kernel;
            });

            // Filter out excluded ids
            const filtered = mappedLive.filter((k) => !this.kernelIdsToHide.has(k.kernelModel.id || ''));
            return [...filtered, ...mappedSpecs];
        } catch (ex) {
            traceError(`Error fetching kernels from ${connInfo.baseUrl} (${connInfo.displayName}):`, ex);
            throw ex;
        } finally {
            await Promise.all(disposables.map((d) => d.dispose().catch(noop)));
        }
    }

    private async writeToCache(values: RemoteKernelConnectionMetadata[]) {
        try {
            traceVerbose(
                `UniversalRemoteKernelFinder: Writing ${values.length} remote kernel connection metadata to cache`
            );

            const oldValues = this.cache;
            const oldKernels = new Map(oldValues.map((item) => [item.id, item]));
            const latestValidKernels = new Map(values.map((item) => [item.id, item]));
            const added = values.filter((k) => !oldKernels.has(k.id));
            const updated = values.filter(
                (k) => oldKernels.has(k.id) && !areObjectsWithUrisTheSame(k, oldKernels.get(k.id))
            );
            const removed = oldValues.filter((k) => !latestValidKernels.has(k.id));

            const key = this.cacheKey;
            // Always keep a single object in memory, so that we can use the same object everywhere and know
            // that it will be upto date.
            this.cache = oldValues.filter((k) => latestValidKernels.has(k.id)).concat(added);

            // Now update the objects in place.
            this.cache.forEach((kernel) => {
                const latestKernel = latestValidKernels.get(kernel.id)!;
                if (kernel === latestKernel) {
                    // same object ref, that means this is not really an old item.
                    return;
                }
                if (latestKernel.kind === 'connectToLiveRemoteKernel' && kernel.kind === 'connectToLiveRemoteKernel') {
                    // Update the model in place, now we have basically a singleton for each connection.
                    kernel.updateModel(latestKernel.kernelModel);
                }
            });
            const serialized = values.map((item) => item.toJSON());
            let currentData: CacheDataFormat = { extensionVersion: this.env.extensionVersion, data: {} };
            try {
                const data = await this.fs.readFile(this.cacheFile);
                const json = JSON.parse(data) as CacheDataFormat;
                if (json.extensionVersion === this.env.extensionVersion) {
                    currentData = json;
                }
            } catch {
                // File does not exist.
            }

            currentData.data[key] = serialized;
            await this.fs
                .createDirectory(this.context.globalStorageUri)
                .then(() => this.fs.writeFile(this.cacheFile, JSON.stringify(currentData)))
                .catch((ex) => {
                    traceError(`Failed to cache the remote kernels.`, ex);
                });

            if (added.length || updated.length || removed.length) {
                this._onDidChangeKernels.fire({ removed });
                // this._onDidChangeKernels.fire({ added, updated, removed });
            }
        } catch (ex) {
            traceError('UniversalRemoteKernelFinder: Failed to write to cache', ex);
        }
    }

    private async isValidCachedKernel(kernel: RemoteKernelConnectionMetadata): Promise<boolean> {
        switch (kernel.kind) {
            case 'startUsingRemoteKernelSpec':
                // Always fetch the latest kernels from remotes, no need to display cached remote kernels.
                return false;
            case 'connectToLiveRemoteKernel':
                return this.cachedRemoteKernelValidator.isValid(kernel);
        }
    }
}
