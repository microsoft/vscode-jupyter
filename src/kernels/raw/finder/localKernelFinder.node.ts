// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Event, EventEmitter, Memento, Uri } from 'vscode';
import { IKernelFinder, LocalKernelConnectionMetadata } from '../../../kernels/types';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { traceInfo, ignoreLogging, traceDecoratorError, traceError, traceVerbose } from '../../../platform/logging';
import { GLOBAL_MEMENTO, IDisposableRegistry, IExtensions, IMemento } from '../../../platform/common/types';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { ILocalKernelFinder } from '../types';
import { createPromiseFromCancellation } from '../../../platform/common/cancellation';
import { isArray } from '../../../platform/common/utils/sysTypes';
import { deserializeKernelConnection, serializeKernelConnection } from '../../helpers';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { waitForCondition } from '../../../platform/common/utils/async';
import { noop } from '../../../platform/common/utils/misc';
import { IFileSystem } from '../../../platform/common/platform/types';
import { KernelFinder } from '../../kernelFinder';
import { LocalKernelSpecsCacheKey, removeOldCachedItems } from '../../common/commonFinder';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { CondaService } from '../../../platform/common/process/condaService.node';
import * as localize from '../../../platform/common/utils/localize';
import { debounceAsync } from '../../../platform/common/utils/decorators';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { ContributedKernelFinderKind } from '../../internalTypes';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';

// This class searches for local kernels.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class LocalKernelFinder implements ILocalKernelFinder, IExtensionSingleActivationService {
    kind = ContributedKernelFinderKind.Local;
    id: string = 'local';
    displayName: string = localize.DataScience.localKernelFinderDisplayName();

    private _onDidChangeKernels = new EventEmitter<void>();
    onDidChangeKernels: Event<void> = this._onDidChangeKernels.event;

    private wasPythonInstalledWhenFetchingControllers = false;

    private cache: LocalKernelConnectionMetadata[] = [];
    private _initializeResolve: () => void;
    private _initializedPromise: Promise<void>;

    get initialized(): Promise<void> {
        return this._initializedPromise;
    }

    constructor(
        @inject(LocalKnownPathKernelSpecFinder) private readonly nonPythonKernelFinder: LocalKnownPathKernelSpecFinder,
        @inject(LocalPythonAndRelatedNonPythonKernelSpecFinder)
        private readonly pythonKernelFinder: LocalPythonAndRelatedNonPythonKernelSpecFinder,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(IKernelFinder) kernelFinder: KernelFinder,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(CondaService) private readonly condaService: CondaService,
        @inject(IExtensions) private readonly extensions: IExtensions
    ) {
        this._initializedPromise = new Promise<void>((resolve) => {
            this._initializeResolve = resolve;
        });

        kernelFinder.registerKernelFinder(this);
    }

    async activate(): Promise<void> {
        this.loadInitialState().then(noop, noop);

        this.condaService.onCondaEnvironmentsChanged(this.onDidChangeCondaEnvironments, this, this.disposables);

        this.interpreters.onDidChangeInterpreters(
            async () => {
                this.updateCache().then(noop, noop);
            },
            this,
            this.disposables
        );
        this.extensions.onDidChange(
            () => {
                // If we just installed the Python extension and we fetched the controllers, then fetch it again.
                if (
                    !this.wasPythonInstalledWhenFetchingControllers &&
                    this.extensionChecker.isPythonExtensionInstalled
                ) {
                    this.updateCache().then(noop, noop);
                }
            },
            this,
            this.disposables
        );
        this.nonPythonKernelFinder.onDidChangeKernels(
            () => {
                this.updateCache().then(noop, noop);
            },
            this,
            this.disposables
        );
        this.pythonKernelFinder.onDidChangeKernels(
            () => {
                this.updateCache().then(noop, noop);
            },
            this,
            this.disposables
        );
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
    }

    private async loadInitialState() {
        traceVerbose('LocalKernelFinder: load cache');
        // loading cache, which is resource agnostic
        const kernelsFromCache = await this.getFromCache();
        let kernels: LocalKernelConnectionMetadata[] = [];

        this.updateCache().catch(noop);

        if (Array.isArray(kernelsFromCache) && kernelsFromCache.length > 0) {
            kernels = kernelsFromCache;
            await this.writeToCache(kernels);
        } else {
            await this.updateCache();
        }

        traceVerbose('LocalKernelFinder: load cache finished');
        this._initializeResolve();
    }

    private async updateCache() {
        try {
            await Promise.all([this.nonPythonKernelFinder.initialized, this.pythonKernelFinder.initialized]);
            let kernels: LocalKernelConnectionMetadata[] = [];
            // Exclude python kernel specs (we'll get that from the pythonKernelFinder)
            const nonPythonKernels = this.nonPythonKernelFinder.kernels.filter(
                (item) => item.kernelSpec.language !== PYTHON_LANGUAGE
            );
            kernels = kernels.concat(nonPythonKernels).concat(this.pythonKernelFinder.kernels);
            await this.writeToCache(kernels);
        } catch (ex) {
            traceError(`Exception Saving loaded kernels: ${ex}`);
        }
    }

    @debounceAsync(1_000)
    private async onDidChangeCondaEnvironments() {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        // A new conda environment was added or removed, hence refresh the kernels.
        // Wait for the new env to be discovered before refreshing the kernels.
        const previousCondaEnvCount = (await this.interpreters.getInterpreters()).filter(
            (item) => item.envType === EnvironmentType.Conda
        ).length;

        await this.interpreters.refreshInterpreters(true);
        // Possible discovering interpreters is very quick and we've already discovered it, hence refresh kernels immediately.
        await this.updateCache();

        // Possible discovering interpreters is slow, hence try for around 10s.
        // I.e. just because we know a conda env was created doesn't necessarily mean its immediately discoverable and usable.
        // Possible it takes some time.
        // Wait for around 5s between each try, we know Python extension can be slow to discover interpreters.
        await waitForCondition(
            async () => {
                const condaEnvCount = (await this.interpreters.getInterpreters()).filter(
                    (item) => item.envType === EnvironmentType.Conda
                ).length;
                if (condaEnvCount > previousCondaEnvCount) {
                    return true;
                }
                await this.interpreters.refreshInterpreters(true);
                return false;
            },
            15_000,
            5000
        );

        await this.updateCache();
    }

    public get kernels(): LocalKernelConnectionMetadata[] {
        return this.cache;
    }

    private async getFromCache(cancelToken?: CancellationToken): Promise<LocalKernelConnectionMetadata[]> {
        try {
            traceVerbose('LocalKernelFinder: get from cache');

            let results: LocalKernelConnectionMetadata[] = this.cache;

            // If not in memory, check memento
            if (!results || results.length === 0) {
                // Check memento too
                const values = this.globalState.get<{
                    kernels: LocalKernelConnectionMetadata[];
                    extensionVersion: string;
                }>(this.getCacheKey(), { kernels: [], extensionVersion: '' });

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
            traceError('LocalKernelFinder: Failed to get from cache', ex);
        }

        return [];
    }
    /**
     * Search all our local file system locations for installed kernel specs and return them
     */
    @traceDecoratorError('List kernels failed')
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'local' })
    public async listKernels(
        @ignoreLogging() _cancelToken: CancellationToken
    ): Promise<LocalKernelConnectionMetadata[]> {
        return this.cache;
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
        try {
            const oldValues = this.cache;
            const uniqueIds = new Set<string>();
            const uniqueKernels = values.filter((item) => {
                if (uniqueIds.has(item.id)) {
                    return false;
                }
                uniqueIds.add(item.id);
                return true;
            });
            this.cache = this.filterKernels(uniqueKernels);
            if (JSON.stringify(oldValues) === JSON.stringify(this.cache)) {
                return;
            }

            this._onDidChangeKernels.fire();
            const serialized = values.map(serializeKernelConnection);
            await Promise.all([
                removeOldCachedItems(this.globalState),
                this.globalState.update(this.getCacheKey(), {
                    kernels: serialized,
                    extensionVersion: this.env.extensionVersion
                })
            ]);
        } catch (ex) {
            traceError('LocalKernelFinder: Failed to write to cache', ex);
        }
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
