// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CancellationTokenSource, EventEmitter, Memento } from 'vscode';
import { getKernelId } from '../../helpers';
import {
    BaseKernelConnectionMetadata,
    IJupyterKernelSpec,
    IKernelProvider,
    INotebookProvider,
    INotebookProviderConnection,
    isRemoteConnection,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../types';
import { IDisposable, IExtensions } from '../../../platform/common/types';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import {
    IJupyterSessionManagerFactory,
    IJupyterSessionManager,
    IJupyterRemoteCachedKernelValidator,
    IRemoteKernelFinder,
    IJupyterServerUriEntry
} from '../types';
import { sendKernelSpecTelemetry } from '../../raw/finder/helper';
import { traceError, traceWarning, traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { computeServerId } from '../jupyterUtils';
import { createPromiseFromCancellation } from '../../../platform/common/cancellation';
import { DisplayOptions } from '../../displayOptions';
import { isArray } from '../../../platform/common/utils/sysTypes';
import { areObjectsWithUrisTheSame, noop } from '../../../platform/common/utils/misc';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { KernelFinder } from '../../kernelFinder';
import { removeOldCachedItems } from '../../common/commonFinder';
import { ContributedKernelFinderKind } from '../../internalTypes';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { PromiseMonitor } from '../../../platform/common/utils/promises';

// Even after shutting down a kernel, the server API still returns the old information.
// Re-query after 2 seconds to ensure we don't get stale information.
const REMOTE_KERNEL_REFRESH_INTERVAL = 2_000;

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

    private _onDidChangeKernels = new EventEmitter<{
        added?: RemoteKernelConnectionMetadata[];
        updated?: RemoteKernelConnectionMetadata[];
        removed?: RemoteKernelConnectionMetadata[];
    }>();
    onDidChangeKernels = this._onDidChangeKernels.event;

    private readonly disposables: IDisposable[] = [];

    // Track our delay timer for when we update on kernel dispose
    private kernelDisposeDelayTimer: NodeJS.Timeout | number | undefined;

    private wasPythonInstalledWhenFetchingKernels = false;

    constructor(
        readonly id: string,
        readonly displayName: string,
        readonly cacheKey: string,
        private jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        private extensionChecker: IPythonExtensionChecker,
        private readonly notebookProvider: INotebookProvider,
        private readonly globalState: Memento,
        private readonly env: IApplicationEnvironment,
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        kernelFinder: KernelFinder,
        private readonly kernelProvider: IKernelProvider,
        private readonly extensions: IExtensions,
        readonly serverUri: IJupyterServerUriEntry
    ) {
        // When we register, add a disposable to clean ourselves up from the main kernel finder list
        // Unlike the Local kernel finder universal remote kernel finders will be added on the fly
        this.disposables.push(kernelFinder.registerKernelFinder(this));

        this.disposables.push(this._onDidChangeKernels);
        this.disposables.push(this._onDidChangeStatus);
        this.disposables.push(this.promiseMonitor);
    }

    dispose(): void | undefined {
        if (this.kernelDisposeDelayTimer) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clearTimeout(this.kernelDisposeDelayTimer as any);
        }
        disposeAllDisposables(this.disposables);
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

        this.extensions.onDidChange(
            () => {
                // If we just installed the Python extension and we fetched the controllers, then fetch it again.
                if (!this.wasPythonInstalledWhenFetchingKernels && this.extensionChecker.isPythonExtensionInstalled) {
                    this.updateCache().then(noop, noop);
                }
            },
            this,
            this.disposables
        );
        this.wasPythonInstalledWhenFetchingKernels = this.extensionChecker.isPythonExtensionInstalled;
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
                        const connInfo = await this.getRemoteConnectionInfo(undefined, displayProgress);
                        return connInfo ? this.listKernelsFromConnection(connInfo) : Promise.resolve([]);
                    })();

                    kernels = await kernelsWithoutCachePromise;
                    this._lastError = undefined;
                } catch (ex) {
                    traceError('UniversalRemoteKernelFinder: Failed to get kernels without cache', ex);
                    this._lastError = ex;
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
                    const connInfo = await this.getRemoteConnectionInfo(updateCacheCancellationToken.token, false);
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

    /**
     *
     * Remote kernel finder is resource agnostic.
     */
    public get kernels(): RemoteKernelConnectionMetadata[] {
        return this.cache;
    }

    private async getRemoteConnectionInfo(
        cancelToken?: CancellationToken,
        displayProgress: boolean = true
    ): Promise<INotebookProviderConnection | undefined> {
        const ui = new DisplayOptions(!displayProgress);
        return this.notebookProvider.connect({
            resource: undefined,
            ui,
            localJupyter: false,
            token: cancelToken,
            serverId: this.serverUri.serverId
        });
    }

    private async getFromCache(cancelToken?: CancellationToken): Promise<RemoteKernelConnectionMetadata[]> {
        try {
            traceVerbose('UniversalRemoteKernelFinder: get from cache');

            let results: RemoteKernelConnectionMetadata[] = this.cache;
            const key = this.cacheKey;

            // If not in memory, check memento
            if (!results || results.length === 0) {
                // Check memento too
                const values = this.globalState.get<{
                    kernels: RemoteKernelConnectionMetadata[];
                    extensionVersion: string;
                }>(key, { kernels: [], extensionVersion: '' });

                if (values && isArray(values.kernels) && values.extensionVersion === this.env.extensionVersion) {
                    results = values.kernels.map((item) =>
                        BaseKernelConnectionMetadata.fromJSON(item)
                    ) as RemoteKernelConnectionMetadata[];
                }
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
            if (cancelToken) {
                await Promise.race([
                    promise,
                    createPromiseFromCancellation({
                        token: cancelToken,
                        cancelAction: 'resolve',
                        defaultValue: undefined
                    })
                ]);
            } else {
                await promise;
            }
            return validValues;
        } catch (ex) {
            traceError('UniversalRemoteKernelFinder: Failed to get from cache', ex);
        }

        return [];
    }

    // Talk to the remote server to determine sessions
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'remote' })
    public async listKernelsFromConnection(
        connInfo: INotebookProviderConnection
    ): Promise<RemoteKernelConnectionMetadata[]> {
        // Get a jupyter session manager to talk to
        let sessionManager: IJupyterSessionManager | undefined;
        // This should only be used when doing remote.
        if (connInfo.type === 'jupyter') {
            try {
                sessionManager = await this.jupyterSessionManagerFactory.create(connInfo);

                // Get running and specs at the same time
                const [running, specs, sessions, serverId] = await Promise.all([
                    sessionManager.getRunningKernels(),
                    sessionManager.getKernelSpecs(),
                    sessionManager.getRunningSessions(),
                    computeServerId(connInfo.url)
                ]);

                // Turn them both into a combined list
                const mappedSpecs = await Promise.all(
                    specs.map(async (s) => {
                        await sendKernelSpecTelemetry(s, 'remote');
                        const kernel = RemoteKernelSpecConnectionMetadata.create({
                            kernelSpec: s,
                            id: getKernelId(s, undefined, serverId),
                            baseUrl: connInfo.baseUrl,
                            serverId: serverId
                        });
                        return kernel;
                    })
                );
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
                        serverId
                    });
                    return kernel;
                });

                // Filter out excluded ids
                const filtered = mappedLive.filter((k) => !this.kernelIdsToHide.has(k.kernelModel.id || ''));
                const items = [...filtered, ...mappedSpecs];
                return items;
            } catch (ex) {
                traceError(`Error fetching remote kernels:`, ex);
                throw ex;
            } finally {
                if (sessionManager) {
                    await sessionManager.dispose();
                }
            }
        }
        return [];
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
            await Promise.all([
                removeOldCachedItems(this.globalState),
                this.globalState.update(key, { kernels: serialized, extensionVersion: this.env.extensionVersion })
            ]);

            if (added.length || updated.length || removed.length) {
                this._onDidChangeKernels.fire({ added, updated, removed });
            }
            traceVerbose(
                `Updating cache with Remote kernels ${values
                    .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                    .join(', ')}, Added = ${added
                    .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                    .join(', ')}, Updated = ${updated
                    .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                    .join(', ')}, Removed = ${removed
                    .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                    .join(', ')}`
            );
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
