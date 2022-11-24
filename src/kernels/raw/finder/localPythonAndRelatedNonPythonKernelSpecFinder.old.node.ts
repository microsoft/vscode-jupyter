// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, CancellationTokenSource, Memento } from 'vscode';
import { getKernelRegistrationInfo } from '../../../kernels/helpers';
import {
    isLocalConnection,
    LocalKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata
} from '../../../kernels/types';
import { LocalKernelSpecFinderBase } from './localKernelSpecFinderBase.node';
import { JupyterPaths } from './jupyterPaths.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IApplicationEnvironment, IWorkspaceService } from '../../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfoIfCI, traceVerbose, traceError, traceWarning } from '../../../platform/logging';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IMemento, GLOBAL_MEMENTO, IDisposableRegistry, IFeaturesManager } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { areObjectsWithUrisTheSame, noop } from '../../../platform/common/utils/misc';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { ITrustedKernelPaths } from './types';
import {
    InterpreterKernelSpecFinderHelper,
    listPythonAndRelatedNonPythonKernelSpecs,
    LocalPythonKernelsCacheKey
} from './interpreterKernelSpecFinderHelper.node';

/**
 * Returns all Python kernels and any related kernels registered in the python environment.
 * If Python extension is not installed, this will return all Python kernels registered globally.
 * If Python extension is installed,
 *     - This will return Python kernels registered by us in global locations.
 *     - This will return Python interpreters that can be started as kernels.
 *     - This will return any non-python kernels that are registered in Python environments (e.g. Java kernels within a conda environment)
 */
@injectable()
export class LocalPythonAndRelatedNonPythonKernelSpecFinderOld extends LocalKernelSpecFinderBase<LocalKernelConnectionMetadata> {
    /**
     * List of all kernels.
     * When opening a new instance of VS Code we load the cache from previous session,
     * & this property contains all of those, the old cached items as well as new items.
     * Eventually the old cached items will be removed after they have been deemed outdated/non-existent.
     */
    private _kernels = new Map<string, LocalKernelConnectionMetadata>();
    /**
     * Contains all kernels that have been discovered in this session.
     * This does not exclude any of the cached kernels from the previous sesion.
     */
    private _kernelsExcludingCachedItems = new Map<string, LocalKernelConnectionMetadata>();
    private _kernelsFromCache: LocalKernelConnectionMetadata[] = [];

    private readonly interpreterKernelSpecFinder: InterpreterKernelSpecFinderHelper;
    constructor(
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IFileSystemNode) fs: IFileSystemNode,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(JupyterPaths) jupyterPaths: JupyterPaths,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(LocalKnownPathKernelSpecFinder)
        private readonly kernelSpecsFromKnownLocations: LocalKnownPathKernelSpecFinder,
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalState: Memento,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IApplicationEnvironment) env: IApplicationEnvironment,
        @inject(ITrustedKernelPaths) trustedKernels: ITrustedKernelPaths,
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager
    ) {
        super(fs, workspaceService, extensionChecker, globalState, disposables, env, jupyterPaths);
        if (this.featuresManager.features.kernelPickerType !== 'Stable') {
            return;
        }
        this.interpreterKernelSpecFinder = new InterpreterKernelSpecFinderHelper(
            jupyterPaths,
            this.kernelSpecFinder,
            interpreterService,
            extensionChecker,
            trustedKernels
        );
        this.disposables.push(this._onDidChangeKernels);
        interpreterService.onDidChangeInterpreters(
            () => {
                traceVerbose(`refreshData after detecting changes to interpreters`);
                this.refreshCancellation?.cancel();
                this.refreshData().catch(noop);
            },
            this,
            this.disposables
        );
        interpreterService.onDidRemoveInterpreter(
            (e) => {
                traceVerbose(`Interpreter removed ${e.id}`);
                const deletedKernels: LocalKernelConnectionMetadata[] = [];
                this._kernels.forEach((k) => {
                    if (k.interpreter?.id === e.id) {
                        traceVerbose(
                            `Interpreter ${e.id} deleted, hence deleting corresponding kernel ${k.kind}:'${k.id}`
                        );
                        deletedKernels.push(k);
                        this._kernels.delete(k.id);
                    }
                });
                if (deletedKernels.length) {
                    traceVerbose(
                        `Local Python connection deleted ${deletedKernels.map(
                            (item) => `${item.kind}:'${item.id}: (interpreter id=${item.interpreter?.id})'`
                        )}`
                    );
                    this.updateCache().catch(noop);
                }
            },
            this,
            this.disposables
        );
    }
    public activate() {
        if (this.featuresManager.features.kernelPickerType !== 'Stable') {
            return;
        }
        this.listKernelsFirstTimeFromMemento(LocalPythonKernelsCacheKey)
            .then((kernels) => {
                if (kernels.length) {
                    // Its possible we have already started discovering via Python API,
                    // Hence don't override what we have.
                    // Give preference to what is already in the cache.
                    kernels
                        .filter((item) => !this._kernels.has(item.id))
                        .forEach((item) => {
                            this._kernelsFromCache.push(item);
                            this._kernels.set(item.id, item);
                        });
                    this._onDidChangeKernels.fire();
                }
            })
            .finally(async () => {
                this.refreshData().ignoreErrors();
                this.kernelSpecsFromKnownLocations.onDidChangeKernels(
                    () => {
                        // Only refresh if we know there are new global Python kernels that we haven't already seen before.
                        const lastKnownPythonKernels = this.lastKnownGlobalPythonKernelSpecs;
                        const newPythonKernels = this.listGlobalPythonKernelSpecsIncludingThoseRegisteredByUs();
                        if (
                            lastKnownPythonKernels.length !== newPythonKernels.length ||
                            !areObjectsWithUrisTheSame(lastKnownPythonKernels, newPythonKernels)
                        ) {
                            this.refreshCancellation?.cancel();
                            this.refreshData().catch(noop);
                        }
                    },
                    this,
                    this.disposables
                );
            });
    }
    public get kernels(): LocalKernelConnectionMetadata[] {
        return Array.from(this._kernels.values());
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    private refreshCancellation?: CancellationTokenSource;
    private lastKnownGlobalPythonKernelSpecs: LocalKernelSpecConnectionMetadata[] = [];
    public async refresh() {
        this.interpreterKernelSpecFinder.clear();
        this.clearCache();

        await this.refreshData(true);
    }
    public refreshData(forcePythonInterpreterRefresh: boolean = false) {
        this.refreshCancellation?.cancel();
        this.refreshCancellation?.dispose();
        const cancelToken = (this.refreshCancellation = new CancellationTokenSource());
        const previousListOfKernels = this._kernels;
        const promise = (async () => {
            if (forcePythonInterpreterRefresh) {
                await this.interpreterService.refreshInterpreters(true);
            }
            // Don't refresh until we've actually waited for interpreters to load
            await this.interpreterService.waitForAllInterpretersToLoad();

            await this.listKernelsImplementation(cancelToken.token).catch((ex) =>
                traceError('Failure in listKernelsImplementation', ex)
            );
            if (cancelToken.token.isCancellationRequested) {
                return;
            }

            if (
                this._kernels.size !== previousListOfKernels.size ||
                JSON.stringify(this._kernels) !== JSON.stringify(previousListOfKernels)
            ) {
                // Previously we didn't wait, leave that behavior for the old approach (this will go away soon).
                this.updateCache().ignoreErrors();
            }
        })()
            .catch((ex) => traceError(`Failed to discover kernels in interpreters`, ex))
            .finally(() => {
                if (cancelToken === this.refreshCancellation) {
                    this.refreshCancellation?.cancel();
                    this.refreshCancellation?.dispose();
                    this.refreshCancellation = undefined;
                }
            });

        this.promiseMonitor.push(promise);
        return promise;
    }
    private async updateCache() {
        this._onDidChangeKernels.fire();
        const kernels = Array.from(this._kernels.values());

        await this.writeToMementoCache(kernels, LocalPythonKernelsCacheKey).catch(noop);
    }
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    private async listKernelsImplementationOld(cancelToken: CancellationToken) {
        const interpreters = this.extensionChecker.isPythonExtensionInstalled
            ? this.interpreterService.resolvedEnvironments
            : [];

        traceInfoIfCI(`Listing kernels for ${interpreters.length} interpreters`);
        // If we don't have Python extension installed or don't discover any Python interpreters
        // then list all of the global python kernel specs.
        let kernels: LocalKernelConnectionMetadata[] = [];
        if (interpreters.length === 0 || !this.extensionChecker.isPythonExtensionInstalled) {
            kernels = await this.listGlobalPythonKernelSpecs(false);
        } else {
            const kernelsForAllInterpreters = await Promise.all(
                interpreters.map((interpreter) =>
                    listPythonAndRelatedNonPythonKernelSpecs(
                        interpreter,
                        cancelToken,
                        this.workspaceService,
                        this.interpreterService,
                        this.jupyterPaths,
                        this.interpreterKernelSpecFinder,
                        this.listGlobalPythonKernelSpecsIncludingThoseRegisteredByUs()
                    )
                )
            );
            kernels = kernelsForAllInterpreters.flat();
        }
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        await this.appendNewKernels(kernels);
    }

    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    private async listKernelsImplementation(cancelToken: CancellationToken) {
        return this.listKernelsImplementationOld(cancelToken);
    }
    private async appendNewKernels(kernels: LocalKernelConnectionMetadata[]) {
        if (kernels.length) {
            kernels.forEach((kernel) => {
                if (isLocalConnection(kernel) && kernel.kernelSpec.specFile) {
                    this._kernelsExcludingCachedItems.set(kernel.id, kernel);
                    if (this._kernels.has(kernel.id)) {
                        // We probably have an old outdated item in the dict, update that with the latest.
                        // E.g. its possible this item was previously loaded from cache.
                        // & now we have discovered the latest information, which is better than the cached data.
                        this._kernels.set(kernel.id, kernel);
                    } else {
                        // This is a new kernel.
                        this._kernels.set(kernel.id, kernel);
                    }
                } else {
                    traceWarning(`Found a kernel ${kernel.kind}:'${kernel.id}', but excluded as specFile is undefined`);
                }
            });

            // In the past we never awaited on this promise.
            this.updateCache().catch(noop);
        }
    }
    private listGlobalPythonKernelSpecs(includeKernelsRegisteredByUs: boolean): LocalKernelSpecConnectionMetadata[] {
        const pythonKernelSpecs = this.kernelSpecsFromKnownLocations.kernels
            .filter((item) => item.kernelSpec.language === PYTHON_LANGUAGE)
            // If there are any kernels that we registered (then don't return them).
            // Those were registered by us to start kernels from Jupyter extension (not stuff that user created).
            // We should only return global kernels the user created themselves, others will appear when searching for interprters.
            .filter((item) => (includeKernelsRegisteredByUs ? true : !getKernelRegistrationInfo(item.kernelSpec)));
        return pythonKernelSpecs;
    }
    private listGlobalPythonKernelSpecsIncludingThoseRegisteredByUs() {
        return (this.lastKnownGlobalPythonKernelSpecs = this.listGlobalPythonKernelSpecs(true));
    }
}
