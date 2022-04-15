/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Memento } from 'vscode';
import { LocalKernelConnectionMetadata } from '../../../kernels/types';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { createPromiseFromCancellation } from '../../../platform/common/cancellation';
import { traceInfo, traceError, ignoreLogging, traceDecoratorError } from '../../../platform/logging';
import { IFileSystem } from '../../../platform/common/platform/types.node';
import { IMemento, GLOBAL_MEMENTO, Resource } from '../../../platform/common/types';
import { captureTelemetry } from '../../../telemetry';
import { Telemetry } from '../../../webviews/webview-side/common/constants';
import { ILocalKernelFinder } from '../types';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import { noop } from '../../../platform/common/utils/misc';
import { deserializePythonEnvironment, serializePythonEnvironment } from '../../../platform/api/pythonApi';
import { isArray } from '../../../platform/common/utils/sysTypes';

function serializeKernelConnection(kernelConnection: LocalKernelConnectionMetadata) {
    if (kernelConnection.interpreter) {
        return {
            ...kernelConnection,
            interpreter: serializePythonEnvironment(kernelConnection.interpreter)!
        };
    }
    return kernelConnection;
}

function deserializeKernelConnection(kernelConnection: any): LocalKernelConnectionMetadata {
    if (kernelConnection.interpreter) {
        return {
            ...kernelConnection,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            interpreter: deserializePythonEnvironment(kernelConnection.interpreter as any)!
        };
    }
    return kernelConnection;
}

const GlobalKernelSpecsCacheKey = 'JUPYTER_GLOBAL_KERNELSPECS_V2';
const LocalKernelSpecConnectionsCacheKey = 'LOCAL_KERNEL_SPEC_CONNECTIONS_CACHE_KEY_V2';
// This class searches for a kernel that matches the given kernel name.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class LocalKernelFinder implements ILocalKernelFinder {
    private lastFetchedKernelsWithoutCache: LocalKernelConnectionMetadata[] = [];
    constructor(
        @inject(LocalKnownPathKernelSpecFinder) private readonly nonPythonKernelFinder: LocalKnownPathKernelSpecFinder,
        @inject(LocalPythonAndRelatedNonPythonKernelSpecFinder)
        private readonly pythonKernelFinder: LocalPythonAndRelatedNonPythonKernelSpecFinder,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}
    /**
     * Search all our local file system locations for installed kernel specs and return them
     */
    @traceDecoratorError('List kernels failed')
    public async listKernels(
        resource: Resource,
        @ignoreLogging() cancelToken?: CancellationToken,
        useCache: 'useCache' | 'ignoreCache' = 'ignoreCache'
    ): Promise<LocalKernelConnectionMetadata[]> {
        const kernelsFromCachePromise =
            useCache === 'ignoreCache' ? Promise.resolve([]) : this.listValidKernelsFromGlobalCache(cancelToken);
        let kernelsRetrievedFromCache: boolean | undefined;
        const kernelsWithoutCachePromise = this.listKernelsWithoutCache(resource, cancelToken);
        let kernels: LocalKernelConnectionMetadata[] = [];
        if (useCache === 'ignoreCache') {
            kernels = await kernelsWithoutCachePromise;
        } else {
            let kernelsFromCache: LocalKernelConnectionMetadata[] | undefined;
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

        //
        kernels = this.filterKernels(kernels);
        // Do not update the cache if we got kernels from the cache.
        if (!kernelsRetrievedFromCache) {
            void this.cacheLocalKernelConnections(kernels);
        }
        return kernels;
    }

    @swallowExceptions('CacheLocalKernelConnections')
    private async cacheLocalKernelConnections(kernels: LocalKernelConnectionMetadata[]) {
        const items = this.getFromCache(LocalKernelSpecConnectionsCacheKey);
        const uniqueItems = new Map<string, LocalKernelConnectionMetadata>();
        items.forEach((item) => uniqueItems.set(item.id, item));
        kernels.forEach((item) => uniqueItems.set(item.id, item));
        await this.updateCache(LocalKernelSpecConnectionsCacheKey, Array.from(uniqueItems.values()));
    }
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'local' })
    private async listKernelsWithoutCache(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata[]> {
        let [nonPythonKernelSpecs, pythonRelatedKernelSpecs] = await Promise.all([
            this.nonPythonKernelFinder.listKernelSpecs(false, cancelToken),
            this.pythonKernelFinder.listKernelSpecs(resource, true, cancelToken)
        ]);

        const kernels = this.filterKernels(nonPythonKernelSpecs.concat(pythonRelatedKernelSpecs));
        this.lastFetchedKernelsWithoutCache = kernels;
        this.updateCache(GlobalKernelSpecsCacheKey, kernels).then(noop, (ex) => {
            console.error('Failed to update global kernel cache', ex);
        });
        return kernels;
    }

    private getFromCache(cacheKey: string): LocalKernelConnectionMetadata[] {
        const values = this.globalState.get<LocalKernelConnectionMetadata[]>(cacheKey, []);
        if (values && isArray(values)) {
            return values.map(deserializeKernelConnection);
        }
        return [];
    }

    private async updateCache(cacheKey: string, values: LocalKernelConnectionMetadata[]) {
        const serialized = values.map(serializeKernelConnection);
        return this.globalState.update(cacheKey, serialized);
    }

    private async listValidKernelsFromGlobalCache(
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata[]> {
        const values = this.lastFetchedKernelsWithoutCache.length
            ? this.lastFetchedKernelsWithoutCache
            : this.getFromCache(GlobalKernelSpecsCacheKey);
        const validValues: LocalKernelConnectionMetadata[] = [];
        const promise = Promise.all(
            values.map(async (item) => {
                let somethingIsInvalid = false;
                const promises: Promise<void>[] = [];
                if (item.interpreter?.uri && item.interpreter?.uri.fsPath) {
                    // Possible the interpreter no longer exists, in such cases, exclude this cached kernel from the list.
                    promises.push(
                        this.fs
                            .localFileExists(item.interpreter.uri.fsPath)
                            .then((exists) => {
                                if (!exists) {
                                    somethingIsInvalid = true;
                                }
                            })
                            .catch(noop)
                    );
                }
                if (item.kind === 'startUsingLocalKernelSpec' && item.kernelSpec?.specFile) {
                    // Possible the kernelspec file no longer exists, in such cases, exclude this cached kernel from the list.
                    promises.push(
                        this.fs
                            .localFileExists(item.kernelSpec.specFile)
                            .then((exists) => {
                                if (!exists) {
                                    somethingIsInvalid = true;
                                }
                            })
                            .catch(noop)
                    );
                }
                await Promise.all(promises);
                if (!somethingIsInvalid) {
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
    private filterKernels(kernels: LocalKernelConnectionMetadata[]) {
        return kernels.filter(({ kernelSpec }) => {
            if (!kernelSpec) {
                return true;
            }
            // Disable xeus python for now.
            if (kernelSpec.argv[0].toLowerCase().endsWith('xpython')) {
                traceInfo(`Hiding xeus kernelspec`);
                return false;
            }

            return true;
        });
    }
}
