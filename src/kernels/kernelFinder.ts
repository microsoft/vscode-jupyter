// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { isCancellationError } from '../platform/common/cancellation';
import { Telemetry } from '../platform/common/constants';
import { Resource } from '../platform/common/types';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { traceError, traceDecoratorVerbose, logValue, ignoreLogging } from '../platform/logging';
import { TraceOptions } from '../platform/logging/types';
import { PythonEnvironment } from '../platform/pythonEnvironments/info';
import { captureTelemetry, sendTelemetryEvent } from '../telemetry';
import { rankKernels, isExactMatch } from './helpers';
import { IContributedKernelFinder } from './internalTypes';
import { PreferredRemoteKernelIdProvider } from './jupyter/preferredRemoteKernelIdProvider';
import { IKernelFinder, isLocalConnection, KernelConnectionMetadata } from './types';

/**
 * Generic class for finding kernels (both remote and local). Handles all of the caching of the results.
 */
@injectable()
export class KernelFinder implements IKernelFinder {
    private startTimeForFetching?: StopWatch;
    private fetchingTelemetrySent = new Set<string>();
    private _finders: IContributedKernelFinder[] = [];

    constructor(
        @inject(PreferredRemoteKernelIdProvider) private readonly preferredRemoteFinder: PreferredRemoteKernelIdProvider
    ) {}

    public registerKernelFinder(finder: IContributedKernelFinder) {
        this._finders.push(finder);
    }

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
        cancelToken: CancellationToken | undefined,
        useCache: 'ignoreCache' | 'useCache' = 'ignoreCache'
    ): Promise<KernelConnectionMetadata[]> {
        this.startTimeForFetching = this.startTimeForFetching ?? new StopWatch();

        const kernels: KernelConnectionMetadata[] = [];

        for (const finder of this._finders) {
            const findKernels = await finder.listContributedKernels(resource, cancelToken, useCache).catch((ex) => {
                // Sometimes we can get errors from the socket level or jupyter, with the message 'Canceled', lets ignore those
                if (!isCancellationError(ex, true)) {
                    traceError(`Failed to get ${finder.kind} kernels`, ex);
                }
                return [];
            });
            this.finishListingKernels(findKernels, useCache, finder.kind as 'local' | 'remote');
            kernels.push(...findKernels);
        }

        return kernels;
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
}
