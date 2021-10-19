// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable, named } from 'inversify';
import { CancellationToken, Memento } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceDecorators, traceError, traceInfo } from '../../common/logger';
import { GLOBAL_MEMENTO, IExtensions, IMemento, Resource } from '../../common/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import {
    findPreferredKernel,
    getDisplayNameOrNameOfKernelConnection,
    getLanguageInNotebookMetadata
} from '../jupyter/kernels/helpers';
import { LocalKernelConnectionMetadata } from '../jupyter/kernels/types';
import { ILocalKernelFinder } from './types';
import { getResourceType } from '../common';
import { isPythonNotebook } from '../notebook/helpers/helpers';
import { getTelemetrySafeLanguage } from '../../telemetry/helpers';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder';
import { JupyterPaths } from './jupyterPaths';
import { IFileSystem } from '../../common/platform/types';
import { noop } from '../../common/utils/misc';
import { createPromiseFromCancellation } from '../../common/cancellation';

const GlobalKernelSpecsCacheKey = 'JUPYTER_GLOBAL_KERNELSPECS';
// This class searches for a kernel that matches the given kernel name.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class LocalKernelFinder implements ILocalKernelFinder {
    private lastFetchedKernelsWithoutCache: LocalKernelConnectionMetadata[] = [];
    constructor(
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(LocalKnownPathKernelSpecFinder) private readonly nonPythonkernelFinder: LocalKnownPathKernelSpecFinder,
        @inject(LocalPythonAndRelatedNonPythonKernelSpecFinder)
        private readonly pythonKernelFinder: LocalPythonAndRelatedNonPythonKernelSpecFinder,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}
    @traceDecorators.verbose('Find kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    public async findKernel(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata | undefined> {
        const resourceType = getResourceType(resource);
        const telemetrySafeLanguage =
            resourceType === 'interactive'
                ? PYTHON_LANGUAGE
                : getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata) || '');
        try {
            // Get list of all of the specs
            const kernels = await this.listKernels(resource, cancelToken, 'useCache');
            const isPythonNbOrInteractiveWindow = isPythonNotebook(notebookMetadata) || resourceType === 'interactive';
            // Always include the interpreter in the search if we can
            const preferredInterpreter =
                isPythonNbOrInteractiveWindow && this.extensionChecker.isPythonExtensionInstalled
                    ? await this.interpreterService.getActiveInterpreter(resource)
                    : undefined;

            // Find the preferred kernel index from the list.
            const preferred = findPreferredKernel(
                kernels,
                resource,
                [],
                notebookMetadata,
                preferredInterpreter,
                undefined
            );
            sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
                result: preferred ? 'found' : 'notfound',
                resourceType,
                language: telemetrySafeLanguage,
                hasActiveInterpreter: !!preferredInterpreter
            });
            if (preferred) {
                traceInfo(`findKernel found ${getDisplayNameOrNameOfKernelConnection(preferred)}`);
                return preferred as LocalKernelConnectionMetadata;
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

    public async listNonPythonKernels(cancelToken?: CancellationToken): Promise<LocalKernelConnectionMetadata[]> {
        return this.filterKernels(await this.nonPythonkernelFinder.listKernelSpecs(false, cancelToken));
    }

    /**
     * Search all our local file system locations for installed kernel specs and return them
     */
    @traceDecorators.error('List kernels failed')
    public async listKernels(
        resource: Resource,
        cancelToken?: CancellationToken,
        useCache: 'useCache' | 'ignoreCache' = 'ignoreCache'
    ): Promise<LocalKernelConnectionMetadata[]> {
        const kernelsFromCachePromise =
            useCache === 'ignoreCache' ? Promise.resolve([]) : this.listValidKernelsFromGlobalCache(cancelToken);
        const kernelsWithoutCachePromise = this.listKernelsWithoutCache(resource, cancelToken);
        let kernels: LocalKernelConnectionMetadata[] = [];
        if (useCache === 'ignoreCache') {
            kernels = await kernelsWithoutCachePromise;
        } else {
            let kernelsFromCache: LocalKernelConnectionMetadata[] | undefined;
            kernelsFromCachePromise.then((items) => (kernelsFromCache = items)).catch(noop);
            await Promise.race([kernelsFromCachePromise, kernelsWithoutCachePromise]);
            // If we finish the cache first, and we don't have any items, in the cache, then load without cache.
            if (Array.isArray(kernelsFromCache) && kernelsFromCache.length > 0) {
                kernels = kernelsFromCache;
            } else {
                kernels = await kernelsWithoutCachePromise;
            }
        }

        //
        kernels = this.filterKernels(kernels);
        sendKernelListTelemetry(resource, kernels);
        return kernels;
    }

    // This should return a WRITABLE place that jupyter will look for a kernel as documented
    // here: https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
    public async getKernelSpecRootPath(): Promise<string | undefined> {
        return this.jupyterPaths.getKernelSpecRootPath();
    }

    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'local' })
    private async listKernelsWithoutCache(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata[]> {
        let [nonPythonKernelSpecs, pythonRelatedKernelSpecs] = await Promise.all([
            this.nonPythonkernelFinder.listKernelSpecs(false, cancelToken),
            this.pythonKernelFinder.listKernelSpecs(resource, true, cancelToken)
        ]);

        const kernels = this.filterKernels(nonPythonKernelSpecs.concat(pythonRelatedKernelSpecs));
        this.lastFetchedKernelsWithoutCache = kernels;
        this.globalState.update(GlobalKernelSpecsCacheKey, kernels).then(noop, (ex) => {
            console.error('Failed to update global kernel cache', ex);
        });
        return kernels;
    }

    private async listValidKernelsFromGlobalCache(
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata[]> {
        const values = this.lastFetchedKernelsWithoutCache.length
            ? this.lastFetchedKernelsWithoutCache
            : this.globalState.get<LocalKernelConnectionMetadata[]>(GlobalKernelSpecsCacheKey, []);
        const validValues: LocalKernelConnectionMetadata[] = [];
        const promise = Promise.all(
            values.map(async (item) => {
                let somethingIsInvalid = false;
                const promises: Promise<void>[] = [];
                if (item.interpreter?.path) {
                    // Possible the interpreter no longer exists, in such cases, exclude this cached kernel from the list.
                    promises.push(
                        this.fs
                            .localFileExists(item.interpreter.path)
                            .then((exists) => {
                                if (!exists) {
                                    somethingIsInvalid = true;
                                }
                            })
                            .catch(noop)
                    );
                }
                if (item.kind === 'startUsingKernelSpec' && item.kernelSpec?.specFile) {
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
            const extensionId = kernelSpec.metadata?.vscode?.extension_id;
            if (extensionId && this.extensions.getExtension(extensionId)) {
                traceInfo(`Hiding kernelspec ${kernelSpec.display_name}, better support by ${extensionId}`);
                return false;
            }
            return true;
        });
    }
}
