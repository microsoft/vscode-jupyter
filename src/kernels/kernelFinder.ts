// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { Telemetry } from '../platform/common/constants';
import { Resource } from '../platform/common/types';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { sendTelemetryEvent } from '../telemetry';
import { IContributedKernelFinder } from './internalTypes';
import { IKernelFinder, KernelConnectionMetadata } from './types';

/**
 * Generic class for finding kernels (both remote and local). Handles all of the caching of the results.
 */
@injectable()
export class KernelFinder implements IKernelFinder {
    private startTimeForFetching?: StopWatch;
    private fetchingTelemetrySent = new Set<string>();
    private _finders: IContributedKernelFinder[] = [];

    public registerKernelFinder(finder: IContributedKernelFinder) {
        this._finders.push(finder);
    }

    public async listKernels(
        resource: Resource,
        cancelToken: CancellationToken | undefined,
        useCache: 'ignoreCache' | 'useCache' = 'ignoreCache'
    ): Promise<KernelConnectionMetadata[]> {
        this.startTimeForFetching = this.startTimeForFetching ?? new StopWatch();

        const kernels: KernelConnectionMetadata[] = [];

        const allKernels = await Promise.all(
            this._finders.map((finder) => {
                return finder.listContributedKernels(resource, cancelToken, useCache).then((kernels) => {
                    this.finishListingKernels(kernels, useCache, finder.kind as 'local' | 'remote');
                    return kernels;
                });
            })
        );

        allKernels.forEach((kernelList) => {
            kernels.push(...kernelList);
        });

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
}
