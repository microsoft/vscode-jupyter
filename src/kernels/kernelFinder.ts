// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, Event, EventEmitter } from 'vscode';
import { IDisposableRegistry, Resource } from '../platform/common/types';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { traceInfoIfCI } from '../platform/logging';
import { IContributedKernelFinder } from './internalTypes';
import { IKernelFinder, KernelConnectionMetadata } from './types';

/**
 * Generic class for finding kernels (both remote and local). Handles all of the caching of the results.
 */
@injectable()
export class KernelFinder implements IKernelFinder {
    private startTimeForFetching?: StopWatch;
    private _finders: IContributedKernelFinder[] = [];

    private _onDidChangeKernels = new EventEmitter<void>();
    onDidChangeKernels: Event<void> = this._onDidChangeKernels.event;

    constructor(@inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry) {}

    public registerKernelFinder(finder: IContributedKernelFinder) {
        this._finders.push(finder);
        this.disposables.push(finder.onDidChangeKernels(() => this._onDidChangeKernels.fire()));
    }

    public async listKernels(
        resource: Resource,
        cancelToken: CancellationToken | undefined
    ): Promise<KernelConnectionMetadata[]> {
        this.startTimeForFetching = this.startTimeForFetching ?? new StopWatch();

        // Wait all finders to warm up their cache first
        await Promise.all(this._finders.map((finder) => finder.initialized));

        if (cancelToken?.isCancellationRequested) {
            return [];
        }

        const kernels: KernelConnectionMetadata[] = [];

        for (const finder of this._finders) {
            const contributedKernels = finder.listContributedKernels(resource);
            kernels.push(...contributedKernels);
        }

        traceInfoIfCI(
            `list kernel specs ${kernels.length}: ${kernels
                .map((i) => `${i.id}, ${i.kind}, ${i.interpreter?.uri}`)
                .join('\n')}`
        );

        return kernels;
    }
}
