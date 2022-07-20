// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type * as nbformat from '@jupyterlab/nbformat';
import { CancellationToken, Memento } from 'vscode';
import { createPromiseFromCancellation, isCancellationError } from '../platform/common/cancellation';
import { Telemetry } from '../platform/common/constants';
import { Resource } from '../platform/common/types';
import { createDeferredFromPromise } from '../platform/common/utils/async';
import { noop } from '../platform/common/utils/misc';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { isArray } from '../platform/common/utils/sysTypes';
import {
    traceError,
    traceDecoratorVerbose,
    traceWarning,
    traceVerbose,
    logValue,
    ignoreLogging
} from '../platform/logging';
import { TraceOptions } from '../platform/logging/types';
import { PythonEnvironment } from '../platform/pythonEnvironments/info';
import { captureTelemetry, sendTelemetryEvent } from '../telemetry';
import { DisplayOptions } from './displayOptions';
import { rankKernels, deserializeKernelConnection, serializeKernelConnection, isExactMatch } from './helpers';
import { IJupyterServerUriStorage, IServerConnectionType } from './jupyter/types';
import { PreferredRemoteKernelIdProvider } from './jupyter/preferredRemoteKernelIdProvider';
import { ILocalKernelFinder, IRemoteKernelFinder } from './raw/types';
import {
    IKernelFinder,
    INotebookProvider,
    INotebookProviderConnection,
    isLocalConnection,
    KernelConnectionMetadata
} from './types';
import { IApplicationEnvironment } from '../platform/common/application/types';

// Two cache keys so we can get local and remote separately (exported for tests)
export const LocalKernelSpecsCacheKey = 'JUPYTER_LOCAL_KERNELSPECS_V4';
export const RemoteKernelSpecsCacheKey = 'JUPYTER_REMOTE_KERNELSPECS_V4';

/**
 * Generic class for finding kernels (both remote and local). Handles all of the caching of the results.
 */
export abstract class BaseKernelFinder implements IKernelFinder {
    private startTimeForFetching?: StopWatch;
    private fetchingTelemetrySent = new Set<string>();
    private cache = new Map<'local' | 'remote', KernelConnectionMetadata[]>();

    constructor(
        private readonly preferredRemoteFinder: PreferredRemoteKernelIdProvider,
        private readonly notebookProvider: INotebookProvider,
        private readonly localKernelFinder: ILocalKernelFinder | undefined,
        private readonly remoteKernelFinder: IRemoteKernelFinder | undefined,
        private readonly globalState: Memento,
        protected readonly serverUriStorage: IJupyterServerUriStorage,
        protected readonly serverConnectionType: IServerConnectionType,
        private readonly env: IApplicationEnvironment
    ) {}

    @traceDecoratorVerbose('Rank Kernels', TraceOptions.BeforeCall | TraceOptions.Arguments)
    @captureTelemetry(Telemetry.RankKernelsPerf)
    public async rankKernels(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
        @logValue<PythonEnvironment>('uri') preferredInterpreter?: PythonEnvironment,
        @ignoreLogging() cancelToken?: CancellationToken,
        useCache?: 'useCache' | 'ignoreCache',
        serverId?: string
    ): Promise<KernelConnectionMetadata[] | undefined> {
        try {
            // Get list of all of the specs from the cache and without the cache (note, cached items will be validated before being returned)
            let kernels = await this.listKernels(resource, cancelToken, useCache);
            if (serverId) {
                kernels = kernels.filter((kernel) => !isLocalConnection(kernel) && kernel.serverId === serverId);
            }
            const preferredRemoteKernelId =
                resource &&
                this.preferredRemoteFinder &&
                this.preferredRemoteFinder.getPreferredRemoteKernelId(resource);

            let rankedKernels = rankKernels(
                kernels,
                resource,
                notebookMetadata,
                preferredInterpreter,
                preferredRemoteKernelId
            );

            return rankedKernels;
        } catch (ex) {
            traceError(`RankKernels crashed`, ex);
            return undefined;
        }
    }

    public async listKernels(
        resource: Resource,
        cancelToken?: CancellationToken,
        useCache?: 'ignoreCache' | 'useCache'
    ): Promise<KernelConnectionMetadata[]> {
        this.startTimeForFetching = this.startTimeForFetching ?? new StopWatch();

        // Get both local and remote kernels.
        const [localKernels, remoteKernels] = await Promise.all([
            this.listLocalKernels(resource, cancelToken, useCache).catch((ex) => {
                // Sometimes we can get errors from the socket level or jupyter, with the message 'Canceled', lets ignore those
                if (!isCancellationError(ex, true)) {
                    traceError('Failed to get local kernels', ex);
                }
                return [];
            }),
            this.listRemoteKernels(resource, cancelToken, useCache).catch((ex) => {
                // Sometimes we can get errors from the socket level or jupyter, with the message 'Canceled', lets ignore those
                if (!isCancellationError(ex, true)) {
                    traceError('Failed to get remote kernels', ex);
                }
                return [];
            })
        ]);

        traceVerbose(`KernelFinder discovered ${localKernels.length} local and ${remoteKernels.length} remote kernels`);
        // Combine the results from local and remote
        return [...localKernels, ...remoteKernels];
    }

    public isExactMatch(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        notebookMetadata: nbformat.INotebookMetadata | undefined
    ): boolean {
        const preferredRemoteKernelId =
            resource && this.preferredRemoteFinder && this.preferredRemoteFinder.getPreferredRemoteKernelId(resource);

        return isExactMatch(kernelConnection, notebookMetadata, preferredRemoteKernelId);
    }

    // Validating if a kernel is still allowed or not (from the cache). Non cached are always assumed to be valid
    protected abstract isValidCachedKernel(kernel: KernelConnectionMetadata): Promise<boolean>;

    private async listLocalKernels(
        resource: Resource,
        cancelToken?: CancellationToken,
        useCache: 'ignoreCache' | 'useCache' = 'ignoreCache'
    ): Promise<KernelConnectionMetadata[]> {
        return this.listKernelsUsingFinder(
            () =>
                this.localKernelFinder
                    ? this.localKernelFinder.listKernels(resource, cancelToken)
                    : Promise.resolve([]),
            cancelToken,
            'local',
            useCache
        ).then((l) => this.finishListingKernels(l, useCache, 'local'));
    }

    private async listRemoteKernels(
        resource: Resource,
        cancelToken?: CancellationToken,
        useCache: 'ignoreCache' | 'useCache' = 'ignoreCache'
    ): Promise<KernelConnectionMetadata[]> {
        if (this.serverConnectionType.isLocalLaunch) {
            return [];
        }

        // If there are any errors in fetching the remote kernel specs without cache,
        // then fall back to the cache.
        // I.e. the cache will always be used if we can't fetch the remote kernel specs.
        return this.listKernelsUsingFinder(
            async () => {
                const connInfo = await this.getRemoteConnectionInfo(cancelToken);
                return this.remoteKernelFinder && connInfo
                    ? this.remoteKernelFinder.listKernels(resource, connInfo, cancelToken)
                    : Promise.resolve([]);
            },
            cancelToken,
            'remote',
            useCache
        ).then((l) => this.finishListingKernels(l, useCache, 'remote'));
    }

    private async listKernelsUsingFinder(
        finder: () => Promise<KernelConnectionMetadata[]>,
        cancelToken: CancellationToken | undefined,
        kind: 'local' | 'remote',
        useCache: 'ignoreCache' | 'useCache'
    ) {
        const kernelsFromCachePromise =
            useCache === 'ignoreCache' ? Promise.resolve([]) : this.getFromCache(kind, cancelToken);
        let updateCache = true;
        const kernelsWithoutCachePromise = finder();
        let kernels: KernelConnectionMetadata[] = [];
        if (useCache === 'ignoreCache') {
            try {
                kernels = await kernelsWithoutCachePromise;
            } catch (ex) {
                traceWarning(`Could not fetch kernels from the ${kind} server, falling back to cache: ${ex}`);
                // Since fetching the remote kernels failed, we fall back to the cache,
                // at this point no need to display all of the kernel specs,
                // Its possible the connection is dead, just display the live kernels we had.
                // I.e. if user had a notebook connected to a remote kernel, then just display that live kernel.
                kernels = await this.getFromCache(kind, cancelToken);
                kernels = kernels.filter((item) => item.kind === 'connectToLiveRemoteKernel');
                updateCache = false;
            }
        } else {
            let kernelsFromCache: KernelConnectionMetadata[] | undefined;
            kernelsFromCachePromise
                .then((items) => {
                    kernelsFromCache = items;
                    updateCache = false;
                })
                .catch(noop);

            try {
                const kernelsWithoutCacheDeferred = createDeferredFromPromise(kernelsWithoutCachePromise);
                try {
                    await Promise.race([kernelsFromCachePromise, kernelsWithoutCacheDeferred.promise]);
                } catch (ex) {
                    // If we failed to get without cache, then await on the cache promise as a fallback.
                    if (kernelsWithoutCacheDeferred.rejected) {
                        await kernelsFromCachePromise;
                    } else {
                        throw ex;
                    }
                }
                // If we finish the cache first, and we don't have any items, in the cache, then load without cache.
                if (Array.isArray(kernelsFromCache) && kernelsFromCache.length > 0) {
                    kernels = kernelsFromCache;
                } else {
                    kernels = await kernelsWithoutCachePromise;
                    updateCache = true;
                }
            } catch (ex) {
                traceError(`Exception loading kernels: ${ex}`);
            }
        }

        // Do not update the cache if we got kernels from the cache.
        if (updateCache) {
            await this.writeToCache(kind, kernels);
        }
        return kernels;
    }

    private finishListingKernels(
        list: KernelConnectionMetadata[],
        useCache: 'ignoreCache' | 'useCache',
        kind: 'local' | 'remote'
    ) {
        // Send the telemetry once for each type of search
        const key = `${kind}:${useCache}`;
        if (this.startTimeForFetching && !this.fetchingTelemetrySent.has(key)) {
            this.fetchingTelemetrySent.add(key);
            sendTelemetryEvent(Telemetry.FetchControllers, this.startTimeForFetching.elapsedTime, {
                cached: useCache === 'useCache',
                kind
            });
        }

        // Just return the list
        return list;
    }

    private async getRemoteConnectionInfo(
        cancelToken?: CancellationToken
    ): Promise<INotebookProviderConnection | undefined> {
        const ui = new DisplayOptions(false);
        const uri = await this.serverUriStorage.getRemoteUri();
        if (!uri) {
            return;
        }
        return this.notebookProvider.connect({
            resource: undefined,
            ui,
            localJupyter: false,
            token: cancelToken,
            serverId: this.serverUriStorage.currentServerId!
        });
    }

    protected async getFromCache(
        kind: 'local' | 'remote',
        cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata[]> {
        let results: KernelConnectionMetadata[] = this.cache.get(kind) || [];
        const key = this.getCacheKey(kind);

        // If not in memory, check memento
        if (!results || results.length === 0) {
            // Check memento too
            const values = this.globalState.get<{ kernels: KernelConnectionMetadata[]; extensionVersion: string }>(
                key,
                { kernels: [], extensionVersion: '' }
            );

            /**
             * The cached list of raw kernels is pointing to kernelSpec.json files in the extensions directory.
             * Assume you have version 1 of extension installed.
             * Now you update to version 2, at this point the cache still points to version 1 and the kernelSpec.json files are in the directory version 1.
             * Those files in directory for version 1 could get deleted by VS Code at any point in time, as thats an old version of the extension and user has now installed version 2.
             * Hence its wrong and buggy to use those files.
             * To ensure we don't run into weird issues with the use of cached kernelSpec.json files, we ensure the cache is tied to each version of the extension.
             */
            if (values && isArray(values.kernels) && values.extensionVersion === this.env.extensionVersion) {
                results = values.kernels.map(deserializeKernelConnection);
                this.cache.set(kind, results);
            }
        }

        // Validate
        const validValues: KernelConnectionMetadata[] = [];
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
                createPromiseFromCancellation({ token: cancelToken, cancelAction: 'resolve', defaultValue: undefined })
            ]);
        } else {
            await promise;
        }
        return validValues;
    }

    protected async writeToCache(kind: 'local' | 'remote', values: KernelConnectionMetadata[]) {
        const key = this.getCacheKey(kind);
        this.cache.set(kind, values);
        const serialized = values.map(serializeKernelConnection);
        await Promise.all([
            this.removeOldCachedItems(),
            ,
            this.globalState.update(key, { kernels: serialized, extensionVersion: this.env.extensionVersion })
        ]);
    }
    /**
     * The old cached items can be quite large and we should clear them if we no longer need them.
     */
    private async removeOldCachedItems(): Promise<void> {
        await Promise.all(
            [
                'JUPYTER_LOCAL_KERNELSPECS',
                'JUPYTER_LOCAL_KERNELSPECS_V1',
                'JUPYTER_LOCAL_KERNELSPECS_V2',
                'JUPYTER_LOCAL_KERNELSPECS_V3',
                'JUPYTER_REMOTE_KERNELSPECS',
                'JUPYTER_REMOTE_KERNELSPECS_V1',
                'JUPYTER_REMOTE_KERNELSPECS_V2',
                'JUPYTER_REMOTE_KERNELSPECS_V3'
            ]
                .filter((key) => LocalKernelSpecsCacheKey !== key && RemoteKernelSpecsCacheKey !== key) // Exclude latest cache key
                .filter((key) => this.globalState.get(key, undefined) !== undefined)
                .map((key) => this.globalState.update(key, undefined).then(noop, noop))
        );
    }
    private getCacheKey(kind: 'local' | 'remote') {
        return kind === 'local' ? LocalKernelSpecsCacheKey : RemoteKernelSpecsCacheKey;
    }
}
