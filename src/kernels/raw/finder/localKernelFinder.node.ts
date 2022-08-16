// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Memento, Uri } from 'vscode';
import { IKernelFinder, KernelConnectionMetadata, LocalKernelConnectionMetadata } from '../../../kernels/types';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import {
    traceInfo,
    ignoreLogging,
    traceDecoratorError,
    traceError,
    traceVerbose,
    traceWarning
} from '../../../platform/logging';
import { GLOBAL_MEMENTO, IMemento, Resource } from '../../../platform/common/types';
import { captureTelemetry, Telemetry } from '../../../telemetry';
import { ILocalKernelFinder } from '../types';
import { createPromiseFromCancellation, isCancellationError } from '../../../platform/common/cancellation';
import { isArray } from '../../../platform/common/utils/sysTypes';
import { deserializeKernelConnection, serializeKernelConnection } from '../../helpers';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { createDeferredFromPromise } from '../../../platform/common/utils/async';
import { noop } from '../../../platform/common/utils/misc';
import { IFileSystem } from '../../../platform/common/platform/types';
import { KernelFinder } from '../../kernelFinder';
import { LocalKernelSpecsCacheKey, removeOldCachedItems } from '../../common/commonFinder';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';

// This class searches for local kernels.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class LocalKernelFinder implements ILocalKernelFinder, IExtensionSingleActivationService {
    private cache: LocalKernelConnectionMetadata[] = [];
    kind: string = 'local';

    constructor(
        @inject(LocalKnownPathKernelSpecFinder) private readonly nonPythonKernelFinder: LocalKnownPathKernelSpecFinder,
        @inject(LocalPythonAndRelatedNonPythonKernelSpecFinder)
        private readonly pythonKernelFinder: LocalPythonAndRelatedNonPythonKernelSpecFinder,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(IKernelFinder) kernelFinder: KernelFinder
    ) {
        kernelFinder.registerKernelFinder(this);
    }

    async activate(): Promise<void> {
        noop();
    }

    async listContributedKernels(
        resource: Resource,
        cancelToken: CancellationToken | undefined,
        useCache: 'ignoreCache' | 'useCache'
    ): Promise<KernelConnectionMetadata[]> {
        const kernels: KernelConnectionMetadata[] = await this.listKernelsImpl(resource, cancelToken, useCache).catch(
            (ex) => {
                // Sometimes we can get errors from the socket level or jupyter, with the message 'Canceled', lets ignore those
                if (!isCancellationError(ex, true)) {
                    traceError('Failed to get local kernels', ex);
                }
                return [];
            }
        );
        traceVerbose(`KernelFinder discovered ${kernels.length} local`);

        return kernels;
    }

    private async listKernelsImpl(
        resource: Resource,
        cancelToken: CancellationToken | undefined,
        useCache: 'ignoreCache' | 'useCache'
    ) {
        const kernelsFromCachePromise =
            useCache === 'ignoreCache' ? Promise.resolve([]) : this.getFromCache(cancelToken);
        let updateCache = true;
        const kernelsWithoutCachePromise: Promise<LocalKernelConnectionMetadata[]> = this.listKernels(
            resource,
            cancelToken
        );
        let kernels: LocalKernelConnectionMetadata[] = [];
        if (useCache === 'ignoreCache') {
            try {
                kernels = await kernelsWithoutCachePromise;
            } catch (ex) {
                traceWarning(`Could not fetch kernels from the ${this.kind}`);
                kernels = [];
                updateCache = false;
            }
        } else {
            let kernelsFromCache: LocalKernelConnectionMetadata[] | undefined;
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
            await this.writeToCache(kernels);
        }
        return kernels;
    }

    private async getFromCache(cancelToken?: CancellationToken): Promise<LocalKernelConnectionMetadata[]> {
        let results: LocalKernelConnectionMetadata[] = this.cache;

        // If not in memory, check memento
        if (!results || results.length === 0) {
            // Check memento too
            const values = this.globalState.get<{ kernels: LocalKernelConnectionMetadata[]; extensionVersion: string }>(
                this.getCacheKey(),
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
                results = values.kernels.map(deserializeKernelConnection) as LocalKernelConnectionMetadata[];
                this.cache = results;
            }
        }

        // Validate
        const validValues: LocalKernelConnectionMetadata[] = [];
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

    /**
     * Search all our local file system locations for installed kernel specs and return them
     */
    @traceDecoratorError('List kernels failed')
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'local' })
    public async listKernels(
        resource: Resource,
        @ignoreLogging() cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata[]> {
        let [nonPythonKernelSpecs, pythonRelatedKernelSpecs] = await Promise.all([
            this.nonPythonKernelFinder.listKernelSpecs(false, cancelToken),
            this.pythonKernelFinder.listKernelSpecs(resource, true, cancelToken)
        ]);

        return this.filterKernels(nonPythonKernelSpecs.concat(pythonRelatedKernelSpecs));
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

    private async writeToCache(values: LocalKernelConnectionMetadata[]) {
        this.cache = values;
        const serialized = values.map(serializeKernelConnection);
        await Promise.all([
            removeOldCachedItems(this.globalState),
            this.globalState.update(this.getCacheKey(), {
                kernels: serialized,
                extensionVersion: this.env.extensionVersion
            })
        ]);
    }

    private getCacheKey() {
        return LocalKernelSpecsCacheKey;
    }

    private async isValidCachedKernel(kernel: LocalKernelConnectionMetadata): Promise<boolean> {
        switch (kernel.kind) {
            case 'startUsingPythonInterpreter':
                // Interpreters have to still exist
                return this.fs.exists(kernel.interpreter.uri);

            case 'startUsingLocalKernelSpec':
                // Spec files have to still exist and interpreters have to exist
                const promiseSpec = kernel.kernelSpec.specFile
                    ? this.fs.exists(Uri.file(kernel.kernelSpec.specFile))
                    : Promise.resolve(true);
                return promiseSpec.then((r) => {
                    return r && kernel.interpreter ? this.fs.exists(kernel.interpreter.uri) : Promise.resolve(true);
                });
        }
    }
}
