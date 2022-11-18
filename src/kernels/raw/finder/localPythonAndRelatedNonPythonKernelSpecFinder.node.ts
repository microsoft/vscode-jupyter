// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import * as uriPath from '../../../platform/vscode-path/resources';
import { CancellationToken, CancellationTokenSource, EventEmitter, Memento, Uri } from 'vscode';
import {
    createInterpreterKernelSpec,
    getKernelId,
    getKernelRegistrationInfo,
    isDefaultKernelSpec
} from '../../../kernels/helpers';
import {
    IJupyterKernelSpec,
    LocalKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../kernels/types';
import { LocalKernelSpecFinderBase } from './localKernelSpecFinderBase.node';
import { baseKernelPath, JupyterPaths } from './jupyterPaths.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IApplicationEnvironment, IWorkspaceService } from '../../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfoIfCI, traceVerbose, traceError, traceWarning } from '../../../platform/logging';
import { getDisplayPath, getDisplayPathFromLocalFile } from '../../../platform/common/platform/fs-paths.node';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import {
    IMemento,
    GLOBAL_MEMENTO,
    IDisposable,
    IDisposableRegistry,
    IFeaturesManager
} from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { areInterpreterPathsSame } from '../../../platform/pythonEnvironments/info/interpreter';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { ResourceSet } from '../../../platform/vscode-path/map';
import { areObjectsWithUrisTheSame, noop } from '../../../platform/common/utils/misc';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { ITrustedKernelPaths } from './types';

export const LocalPythonKernelsCacheKey = 'LOCAL_KERNEL_PYTHON_AND_RELATED_SPECS_CACHE_KEY_V_2022_10';
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
export class LocalPythonAndRelatedNonPythonKernelSpecFinder
    extends LocalKernelSpecFinderBase<LocalKernelConnectionMetadata>
    implements IExtensionSyncActivationService
{
    private _cachedKernels: LocalKernelConnectionMetadata[] = [];
    private readonly disposables: IDisposable[] = [];
    private readonly _onDidChangeKernels = new EventEmitter<void>();
    public readonly onDidChangeKernels = this._onDidChangeKernels.event;
    private _kernelsFromCache: LocalKernelConnectionMetadata[] = [];
    private cachedInformationForPythonInterpreter = new Map<InterpreterId, Promise<LocalKernelConnectionMetadata[]>>();
    private updateCachePromise = Promise.resolve();
    private readonly discoveredKernelSpecFiles = new Set<string>();
    private previousRefresh?: Promise<void>;
    constructor(
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IFileSystemNode) fs: IFileSystemNode,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(LocalKnownPathKernelSpecFinder)
        private readonly kernelSpecsFromKnownLocations: LocalKnownPathKernelSpecFinder,
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalState: Memento,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IApplicationEnvironment) env: IApplicationEnvironment,
        @inject(ITrustedKernelPaths) private readonly trustedKernels: ITrustedKernelPaths,
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager
    ) {
        super(fs, workspaceService, extensionChecker, globalState, disposables, env);
        interpreterService.onDidChangeInterpreters(() => this.refreshData().catch(noop), this, this.disposables);
    }
    public activate() {
        this.listKernelsFirstTimeFromMemento(LocalPythonKernelsCacheKey)
            .then((kernels) => {
                if (this._cachedKernels.length === 0 && kernels.length) {
                    this._cachedKernels = kernels;
                    this._kernelsFromCache = kernels.slice();
                    this._onDidChangeKernels.fire();
                }
            })
            .finally(async () => {
                this.refreshData().ignoreErrors();
                if (this.featuresManager.features.kernelPickerType === 'Stable') {
                    this.kernelSpecsFromKnownLocations.onDidChangeKernels(
                        () => {
                            // Only refresh if we know there are new global Python kernels that we haven't already seen before.
                            const lastKnownPythonKernels = this.lastKnownGlobalPythonKernelSpecs;
                            const newPythonKernels = this.listGlobalPythonKernelSpecsIncludingThoseRegisteredByUs();
                            if (
                                lastKnownPythonKernels.length !== newPythonKernels.length ||
                                !areObjectsWithUrisTheSame(lastKnownPythonKernels, newPythonKernels)
                            ) {
                                this.refreshData().catch(noop);
                            }
                        },
                        this,
                        this.disposables
                    );
                    this.interpreterService.onDidChangeInterpreter(
                        () => this.refreshData().catch(noop),
                        this,
                        this.disposables
                    );
                }
            });
    }
    public get kernels(): LocalKernelConnectionMetadata[] {
        return this._cachedKernels;
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    private refreshCancellation?: CancellationTokenSource;
    private lastKnownGlobalPythonKernelSpecs: LocalKernelSpecConnectionMetadata[] = [];
    public async refresh() {
        this.clearCache();
        if (this.featuresManager.features.kernelPickerType === 'Insiders') {
            this.cachedInformationForPythonInterpreter.clear();
            this.discoveredKernelSpecFiles.clear();
            this.interpreterService.refreshInterpreters(true).ignoreErrors();
        }
        await this.refreshData(true);
    }
    public refreshData(forcePythonInterpreterRefresh: boolean = false) {
        // If we're already discovering, then no need to cancel the existing search process
        // unless we're forcing a refresh.
        if (
            !forcePythonInterpreterRefresh &&
            this.refreshCancellation &&
            !this.refreshCancellation.token.isCancellationRequested &&
            this.previousRefresh &&
            this.featuresManager.features.kernelPickerType === 'Insiders'
        ) {
            return this.previousRefresh;
        }
        this.refreshCancellation?.cancel();
        this.refreshCancellation?.dispose();
        const cancelToken = (this.refreshCancellation = new CancellationTokenSource());
        const previousListOfKernels = this._cachedKernels;
        const promise = (async () => {
            if (this.featuresManager.features.kernelPickerType !== 'Insiders') {
                if (forcePythonInterpreterRefresh) {
                    await this.interpreterService.refreshInterpreters(true);
                }
                // Don't refresh until we've actually waited for interpreters to load
                await this.interpreterService.waitForAllInterpretersToLoad();
            }

            await this.listKernelsImplementation(cancelToken.token).then(noop, noop);
            if (cancelToken.token.isCancellationRequested) {
                return;
            }

            if (this.featuresManager.features.kernelPickerType === 'Insiders') {
                // Now that we've done a full refresh, its possible some envs no longer exist,
                // we need to remove that from the list.
                const currentKernelIds = new Set(this._cachedKernels.map((item) => item.id));
                const kernelIdsNoLongerValid = new Set(
                    this._kernelsFromCache.map((item) => item.id).filter((id) => !currentKernelIds.has(id))
                );

                // Remove the invalid kernels.
                this._cachedKernels = this._cachedKernels.filter((item) => !kernelIdsNoLongerValid.has(item.id));
            }
            if (
                this._cachedKernels.length !== previousListOfKernels.length ||
                JSON.stringify(this._cachedKernels) !== JSON.stringify(previousListOfKernels)
            ) {
                if (this.featuresManager.features.kernelPickerType === 'Insiders') {
                    await this.updateCache();
                } else {
                    // Previously we didn't wait, leave that behavior for the old approach (this will go away soon).
                    this.updateCache().ignoreErrors();
                }
            }

            if (this.featuresManager.features.kernelPickerType === 'Insiders' && forcePythonInterpreterRefresh) {
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
        if (this.featuresManager.features.kernelPickerType === 'Insiders') {
            this.updateCachePromise = this.updateCachePromise.finally(() =>
                this.writeToMementoCache(this._cachedKernels, LocalPythonKernelsCacheKey).catch(noop)
            );
            await this.updateCachePromise;
        } else {
            await this.writeToMementoCache(this._cachedKernels, LocalPythonKernelsCacheKey).catch(noop);
        }
    }
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    private async listKernelsImplementationOld(cancelToken: CancellationToken) {
        const interpreters = this.extensionChecker.isPythonExtensionInstalled
            ? this.interpreterService.resolvedEnvironments
            : [];

        traceInfoIfCI(`Listing kernels for ${interpreters.length} interpreters`);
        // If we don't have Python extension installed or don't discover any Python interpreters
        // then list all of the global python kernel specs.
        let kernels: LocalKernelConnectionMetadata[];
        if (interpreters.length === 0 || !this.extensionChecker.isPythonExtensionInstalled) {
            kernels = await this.listGlobalPythonKernelSpecs(false);
        } else {
            kernels = await this.listPythonAndRelatedNonPythonKernelSpecs(interpreters, cancelToken);
        }
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        this._cachedKernels = kernels;
    }

    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    private async listKernelsImplementation(cancelToken: CancellationToken) {
        if (this.featuresManager.features.kernelPickerType === 'Stable') {
            return this.listKernelsImplementationOld(cancelToken);
        }

        const interpreters = this.extensionChecker.isPythonExtensionInstalled
            ? this.interpreterService.resolvedEnvironments
            : [];

        traceInfoIfCI(`Listing kernels for ${interpreters.length} interpreters`);
        // If we don't have Python extension installed or don't discover any Python interpreters
        // then list all of the global python kernel specs.
        this._cachedKernels = this.listGlobalPythonKernelSpecs(false);
        if (this.extensionChecker.isPythonExtensionInstalled) {
            await Promise.all(
                interpreters.map(async (interpreter) => {
                    const kernels = await this.listPythonAndRelatedNonPythonKernelSpecs([interpreter], cancelToken);
                    if (cancelToken.isCancellationRequested) {
                        return [];
                    }

                    // We could have the same kernels in the list, hence don't append, but look for existing ones.
                    const discoveredKernelIds = new Set(kernels.map((item) => item.id));
                    if (kernels.length) {
                        this._cachedKernels = this._cachedKernels
                            .filter((k) => !discoveredKernelIds.has(k.id))
                            .concat(kernels);

                        await this.updateCache();
                    }
                })
            );
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
    /**
     * Some python environments like conda can have non-python kernel specs as well, this will return those as well.
     * Those kernels can only be started within the context of the Python environment.
     * I.e. first activate the python environment, then attempt to start those non-python environments.
     * This is because some python environments setup environment variables required by these non-python kernels (e.g. path to Java executable or the like.
     */
    private async listPythonAndRelatedNonPythonKernelSpecs(
        interpreters: PythonEnvironment[],
        cancelToken: CancellationToken
    ): Promise<LocalKernelConnectionMetadata[]> {
        // First find the on disk kernel specs and interpreters
        const activeInterpreterInAWorkspacePromise = Promise.all(
            (this.workspaceService.workspaceFolders || []).map((folder) =>
                this.interpreterService.getActiveInterpreter(folder.uri)
            )
        );
        const [kernelSpecs, activeInterpreters, tempDirForKernelSpecs] = await Promise.all([
            this.findKernelSpecsInInterpreters(interpreters, cancelToken),
            activeInterpreterInAWorkspacePromise,
            this.jupyterPaths.getKernelSpecTempRegistrationFolder()
        ]);
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        const globalKernelSpecs = this.listGlobalPythonKernelSpecsIncludingThoseRegisteredByUs();
        const globalPythonKernelSpecsRegisteredByUs = globalKernelSpecs.filter((item) =>
            getKernelRegistrationInfo(item.kernelSpec)
        );
        // Possible there are Python kernels (language=python, but not necessarily using ipykernel).
        // E.g. cadabra2 is one such kernel (similar to powershell kernel but language is still python).
        const usingNonIpyKernelLauncher = (item: LocalKernelConnectionMetadata) => {
            if (item.kernelSpec.language !== PYTHON_LANGUAGE) {
                return false;
            }
            const args = item.kernelSpec.argv.map((arg) => arg.toLowerCase());
            const moduleIndex = args.indexOf('-m');
            if (moduleIndex === -1) {
                return false;
            }
            const moduleName = args.length - 1 >= moduleIndex ? args[moduleIndex + 1] : undefined;
            if (!moduleName) {
                return false;
            }
            // We are only interested in global kernels that don't use ipykernel_launcher.
            return moduleName !== 'ipykernel_launcher';
        };

        // Copy the interpreter list. We need to filter out those items
        // which have matched one or more kernelSpecs
        let filteredInterpreters = [...interpreters];

        // If the user has interpreters, then don't display the default kernel specs such as `python`, `python3`.
        // Such kernel specs are ambiguous, and we have absolutely no idea what interpreters they point to.
        // If a user wants to select a kernel they can pick an interpreter (this way we know exactly what interpreter needs to be started).
        // Else if you have `python3`, depending on the active/default interpreter we could start different interpreters (different for the same notebook opened from different workspace folders).
        const hasActiveInterpreter = activeInterpreters.some((item) => !!item);
        const hideDefaultKernelSpecs = interpreters.length > 0 || hasActiveInterpreter ? true : false;

        // Then go through all of the kernels and generate their metadata
        const distinctKernelMetadata = new Map<string, LocalKernelConnectionMetadata>();

        // Go through the global kernelSpecs that use python to launch the kernel and that are not using ipykernel or have a custom environment
        await Promise.all(
            globalKernelSpecs
                .filter((item) => {
                    const registrationInfo = getKernelRegistrationInfo(item.kernelSpec);
                    if (
                        !registrationInfo &&
                        (usingNonIpyKernelLauncher(item) || Object.keys(item.kernelSpec.env || {}).length > 0)
                    ) {
                        return true;
                    }

                    // If the user has created a non-default Python kernelspec without any custom env variables,
                    // Then don't hide it.
                    if (
                        !registrationInfo &&
                        item.kernelSpec.language === PYTHON_LANGUAGE &&
                        !isDefaultKernelSpec(item.kernelSpec)
                    ) {
                        return true;
                    }
                    return false;
                })
                .map(async (item) => {
                    if (cancelToken.isCancellationRequested) {
                        return [];
                    }

                    // If we cannot find a matching interpreter, then too bad.
                    // We can't use any interpreter, because the module used is not `ipykernel_laucnher`.
                    // Its something special, hence ignore if we cannot find a matching interpreter.
                    const matchingInterpreter = await this.findMatchingInterpreter(item.kernelSpec);
                    if (!matchingInterpreter) {
                        traceVerbose(
                            `Kernel Spec for ${
                                item.kernelSpec.display_name
                            } ignored as we cannot find a matching interpreter ${JSON.stringify(item)}`
                        );
                        return;
                    }
                    const kernelSpec = LocalKernelSpecConnectionMetadata.create({
                        kernelSpec: item.kernelSpec,
                        interpreter: matchingInterpreter,
                        id: getKernelId(item.kernelSpec, matchingInterpreter)
                    });
                    distinctKernelMetadata.set(kernelSpec.id, kernelSpec);
                })
        );
        if (cancelToken.isCancellationRequested) {
            return [];
        }

        await Promise.all(
            [...kernelSpecs, ...globalPythonKernelSpecsRegisteredByUs.map((item) => item.kernelSpec)]
                .filter((kernelspec) => {
                    if (
                        kernelspec.language === PYTHON_LANGUAGE &&
                        hideDefaultKernelSpecs &&
                        // Hide default kernelspecs only if env variables are empty.
                        // If not empty, then user has modified them.
                        (!kernelspec.env || Object.keys(kernelspec.env).length === 0) &&
                        isDefaultKernelSpec(kernelspec)
                    ) {
                        traceVerbose(
                            `Hiding default kernel spec '${kernelspec.display_name}', '${
                                kernelspec.name
                            }', ${getDisplayPathFromLocalFile(kernelspec.argv[0])}`
                        );
                        return false;
                    }
                    return true;
                })
                .map(async (k) => {
                    if (cancelToken.isCancellationRequested) {
                        return;
                    }

                    // Find the interpreter that matches. If we find one, we want to use
                    // this to start the kernel.
                    const matchingInterpreter = await this.findMatchingInterpreter(k);
                    if (matchingInterpreter) {
                        const result = PythonKernelConnectionMetadata.create({
                            kernelSpec: k,
                            interpreter: matchingInterpreter,
                            id: getKernelId(k, matchingInterpreter)
                        });

                        // Hide the interpreters from list of kernels unless the user created this kernelspec.
                        // Users can create their own kernels with custom environment variables, in such cases, we should list that
                        // kernel as well as the interpreter (so they can use both).
                        const kernelSpecKind = getKernelRegistrationInfo(result.kernelSpec);
                        if (
                            kernelSpecKind === 'registeredByNewVersionOfExt' ||
                            kernelSpecKind === 'registeredByOldVersionOfExt'
                        ) {
                            filteredInterpreters = filteredInterpreters.filter((i) => matchingInterpreter !== i);
                        }

                        // Return our metadata that uses an interpreter to start
                        return result;
                    } else {
                        const activeInterpreterOfAWorkspaceFolder = activeInterpreters.find((i) => !!i);
                        let interpreter =
                            k.language === PYTHON_LANGUAGE ? activeInterpreterOfAWorkspaceFolder : undefined;
                        // If the interpreter information is stored in kernelspec.json then use that to determine the interpreter.
                        // This can happen under the following circumstances:
                        // 1. Open workspace folder XYZ, and create a virtual environment named venvA
                        // 2. Now assume we don't have raw kernels, and a kernel gets registered for venvA in kernelspecs folder.
                        // 3. The kernel spec will contain metadata pointing to venvA.
                        // 4. Now open a different folder (e.g. a sub directory of XYZ or a completely different folder).
                        // 5. Now venvA will not be listed as an interpreter as Python will not discover this.
                        // 6. However the kernel we registered against venvA will be in global kernels folder
                        // In such an instance the interpreter information is stored in the kernelspec.json file.
                        let foundRightInterpreter = false;
                        const kernelSpecInterpreterPath = k.metadata?.interpreter?.path
                            ? Uri.file(k.metadata.interpreter.path)
                            : undefined;
                        if (k.language === PYTHON_LANGUAGE) {
                            if (kernelSpecInterpreterPath) {
                                foundRightInterpreter = false;
                                const interpreterInKernelSpec = activeInterpreters.find((item) =>
                                    areInterpreterPathsSame(kernelSpecInterpreterPath, item?.uri)
                                );
                                if (interpreterInKernelSpec) {
                                    // Found the exact interpreter as defined in metadata.
                                    interpreter = interpreterInKernelSpec;
                                } else {
                                    try {
                                        // Get the interpreter details as defined in the metadata.
                                        // Possible the kernel spec points to an interpreter in a different workspace folder or the like.
                                        interpreter = await this.interpreterService.getInterpreterDetails(
                                            kernelSpecInterpreterPath
                                        );
                                    } catch (ex) {
                                        traceError(
                                            `Failed to get interpreter details for Kernel Spec ${getDisplayPathFromLocalFile(
                                                k.specFile
                                            )} with interpreter path ${getDisplayPath(kernelSpecInterpreterPath)}`,
                                            ex
                                        );
                                        return;
                                    }
                                }
                            }
                            if (
                                activeInterpreterOfAWorkspaceFolder &&
                                activeInterpreterOfAWorkspaceFolder === interpreter &&
                                !foundRightInterpreter
                            ) {
                                traceWarning(
                                    `Kernel Spec ${k.id} in ${getDisplayPathFromLocalFile(
                                        k.specFile
                                    )} has interpreter metadata but we couldn't find the interpreter, using best match of ${
                                        interpreter?.id
                                    }`
                                );
                            }
                        }
                        const result = LocalKernelSpecConnectionMetadata.create({
                            kernelSpec: k,
                            interpreter,
                            id: getKernelId(k, interpreter)
                        });
                        return result;
                    }
                })
                .map(async (item) => {
                    if (cancelToken.isCancellationRequested) {
                        return [];
                    }

                    const kernelSpec: undefined | LocalKernelConnectionMetadata = await item;
                    // Check if we have already seen this.
                    if (kernelSpec && !distinctKernelMetadata.has(kernelSpec.id)) {
                        distinctKernelMetadata.set(kernelSpec.id, kernelSpec);
                    }
                })
        );
        if (cancelToken.isCancellationRequested) {
            return [];
        }

        const filteredItems = await Promise.all(
            filteredInterpreters.map(async (i) => {
                // Update spec to have a default spec file
                const spec = await createInterpreterKernelSpec(i, tempDirForKernelSpecs);
                const result = PythonKernelConnectionMetadata.create({
                    kernelSpec: spec,
                    interpreter: i,
                    id: getKernelId(spec, i)
                });
                return result;
            })
        );
        if (cancelToken.isCancellationRequested) {
            return [];
        }

        // Combine the two into our list
        const results = [...Array.from(distinctKernelMetadata.values()), ...filteredItems];

        return results.sort((a, b) => {
            if (a.kernelSpec.display_name.toUpperCase() === b.kernelSpec.display_name.toUpperCase()) {
                return 0;
            } else {
                const isTheSameAsAnActiveInterpreter = activeInterpreters.some(
                    (item) =>
                        areInterpreterPathsSame(a.interpreter?.uri, item?.uri) &&
                        a.kernelSpec.display_name.toUpperCase() === item?.displayName?.toUpperCase()
                );
                if (isTheSameAsAnActiveInterpreter) {
                    return -1;
                } else {
                    return 1;
                }
            }
        });
    }

    private async findMatchingInterpreter(kernelSpec: IJupyterKernelSpec): Promise<PythonEnvironment | undefined> {
        const interpreters = this.extensionChecker.isPythonExtensionInstalled
            ? this.interpreterService.resolvedEnvironments
            : [];

        // If we know for a fact that the kernel spec is a Non-Python kernel, then return nothing.
        if (kernelSpec.language && kernelSpec.language !== PYTHON_LANGUAGE) {
            traceInfoIfCI(`Kernel ${kernelSpec.name} is not python based so does not have an interpreter.`);
            return;
        }
        // 1. Check if current interpreter has the same path
        const exactMatch = interpreters.find((i) => {
            if (
                kernelSpec.metadata?.interpreter?.path &&
                areInterpreterPathsSame(Uri.file(kernelSpec.metadata.interpreter.path), i.uri)
            ) {
                traceVerbose(`Kernel ${kernelSpec.name} matches ${i.displayName} based on metadata path.`);
                return true;
            }
            return false;
        });
        if (exactMatch) {
            return exactMatch;
        }
        // 2. Check if we have a fully qualified path in `argv`
        const pathInArgv =
            kernelSpec && Array.isArray(kernelSpec.argv) && kernelSpec.argv.length > 0 ? kernelSpec.argv[0] : undefined;
        if (pathInArgv && path.basename(pathInArgv) !== pathInArgv) {
            const exactMatchBasedOnArgv = interpreters.find((i) => {
                if (areInterpreterPathsSame(Uri.file(pathInArgv), i.uri)) {
                    traceVerbose(`Kernel ${kernelSpec.name} matches ${i.displayName} based on path in argv.`);
                    return true;
                }
                return false;
            });
            if (exactMatchBasedOnArgv) {
                return exactMatchBasedOnArgv;
            }

            // 3. Sometimes we have path paths such as `/usr/bin/python3.6` in the kernel spec.
            // & in the list of interpreters we have `/usr/bin/python3`, they are both the same.
            // Hence we need to ensure we take that into account (just get the interpreter info from Python extension).
            const checkInterpreterInfo =
                !kernelSpec.specFile || this.trustedKernels.isTrusted(Uri.file(kernelSpec.specFile));
            const interpreterInArgv = checkInterpreterInfo
                ? await this.interpreterService.getInterpreterDetails(Uri.file(pathInArgv))
                : undefined;
            if (interpreterInArgv) {
                return interpreterInArgv;
            }
        }

        // 4. Check if `interpreterPath` is defined in kernel metadata.
        if (kernelSpec.interpreterPath) {
            const matchBasedOnInterpreterPath = interpreters.find((i) => {
                if (
                    kernelSpec.interpreterPath &&
                    areInterpreterPathsSame(Uri.file(kernelSpec.interpreterPath), i.uri)
                ) {
                    traceVerbose(`Kernel ${kernelSpec.name} matches ${i.displayName} based on interpreter path.`);
                    return true;
                }
                return false;
            });
            if (matchBasedOnInterpreterPath) {
                return matchBasedOnInterpreterPath;
            }
        }

        return interpreters.find((i) => {
            // 4. Check display name
            if (kernelSpec.display_name === i.displayName) {
                traceVerbose(`Kernel ${kernelSpec.name} matches ${i.displayName} based on display name.`);
                return true;
            }
            return false;
        });
    }
    private async findKernelSpecsInInterpreters(
        interpreters: PythonEnvironment[],
        cancelToken: CancellationToken
    ): Promise<IJupyterKernelSpec[]> {
        traceInfoIfCI(
            `Finding kernel specs for ${interpreters.length} interpreters: ${interpreters
                .map((i) => `${i.displayName} => ${i.uri}`)
                .join('\n')}`
        );
        // Find all the possible places to look for this resource
        const interpreterPaths = this.findKernelPathsOfAllInterpreters(interpreters);
        const [rootSpecPaths, globalSpecRootPath] = await Promise.all([
            this.jupyterPaths.getKernelSpecRootPaths(cancelToken),
            this.jupyterPaths.getKernelSpecRootPath()
        ]);
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        // Exclude the global paths from the list.
        // What could happens is, we could have a global python interpreter and that returns a global path.
        // But we could have a kernel spec in global path that points to a completely different interpreter.
        // We already have a way of identifying the interpreter associated with a global kernelspec.
        // Hence exclude global paths from the list of interpreter specific paths (as global paths are NOT interpreter specific).
        const paths = interpreterPaths.filter(
            (item) => !rootSpecPaths.find((i) => uriPath.isEqual(i, item.kernelSearchPath))
        );

        const searchResults = await this.kernelSpecFinder.findKernelSpecsInPaths(paths, cancelToken);
        let results: IJupyterKernelSpec[] = [];
        await Promise.all(
            searchResults.map(async (resultPath) => {
                if (cancelToken.isCancellationRequested) {
                    return;
                }
                // Add these into our path cache to speed up later finds
                const kernelspec = await this.kernelSpecFinder.getKernelSpec(
                    resultPath.kernelSpecFile,
                    cancelToken,
                    resultPath.interpreter,
                    globalSpecRootPath
                );

                if (kernelspec) {
                    // Sometimes we can have the same interpreter twice,
                    // one with python310 and another with python, (these duplicate should ideally be removed by Python extension).
                    // However given that these have been detected we should account for these,
                    // Its not possible for the same kernelspec to be discovered twice and belong to two different interpreters.
                    if (!kernelspec.specFile || !this.discoveredKernelSpecFiles.has(kernelspec.specFile)) {
                        results.push(kernelspec);
                        kernelspec.specFile && this.discoveredKernelSpecFiles.add(kernelspec.specFile);
                    }
                }
            })
        );

        // Filter out duplicates. This can happen when
        // 1) Conda installs kernel
        // 2) Same kernel is registered in the global location
        // We should have extra metadata on the global location pointing to the original
        const originalSpecFiles = new Set<string>();
        results.forEach((r) => {
            if (r.metadata?.originalSpecFile) {
                originalSpecFiles.add(r.metadata.originalSpecFile);
            }
        });
        results = results.filter((r) => !r.specFile || !originalSpecFiles.has(r.specFile));

        // There was also an old bug where the same item would be registered more than once. Eliminate these dupes
        // too.
        const unique: IJupyterKernelSpec[] = [];
        const byDisplayName = new Map<string, IJupyterKernelSpec>();
        results.forEach((r) => {
            const existing = byDisplayName.get(r.display_name);
            if (existing && existing.executable !== r.executable) {
                // This item is a dupe but has a different path to start the exe
                unique.push(r);
            } else if (!existing) {
                unique.push(r);
                byDisplayName.set(r.display_name, r);
            }
        });

        traceInfoIfCI(`Finding kernel specs unique results: ${unique.map((u) => u.interpreterPath!).join('\n')}`);

        return unique;
    }

    /**
     * For the given resource, find atll the file paths for kernel specs that we want to associate with this
     */
    private findKernelPathsOfAllInterpreters(
        interpreters: PythonEnvironment[]
    ): { interpreter: PythonEnvironment; kernelSearchPath: Uri }[] {
        const kernelSpecPathsAlreadyListed = new ResourceSet();
        return interpreters
            .map((interpreter) => {
                return {
                    interpreter,
                    kernelSearchPath: Uri.file(path.join(interpreter.sysPrefix, baseKernelPath))
                };
            })
            .filter((item) => {
                if (kernelSpecPathsAlreadyListed.has(item.kernelSearchPath)) {
                    return false;
                }
                kernelSpecPathsAlreadyListed.add(item.kernelSearchPath);
                return true;
            });
    }
}
