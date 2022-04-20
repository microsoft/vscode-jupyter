// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type * as nbformat from '@jupyterlab/nbformat';
import { CancellationToken, Memento } from 'vscode';
import { isPythonNotebook } from '../notebooks/helpers';
import { IPythonExtensionChecker } from '../platform/api/types';
import { createPromiseFromCancellation } from '../platform/common/cancellation';
import { PYTHON_LANGUAGE, Settings, Telemetry } from '../platform/common/constants';
import { IConfigurationService, Resource } from '../platform/common/types';
import { getResourceType } from '../platform/common/utils';
import { noop } from '../platform/common/utils/misc';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { isArray } from '../platform/common/utils/sysTypes';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { traceInfo, traceError, traceDecoratorVerbose } from '../platform/logging';
import { TraceOptions } from '../platform/logging/types';
import { captureTelemetry, sendTelemetryEvent } from '../telemetry';
import { getTelemetrySafeLanguage } from '../telemetry/helpers';
import { DisplayOptions } from './displayOptions';
import {
    getLanguageInNotebookMetadata,
    findPreferredKernel,
    getDisplayNameOrNameOfKernelConnection,
    isLocalLaunch,
    deserializeKernelConnection,
    serializeKernelConnection
} from './helpers';
import { IJupyterServerUriStorage } from './jupyter/types';
import { PreferredRemoteKernelIdProvider } from './raw/finder/preferredRemoteKernelIdProvider';
import { ILocalKernelFinder, IRemoteKernelFinder } from './raw/types';
import { IKernelFinder, INotebookProvider, INotebookProviderConnection, KernelConnectionMetadata } from './types';

// Two cache keys so we can get local and remote separately (exported for tests)
export const LocalKernelSpecsCacheKey = 'JUPYTER_LOCAL_KERNELSPECS_V3';
export const RemoteKernelSpecsCacheKey = 'JUPYTER_REMOTE_KERNELSPECS_V3';

export abstract class BaseKernelFinder implements IKernelFinder {
    private startTimeForFetching?: StopWatch;
    private fetchingTelemetrySent = new Set<string>();
    private cache = new Map<'local' | 'remote', KernelConnectionMetadata[]>();

    constructor(
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly interpreterService: IInterpreterService,
        private readonly configurationService: IConfigurationService,
        private readonly preferredRemoteFinder: PreferredRemoteKernelIdProvider,
        private readonly notebookProvider: INotebookProvider,
        private readonly localKernelFinder: ILocalKernelFinder | undefined,
        private readonly remoteKernelFinder: IRemoteKernelFinder | undefined,
        private readonly globalState: Memento,
        protected readonly serverUriStorage: IJupyterServerUriStorage
    ) {}

    // Finding a kernel is the same no matter what the source
    @traceDecoratorVerbose('Find kernel spec', TraceOptions.BeforeCall | TraceOptions.Arguments)
    @captureTelemetry(Telemetry.KernelFinderPerf)
    public async findKernel(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
        cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined> {
        const resourceType = getResourceType(resource);
        const telemetrySafeLanguage =
            resourceType === 'interactive'
                ? PYTHON_LANGUAGE
                : getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata) || '');
        try {
            // Get list of all of the specs from the cache and without the cache (note, cached items will be validated before being returned)
            const cached = await this.listKernels(resource, cancelToken, 'useCache');
            const nonCachedPromise = this.listKernels(resource, cancelToken, 'ignoreCache');

            const isPythonNbOrInteractiveWindow = isPythonNotebook(notebookMetadata) || resourceType === 'interactive';
            // Always include the interpreter in the search if we can
            const preferredInterpreter =
                isPythonNbOrInteractiveWindow && this.extensionChecker.isPythonExtensionInstalled
                    ? await this.interpreterService.getActiveInterpreter(resource)
                    : undefined;

            // Find the preferred kernel index from the list.
            let preferred = findPreferredKernel(
                cached,
                resource,
                notebookMetadata,
                preferredInterpreter,
                this.preferredRemoteFinder
            );

            // If still not found, try the nonCached list
            if (!preferred) {
                preferred = findPreferredKernel(
                    await nonCachedPromise,
                    resource,
                    notebookMetadata,
                    preferredInterpreter,
                    this.preferredRemoteFinder
                );
            }
            sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
                result: preferred ? 'found' : 'notfound',
                resourceType,
                language: telemetrySafeLanguage,
                hasActiveInterpreter: !!preferredInterpreter
            });
            if (preferred) {
                traceInfo(`findKernel found ${getDisplayNameOrNameOfKernelConnection(preferred)}`);
                return preferred;
            }
        } catch (ex) {
            sendTelemetryEvent(
                Telemetry.PreferredKernel,
                undefined,
                {
                    result: 'failed',
                    resourceType,
                    language: telemetrySafeLanguage
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ex as any,
                true
            );
            traceError(`findKernel crashed`, ex);
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
                traceError('Failed to get local kernels', ex);
                return [];
            }),
            this.listRemoteKernels(resource, cancelToken, useCache).catch((ex) => {
                traceError('Failed to get remote kernels', ex);
                // When remote kernels fail, turn off remote
                void this.serverUriStorage.setUri(Settings.JupyterServerLocalLaunch);
                return [];
            })
        ]);

        // Combine the results from local and remote
        return [...localKernels, ...remoteKernels];
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
        let connInfo = isLocalLaunch(this.configurationService) ? undefined : await this.getConnectionInfo(cancelToken);

        return this.listKernelsUsingFinder(
            () =>
                this.remoteKernelFinder
                    ? this.remoteKernelFinder.listKernels(resource, connInfo, cancelToken)
                    : Promise.resolve([]),
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
        let kernelsRetrievedFromCache: boolean | undefined;
        const kernelsWithoutCachePromise = finder();
        let kernels: KernelConnectionMetadata[] = [];
        if (useCache === 'ignoreCache') {
            kernels = await kernelsWithoutCachePromise;
        } else {
            let kernelsFromCache: KernelConnectionMetadata[] | undefined;
            kernelsFromCachePromise
                .then((items) => {
                    kernelsFromCache = items;
                    kernelsRetrievedFromCache = true;
                })
                .catch(noop);

            try {
                await Promise.race([kernelsFromCachePromise, kernelsWithoutCachePromise]);
                // If we finish the cache first, and we don't have any items, in the cache, then load without cache.
                if (Array.isArray(kernelsFromCache) && kernelsFromCache.length > 0) {
                    kernels = kernelsFromCache;
                } else {
                    kernels = await kernelsWithoutCachePromise;
                }
            } catch (ex) {
                traceError(`Exception loading kernels: ${ex}`);
            }
        }

        // Do not update the cache if we got kernels from the cache.
        if (!kernelsRetrievedFromCache) {
            void this.writeToCache(kind, kernels);
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

    private async getConnectionInfo(cancelToken?: CancellationToken): Promise<INotebookProviderConnection | undefined> {
        const ui = new DisplayOptions(false);
        return this.notebookProvider.connect({
            resource: undefined,
            ui,
            kind: 'remoteJupyter',
            token: cancelToken
        });
    }

    protected async getFromCache(
        kind: 'local' | 'remote',
        cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata[]> {
        let results: KernelConnectionMetadata[] = this.cache.get(kind) || [];
        const key = kind === 'local' ? LocalKernelSpecsCacheKey : RemoteKernelSpecsCacheKey;

        // If not in memory, check memento
        if (!results || results.length === 0) {
            // Check memento too
            const values = this.globalState.get<KernelConnectionMetadata[]>(key, []);
            if (values && isArray(values)) {
                results = values.map(deserializeKernelConnection);
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
        const key = kind === 'local' ? LocalKernelSpecsCacheKey : RemoteKernelSpecsCacheKey;
        this.cache.set(kind, values);
        const serialized = values.map(serializeKernelConnection);
        return this.globalState.update(key, serialized);
    }
}
