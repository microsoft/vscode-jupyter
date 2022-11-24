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
import { IMemento, GLOBAL_MEMENTO, IDisposableRegistry } from '../../../platform/common/types';
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

type InterpreterId = string;

/**
 * Returns all Python kernels and any related kernels registered in the python environment.
 * If Python extension is not installed, this will return all Python kernels registered globally.
 * If Python extension is installed,
 *     - This will return Python kernels registered by us in global locations.
 *     - This will return Python interpreters that can be started as kernels.
 *     - This will return any non-python kernels that are registered in Python environments (e.g. Java kernels within a conda environment)
 */
@injectable()
export class LocalPythonAndRelatedNonPythonKernelSpecFinder extends LocalKernelSpecFinderBase<LocalKernelConnectionMetadata> {
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
    private cachedInformationForPythonInterpreter = new Map<InterpreterId, Promise<LocalKernelConnectionMetadata[]>>();
    private updateCachePromise = Promise.resolve();
    private readonly discoveredKernelSpecFiles = new Set<string>();
    private previousRefresh?: Promise<void>;
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
        @inject(ITrustedKernelPaths) trustedKernels: ITrustedKernelPaths
    ) {
        super(fs, workspaceService, extensionChecker, globalState, disposables, env, jupyterPaths);

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
                this.refreshCancellation?.cancel();
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
        this.cachedInformationForPythonInterpreter.clear();
        this.discoveredKernelSpecFiles.clear();
        this.interpreterService.refreshInterpreters(true).ignoreErrors();
        await this.refreshData(true);
    }
    public refreshData(forcePythonInterpreterRefresh: boolean = false) {
        // If we're already discovering, then no need to cancel the existing search process
        // unless we're forcing a refresh.
        if (
            !forcePythonInterpreterRefresh &&
            this.refreshCancellation &&
            !this.refreshCancellation.token.isCancellationRequested &&
            this.previousRefresh
        ) {
            return this.previousRefresh;
        }
        this.refreshCancellation?.cancel();
        this.refreshCancellation?.dispose();
        const cancelToken = (this.refreshCancellation = new CancellationTokenSource());
        const promise = (async () => {
            await this.listKernelsImplementation(cancelToken.token).catch((ex) =>
                traceError('Failure in listKernelsImplementation', ex)
            );
            if (cancelToken.token.isCancellationRequested) {
                return;
            }

            if (this.interpreterService.status === 'idle') {
                // Now that we've done a full refresh, its possible some envs no longer exist (that were in the cache),
                // we need to remove that from the list of the old kernels that we had loaded from the cache.
                const kernelConnectionsFoundOnlyInCache = this._kernelsFromCache.filter(
                    (item) => !this._kernelsExcludingCachedItems.has(item.id)
                );
                const deletedKernels: LocalKernelConnectionMetadata[] = [];
                if (kernelConnectionsFoundOnlyInCache.length) {
                    traceWarning(
                        `Kernels ${kernelConnectionsFoundOnlyInCache
                            .map((item) => `${item.kind}:'${item.id}'`)
                            .join(', ')} found in cache but not discovered in current session ${Array.from(
                            this._kernelsExcludingCachedItems.values()
                        )
                            .map((item) => `${item.kind}:'${item.id}'`)
                            .join(', ')}`
                    );
                    kernelConnectionsFoundOnlyInCache.forEach((item) => {
                        this._kernels.delete(item.id);
                        deletedKernels.push(item);
                    });
                }

                // It is also possible the user deleted a python environment,
                // E.g. user deleted a conda env or a virtual env and they refreshed the list of interpreters/kernels.
                // We should now remove those kernels as well.
                const validInterpreterIds = new Set(this.interpreterService.resolvedEnvironments.map((i) => i.id));
                const kernelsThatPointToInvalidValidInterpreters = Array.from(this._kernels.values()).filter((item) => {
                    if (item.interpreter && !validInterpreterIds.has(item.interpreter.id)) {
                        return true;
                    }
                    return false;
                });
                if (kernelsThatPointToInvalidValidInterpreters.length) {
                    traceWarning(
                        `The following kernels use interpreters that are no longer valid or not recognized by Python extension, Kernels ${kernelsThatPointToInvalidValidInterpreters
                            .map((item) => `${item.kind}:'id=${item.id}'(interpreterId='${item.interpreter?.id}')`)
                            .join(',')} and valid interpreter ids include ${Array.from(validInterpreterIds).join(', ')}`
                    );
                    kernelsThatPointToInvalidValidInterpreters.forEach((item) => {
                        this._kernels.delete(item.id);
                        deletedKernels.push(item);
                    });
                }

                if (deletedKernels.length) {
                    traceVerbose(
                        `Local Python connection deleted ${deletedKernels.map(
                            (item) => `${item.kind}:'${item.id}: (interpreter id=${item.interpreter?.id})'`
                        )}`
                    );
                    await this.updateCache();
                }
            }

            if (forcePythonInterpreterRefresh) {
                this._kernelsFromCache = [];
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

        this.previousRefresh = promise;
        this.promiseMonitor.push(promise);
        return promise;
    }
    private async updateCache() {
        this._onDidChangeKernels.fire();
        const kernels = Array.from(this._kernels.values());
        this.updateCachePromise = this.updateCachePromise.finally(() =>
            this.writeToMementoCache(kernels, LocalPythonKernelsCacheKey).catch(noop)
        );
        await this.updateCachePromise;
    }

    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    private async listKernelsImplementation(cancelToken: CancellationToken) {
        const interpreters = this.extensionChecker.isPythonExtensionInstalled
            ? this.interpreterService.resolvedEnvironments
            : [];

        traceInfoIfCI(`Listing kernels for ${interpreters.length} interpreters`);
        // If we don't have Python extension installed or don't discover any Python interpreters
        // then list all of the global python kernel specs.
        if (this.extensionChecker.isPythonExtensionInstalled) {
            await Promise.all(
                interpreters.map(async (interpreter) => {
                    const kernels = await listPythonAndRelatedNonPythonKernelSpecs(
                        interpreter,
                        cancelToken,
                        this.workspaceService,
                        this.interpreterService,
                        this.jupyterPaths,
                        this.interpreterKernelSpecFinder,
                        this.listGlobalPythonKernelSpecsIncludingThoseRegisteredByUs()
                    );
                    if (cancelToken.isCancellationRequested) {
                        return [];
                    }
                    await this.appendNewKernels(kernels);
                })
            );
        } else {
            await this.appendNewKernels(this.listGlobalPythonKernelSpecs(false));
        }
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

            await this.updateCache();
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
