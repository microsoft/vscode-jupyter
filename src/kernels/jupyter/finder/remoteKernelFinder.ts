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
import {
    IOldJupyterSessionManagerFactory,
    IJupyterRemoteCachedKernelValidator,
    IRemoteKernelFinder,
    JupyterServerProviderHandle
} from '../types';
import { sendKernelSpecTelemetry } from '../../raw/finder/helper';
import { traceError, traceWarning, traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import { raceCancellation } from '../../../platform/common/cancellation';
import { areObjectsWithUrisTheSame, noop } from '../../../platform/common/utils/misc';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { KernelFinder } from '../../kernelFinder';
import { ContributedKernelFinderKind } from '../../internalTypes';
import { dispose } from '../../../platform/common/helpers';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { JupyterConnection } from '../connection/jupyterConnection';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';
import { isUnitTestExecution } from '../../../platform/common/constants';
import { IFileSystem } from '../../../platform/common/platform/types';
import { computeServerId, generateIdFromRemoteProvider } from '../jupyterUtils';
import { RemoteKernelSpecCacheFileName } from '../constants';

// Even after shutting down a kernel, the server API still returns the old information.
// Re-query after 2 seconds to ensure we don't get stale information.
const REMOTE_KERNEL_REFRESH_INTERVAL = 2_000;

export type CacheDataFormat = {
    extensionVersion: string;
    data: Record<string, ReturnType<RemoteKernelConnectionMetadata['toJSON']>[]>;
};

// This class watches a single jupyter server URI and returns kernels from it
export class RemoteKernelFinder implements IRemoteKernelFinder, IDisposable {
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
    private cacheLoggingTimeout?: NodeJS.Timer | number;
    private _onDidChangeKernels = new EventEmitter<{
        removed?: { id: string }[];
    }>();
    onDidChangeKernels = this._onDidChangeKernels.event;
    private readonly _onDidChange = new EventEmitter<void>();
    onDidChange = this._onDidChange.event;

    private readonly disposables: IDisposable[] = [];

    // Track our delay timer for when we update on kernel dispose
    private kernelDisposeDelayTimer: NodeJS.Timeout | number | undefined;

    private readonly cacheKey: string;
    private readonly cacheFile: Uri;

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
        private jupyterSessionManagerFactory: IOldJupyterSessionManagerFactory,
        private readonly env: IApplicationEnvironment,
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        kernelFinder: KernelFinder,
        private readonly kernelProvider: IKernelProvider,
        readonly serverProviderHandle: JupyterServerProviderHandle,
        private readonly jupyterConnection: JupyterConnection,
        private readonly fs: IFileSystem,
        private readonly context: IExtensionContext
    ) {
        this.cacheFile = Uri.joinPath(context.globalStorageUri, RemoteKernelSpecCacheFileName);
        this.cacheKey = generateIdFromRemoteProvider(serverProviderHandle);
        // When we register, add a disposable to clean ourselves up from the main kernel finder list
        // Unlike the Local kernel finder universal remote kernel finders will be added on the fly
        this.disposables.push(kernelFinder.registerKernelFinder(this));

        this._onDidChangeKernels.event(() => this._onDidChange.fire(), this, this.disposables);
        this.disposables.push(this._onDidChangeKernels);
        this.disposables.push(this._onDidChange);
        this.disposables.push(this._onDidChangeStatus);
        this.disposables.push(this.promiseMonitor);
    }

    dispose(): void | undefined {
        if (this.kernelDisposeDelayTimer) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clearTimeout(this.kernelDisposeDelayTimer as any);
        }
        dispose(this.disposables);
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
        this.kernelProvider.onDidStartKernel(
            (k) => {
                if (isRemoteConnection(k.kernelConnectionMetadata)) {
                    // update remote kernels
                    this.updateCache().then(noop, noop);
                }
            },
            this,
            this.disposables
        );

        // For kernel dispose we need to wait a bit, otherwise the list comes back the
        // same
        this.kernelProvider.onDidDisposeKernel(
            (k) => {
                if (k && isRemoteConnection(k.kernelConnectionMetadata)) {
                    if (this.kernelDisposeDelayTimer) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        clearTimeout(this.kernelDisposeDelayTimer as any);
                        this.kernelDisposeDelayTimer = undefined;
                    }
                    const timer = setTimeout(() => {
                        this.updateCache().then(noop, noop);
                    }, REMOTE_KERNEL_REFRESH_INTERVAL);

                    this.kernelDisposeDelayTimer = timer;

                    return timer;
                }
            },
            this,
            this.disposables
        );
    }

    public async refresh(): Promise<void> {
        // Display a progress indicator only when user refreshes the list.
        await this.loadCache(true, true);
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
                    const kernelsWithoutCachePromise = (async () => {
                        const connInfo = await this.getRemoteConnectionInfo(displayProgress);
                        return connInfo ? this.listKernelsFromConnection(connInfo) : Promise.resolve([]);
                    })();

                    kernels = await kernelsWithoutCachePromise;
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
                const kernelsWithoutCachePromise = (async () => {
                    const connInfo = await this.getRemoteConnectionInfo(false);
                    return connInfo ? this.listKernelsFromConnection(connInfo) : Promise.resolve([]);
                })();

                kernels = await kernelsWithoutCachePromise;
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
            const sessionManager = await this.jupyterSessionManagerFactory.create(connInfo);
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
            const kernels = new Map(values.map((item) => [item.id, item]));
            const added = values.filter((k) => !oldKernels.has(k.id));
            const updated = values.filter(
                (k) => oldKernels.has(k.id) && !areObjectsWithUrisTheSame(k, oldKernels.get(k.id))
            );
            const removed = oldValues.filter((k) => !kernels.has(k.id));

            const key = this.cacheKey;
            this.cache = values;
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
            if (values.length) {
                if (this.cacheLoggingTimeout) {
                    clearTimeout(this.cacheLoggingTimeout);
                }
                // Reduce the logging, as this can get written a lot,
                this.cacheLoggingTimeout = setTimeout(
                    () => {
                        traceVerbose(
                            `Updating cache with Remote kernels ${values
                                .map(
                                    (k) => `${k.kind}:'${k.id} (interpreter id = ${getDisplayPath(k.interpreter?.id)})'`
                                )
                                .join(', ')}, Added = ${added
                                .map(
                                    (k) => `${k.kind}:'${k.id} (interpreter id = ${getDisplayPath(k.interpreter?.id)})'`
                                )
                                .join(', ')}, Updated = ${updated
                                .map(
                                    (k) => `${k.kind}:'${k.id} (interpreter id = ${getDisplayPath(k.interpreter?.id)})'`
                                )
                                .join(', ')}, Removed = ${removed
                                .map(
                                    (k) => `${k.kind}:'${k.id} (interpreter id = ${getDisplayPath(k.interpreter?.id)})'`
                                )
                                .join(', ')}`
                        );
                    },
                    isUnitTestExecution() ? 0 : 15_000
                );
                this.disposables.push(new Disposable(() => clearTimeout(this.cacheLoggingTimeout)));
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
