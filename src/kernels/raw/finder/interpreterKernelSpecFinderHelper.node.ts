// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../../platform/vscode-path/path';
import * as uriPath from '../../../platform/vscode-path/resources';
import { CancellationToken, CancellationTokenSource, env, Uri } from 'vscode';
import {
    createInterpreterKernelSpec,
    getKernelId,
    getKernelRegistrationInfo,
    isDefaultKernelSpec
} from '../../../kernels/helpers';
import {
    IJupyterKernelSpec,
    KernelConnectionMetadata,
    LocalKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../kernels/types';
import { KernelSpecLoader } from './localKernelSpecFinderBase.node';
import { baseKernelPath, JupyterPaths } from './jupyterPaths.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { PYTHON_LANGUAGE, Telemetry } from '../../../platform/common/constants';
import { traceVerbose, traceError, traceWarning, traceInfo } from '../../../platform/logging';
import { getDisplayPath, getDisplayPathFromLocalFile } from '../../../platform/common/platform/fs-paths.node';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { areInterpreterPathsSame } from '../../../platform/pythonEnvironments/info/interpreter';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { ITrustedKernelPaths } from './types';
import { IDisposable } from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { raceCancellation } from '../../../platform/common/cancellation';
import { sendTelemetryEvent } from '../../../telemetry';
import { getTelemetrySafeHashedString } from '../../../platform/telemetry/helpers';
import { isKernelLaunchedViaLocalPythonIPyKernel } from '../../helpers.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { areObjectsWithUrisTheSame, noop } from '../../../platform/common/utils/misc';
import { IWorkspaceService } from '../../../platform/common/application/types';

export function localPythonKernelsCacheKey() {
    const LocalPythonKernelsCacheKey = 'LOCAL_KERNEL_PYTHON_AND_RELATED_SPECS_CACHE_KEY_V_2023_3';
    return `${LocalPythonKernelsCacheKey}:${env.appHost}:${env.remoteName || ''}`;
}

export async function findKernelSpecsInInterpreter(
    interpreter: PythonEnvironment,
    cancelToken: CancellationToken,
    jupyterPaths: JupyterPaths,
    kernelSpecFinder: KernelSpecLoader
): Promise<IJupyterKernelSpec[]> {
    // Find all the possible places to look for this resource
    const kernelSearchPath = Uri.file(path.join(interpreter.sysPrefix, baseKernelPath));
    const rootSpecPaths = await jupyterPaths.getKernelSpecRootPaths(cancelToken);
    if (cancelToken.isCancellationRequested) {
        return [];
    }
    // Exclude the global paths from the list.
    // What could happens is, we could have a global python interpreter and that returns a global path.
    // But we could have a kernel spec in global path that points to a completely different interpreter.
    // We already have a way of identifying the interpreter associated with a global kernel spec.
    // Hence exclude global paths from the list of interpreter specific paths (as global paths are NOT interpreter specific).
    if (rootSpecPaths.some((uri) => uriPath.isEqual(uri, kernelSearchPath))) {
        return [];
    }
    const kernelSpecs = await kernelSpecFinder.findKernelSpecsInPaths(kernelSearchPath, cancelToken);
    if (cancelToken.isCancellationRequested) {
        return [];
    }

    let results: IJupyterKernelSpec[] = [];
    await Promise.all(
        kernelSpecs.map(async (kernelSpecFile) => {
            if (cancelToken.isCancellationRequested) {
                return;
            }
            // Add these into our path cache to speed up later finds
            const kernelSpec = await kernelSpecFinder.loadKernelSpec(kernelSpecFile, cancelToken, interpreter);
            if (kernelSpec) {
                results.push(kernelSpec);
            }
        })
    );
    if (cancelToken.isCancellationRequested) {
        return [];
    }

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
    if (results.length) {
        traceVerbose(`Kernel Specs found in interpreter ${interpreter.id} are ${JSON.stringify(results)}`);
    }
    // There was also an old bug where the same item would be registered more than once. Eliminate these dupes
    // too.
    const uniqueKernelSpecs: IJupyterKernelSpec[] = [];
    const byDisplayName = new Map<string, IJupyterKernelSpec>();
    results.forEach((r) => {
        const existing = byDisplayName.get(r.display_name);
        if (existing && existing.executable !== r.executable) {
            // This item is a dupe but has a different path to start the exe
            uniqueKernelSpecs.push(r);
        } else if (!existing) {
            uniqueKernelSpecs.push(r);
            byDisplayName.set(r.display_name, r);
        }
    });

    return uniqueKernelSpecs;
}

/**
 * Some python environments like conda can have non-python kernel specs as well, this will return those as well.
 * Those kernels can only be started within the context of the Python environment.
 * I.e. first activate the python environment, then attempt to start those non-python environments.
 * This is because some python environments setup environment variables required by these non-python kernels (e.g. path to Java executable or the like.
 */
export class InterpreterSpecificKernelSpecsFinder implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    private cancelToken = new CancellationTokenSource();
    private kernelSpecPromise?: Promise<LocalKernelConnectionMetadata[]>;
    constructor(
        public readonly interpreter: PythonEnvironment,
        private readonly interpreterService: IInterpreterService,
        private readonly jupyterPaths: JupyterPaths,
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly kernelSpecFinder: KernelSpecLoader
    ) {
        this.interpreterService.onDidChangeInterpreter(this.clearCacheWhenInterpretersChange, this, this.disposables);
        this.interpreterService.onDidChangeInterpreters(this.clearCacheWhenInterpretersChange, this, this.disposables);
    }
    dispose() {
        disposeAllDisposables(this.disposables);
        this.cancelToken.dispose();
    }
    public async listKernelSpecs(refresh?: boolean) {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return [];
        }
        if (!refresh && this.kernelSpecPromise) {
            return this.kernelSpecPromise;
        }
        this.cancelToken.cancel();
        this.cancelToken = new CancellationTokenSource();
        this.kernelSpecPromise = this.listKernelSpecsImpl();
        this.kernelSpecPromise
            .then((kernels) => {
                traceVerbose(
                    `Kernels for interpreter ${this.interpreter.id} are ${kernels.map((k) => k.id).join(', ')}`
                );
            })
            .catch(noop);
        return this.kernelSpecPromise;
    }

    private clearCacheWhenInterpretersChange() {
        const interpreter = this.interpreterService.resolvedEnvironments.find((i) => i.id === this.interpreter.id);
        if (!interpreter) {
            return;
        }
        if (
            // If the version, syspath has changed, then we need to re-discover the kernels.
            this.interpreter.envPath !== interpreter.envPath ||
            this.interpreter.version?.raw !== interpreter.version?.raw ||
            this.interpreter.envType !== interpreter.envType ||
            this.interpreter.sysPrefix !== interpreter.sysPrefix
        ) {
            this.listKernelSpecs(true).catch(noop);
        }
    }
    private async listKernelSpecsImpl() {
        const cancelToken = this.cancelToken.token;

        traceVerbose(`Search for KernelSpecs in Interpreter ${getDisplayPath(this.interpreter.uri)}`);
        const [kernelSpecsBelongingToPythonEnvironment, tempDirForKernelSpecs] = await Promise.all([
            findKernelSpecsInInterpreter(this.interpreter, cancelToken, this.jupyterPaths, this.kernelSpecFinder),
            this.jupyterPaths.getKernelSpecTempRegistrationFolder()
        ]);
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        // Update spec to have a default spec file
        const interpreterSpecificKernelSpec = createInterpreterKernelSpec(this.interpreter, tempDirForKernelSpecs);

        // If the user has interpreters, then don't display the default kernel specs such as `python`, `python3`.
        // Such kernel specs are ambiguous, and we have absolutely no idea what interpreters they point to.
        // If a user wants to select a kernel they can pick an interpreter (this way we know exactly what interpreter needs to be started).
        // Else if you have `python3`, depending on the active/default interpreter we could start different interpreters (different for the same notebook opened from different workspace folders).

        // Then go through all of the kernels and generate their metadata
        const distinctKernelMetadata = new Map<string, LocalKernelConnectionMetadata>();

        for (const k of kernelSpecsBelongingToPythonEnvironment) {
            if (
                k.language === PYTHON_LANGUAGE &&
                // Hide default kernel specs only if env variables are empty.
                // If not empty, then user has modified them.
                (!k.env || Object.keys(k.env).length === 0) &&
                isDefaultKernelSpec(k)
            ) {
                traceVerbose(
                    `Hiding default kernel spec '${k.display_name}', '${k.name}', ${getDisplayPath(
                        k.argv[0]
                    )} for interpreter ${getDisplayPath(k.interpreterPath)} and spec ${getDisplayPath(k.specFile)}`
                );
                continue;
            }
            const kernelSpec = isKernelLaunchedViaLocalPythonIPyKernel(k)
                ? PythonKernelConnectionMetadata.create({
                      kernelSpec: k,
                      interpreter: this.interpreter,
                      id: getKernelId(k, this.interpreter)
                  })
                : LocalKernelSpecConnectionMetadata.create({
                      kernelSpec: k,
                      interpreter: this.interpreter,
                      id: getKernelId(k, this.interpreter)
                  });

            // Check if we have already seen this.
            if (kernelSpec && !distinctKernelMetadata.has(kernelSpec.id)) {
                distinctKernelMetadata.set(kernelSpec.id, kernelSpec);
            }
        }

        // Update spec to have a default spec file
        const spec = await interpreterSpecificKernelSpec;
        if (cancelToken.isCancellationRequested) {
            return [];
        }

        const result = PythonKernelConnectionMetadata.create({
            kernelSpec: spec,
            interpreter: this.interpreter,
            id: getKernelId(spec, this.interpreter)
        });
        if (!distinctKernelMetadata.has(result.id)) {
            distinctKernelMetadata.set(result.id, result);
        }
        return Array.from(distinctKernelMetadata.values());
    }
}

/**
 * We can have kernel specs in global locations and they could be python.
 * Some of these could have the python interpreter information in the kernelspec.json file.
 * Either in the argv or in the metadata (latter being the case where Jupyter extension may have added interpreter info into kernelSpec metadata).
 */
export class GlobalPythonKernelSpecFinder implements IDisposable {
    private readonly kernelsPerInterpreter = new Map<string, Promise<IJupyterKernelSpec[]>>();
    private readonly disposables: IDisposable[] = [];
    private cancelToken = new CancellationTokenSource();
    private kernelSpecPromise?: Promise<LocalKernelConnectionMetadata[]>;
    private lastKnownGlobalPythonKernelSpecs: LocalKernelSpecConnectionMetadata[] = [];
    private static globalPythonKernelSpecsForWhichWeCouldNotFindInterpreterInfo = new Set<string>();
    constructor(
        private readonly interpreterService: IInterpreterService,
        private readonly workspaceService: IWorkspaceService,
        private readonly kernelSpecsFromKnownLocations: LocalKnownPathKernelSpecFinder,
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly trustedKernels: ITrustedKernelPaths
    ) {
        kernelSpecsFromKnownLocations.onDidChangeKernels(() => {
            const lastKnownGlobalPythonKernelSpecs = this.lastKnownGlobalPythonKernelSpecs;
            const newGlobalPythonKernelSpecs = this.listGlobalPythonKernelSpecs();
            if (
                lastKnownGlobalPythonKernelSpecs.length !== newGlobalPythonKernelSpecs.length ||
                !areObjectsWithUrisTheSame(lastKnownGlobalPythonKernelSpecs, newGlobalPythonKernelSpecs)
            ) {
                this.kernelSpecPromise = undefined;
                return;
            }
        });
    }
    dispose() {
        disposeAllDisposables(this.disposables);
        this.cancelToken.dispose();
    }
    public async listKernelSpecs(refresh?: boolean) {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return [];
        }
        if (!refresh && this.kernelSpecPromise) {
            return this.kernelSpecPromise;
        }
        this.clear();
        this.cancelToken = new CancellationTokenSource();
        this.kernelSpecPromise = this.listKernelSpecsImpl();
        return this.kernelSpecPromise;
    }
    public clear() {
        this.kernelsPerInterpreter.clear();
        this.cancelToken.cancel();
        this.cancelToken.dispose();
        this.kernelSpecPromise = undefined;
    }
    public async findMatchingInterpreter(
        kernelSpec: IJupyterKernelSpec,
        kernelConnectionType: KernelConnectionMetadata['kind']
    ): Promise<PythonEnvironment | undefined> {
        const interpreters = this.extensionChecker.isPythonExtensionInstalled
            ? this.interpreterService.resolvedEnvironments
            : [];

        const pathInArgv =
            kernelSpec && Array.isArray(kernelSpec.argv) && kernelSpec.argv.length > 0 ? kernelSpec.argv[0] : undefined;
        const kernelSpecLanguage = kernelSpec.language || '';
        const kernelSpecHash = kernelSpec.specFile ? await getTelemetrySafeHashedString(kernelSpec.specFile) : '';
        const isCreatedByUs = getKernelRegistrationInfo(kernelSpec) ? true : false;
        // If we know for a fact that the kernel spec is a Non-Python kernel, then return nothing.
        if (kernelSpec.language && kernelSpec.language !== PYTHON_LANGUAGE) {
            traceVerbose(`Kernel ${kernelSpec.name} is not python based so does not have an interpreter.`);

            // We could be dealing with a powershell kernel where kernelspec looks like
            // { "argv": ["python", "-m", "powershell_kernel", "-f", "{connection_file}" ], "display_name": "PowerShell", "language": "powershell" }
            if (!isCreatedByUs && pathInArgv && kernelSpec.specFile && isLikelyAPythonExecutable(pathInArgv)) {
                sendTelemetryEvent(Telemetry.AmbiguousGlobalKernelSpec, undefined, {
                    kernelSpecHash,
                    kernelConnectionType,
                    pythonPathDefined: path.basename(pathInArgv) !== pathInArgv,
                    argv0: path.basename(pathInArgv),
                    language: kernelSpecLanguage,
                    isCreatedByUs
                });
            }
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
        if (pathInArgv && path.basename(pathInArgv) === pathInArgv && kernelSpec.specFile && !isCreatedByUs) {
            sendTelemetryEvent(Telemetry.AmbiguousGlobalKernelSpec, undefined, {
                kernelSpecHash,
                kernelConnectionType,
                pythonPathDefined: false,
                argv0: path.basename(pathInArgv),
                language: kernelSpecLanguage,
                isCreatedByUs
            });
        }
        // 2. Check if we have a fully qualified path in `argv`
        if (pathInArgv && path.basename(pathInArgv) !== pathInArgv) {
            const pathInArgVUri = Uri.file(pathInArgv);
            const exactMatchBasedOnArgv = interpreters.find((i) => {
                if (areInterpreterPathsSame(pathInArgVUri, i.uri)) {
                    traceVerbose(`Kernel ${kernelSpec.name} matches ${i.displayName} based on path in argv.`);
                    return true;
                }
                return false;
            });
            if (exactMatchBasedOnArgv) {
                if (kernelSpec.specFile && !isCreatedByUs) {
                    sendTelemetryEvent(Telemetry.AmbiguousGlobalKernelSpec, undefined, {
                        kernelSpecHash,
                        kernelConnectionType,
                        pythonPathDefined: true,
                        argv0: path.basename(pathInArgv),
                        pythonEnvFound: 'found',
                        language: kernelSpecLanguage,
                        isCreatedByUs
                    });
                }
                return exactMatchBasedOnArgv;
            }

            // 3. Sometimes we have path paths such as `/usr/bin/python3.6` in the kernel spec.
            // & in the list of interpreters we have `/usr/bin/python3`, they are both the same.
            // Hence we need to ensure we take that into account (just get the interpreter info from Python extension).
            if (!kernelSpec.specFile || this.trustedKernels.isTrusted(Uri.file(kernelSpec.specFile))) {
                const interpreterInArgv = await this.interpreterService.getInterpreterDetails(pathInArgVUri);
                if (interpreterInArgv) {
                    if (kernelSpec.specFile && !isCreatedByUs) {
                        sendTelemetryEvent(Telemetry.AmbiguousGlobalKernelSpec, undefined, {
                            kernelSpecHash,
                            kernelConnectionType,
                            pythonPathDefined: true,
                            argv0: path.basename(pathInArgv),
                            pythonEnvFound: 'foundViaGetEnvDetails',
                            language: kernelSpecLanguage,
                            isCreatedByUs
                        });
                    }
                    return interpreterInArgv;
                }
                if (kernelSpec.specFile && !isCreatedByUs) {
                    sendTelemetryEvent(Telemetry.AmbiguousGlobalKernelSpec, undefined, {
                        kernelSpecHash,
                        kernelConnectionType,
                        pythonPathDefined: true,
                        argv0: path.basename(pathInArgv),
                        pythonEnvFound: 'notFound',
                        language: kernelSpecLanguage,
                        isCreatedByUs
                    });
                }
            } else if (kernelSpec.specFile && !isCreatedByUs) {
                sendTelemetryEvent(Telemetry.AmbiguousGlobalKernelSpec, undefined, {
                    kernelSpecHash,
                    kernelConnectionType,
                    pythonPathDefined: true,
                    argv0: path.basename(pathInArgv),
                    pythonEnvFound: 'notTrusted',
                    language: kernelSpecLanguage,
                    isCreatedByUs
                });
            }
        }

        // 4. Check if `interpreterPath` is defined in kernel metadata.
        if (kernelSpec.interpreterPath) {
            const kernelSpecInterpreterPath = Uri.file(kernelSpec.interpreterPath);
            const matchBasedOnInterpreterPath = interpreters.find((i) => {
                if (kernelSpec.interpreterPath && areInterpreterPathsSame(kernelSpecInterpreterPath, i.uri)) {
                    traceVerbose(`Kernel ${kernelSpec.name} matches ${i.displayName} based on interpreter path.`);
                    return true;
                }
                return false;
            });
            if (matchBasedOnInterpreterPath) {
                return matchBasedOnInterpreterPath;
            }
            // Possible we still haven't discovered this interpreter, hence get the details from the Python extension.
            if (!kernelSpec.specFile || this.trustedKernels.isTrusted(Uri.file(kernelSpec.specFile))) {
                const interpreterInInterpreterPath = await this.interpreterService.getInterpreterDetails(
                    kernelSpecInterpreterPath
                );
                if (interpreterInInterpreterPath) {
                    return interpreterInInterpreterPath;
                }
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
    private listGlobalPythonKernelSpecs(): LocalKernelSpecConnectionMetadata[] {
        return (this.lastKnownGlobalPythonKernelSpecs = this.kernelSpecsFromKnownLocations.kernels.filter(
            (item) => item.kernelSpec.language === PYTHON_LANGUAGE
        ));
    }

    private warnAboutPythonKernelSpecWithInvalidPythonExec(kernelSpec: Readonly<IJupyterKernelSpec>) {
        const key = kernelSpec.specFile || JSON.stringify(kernelSpec);

        if (GlobalPythonKernelSpecFinder.globalPythonKernelSpecsForWhichWeCouldNotFindInterpreterInfo.has(key)) {
            return;
        }
        GlobalPythonKernelSpecFinder.globalPythonKernelSpecsForWhichWeCouldNotFindInterpreterInfo.add(key);
        traceWarning(
            `Kernel Spec for '${kernelSpec.display_name}' (${getDisplayPath(
                kernelSpec.specFile
            )}) hidden, as we cannot find a matching interpreter argv = '${
                kernelSpec.argv[0]
            }'. To resolve this, please change '${
                kernelSpec.argv[0]
            }' to point to the fully qualified Python executable.`
        );
    }
    private async listKernelSpecsImpl() {
        const cancelToken = this.cancelToken.token;
        const globalPythonKernelSpecs = this.listGlobalPythonKernelSpecs();
        const activeInterpreterInAWorkspacePromise = Promise.all(
            (this.workspaceService.workspaceFolders || []).map((folder) =>
                this.interpreterService.getActiveInterpreter(folder.uri)
            )
        );

        traceVerbose(`Finding Global Python KernelSpecs`);
        const activeInterpreters = await raceCancellation(cancelToken, [], activeInterpreterInAWorkspacePromise);
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        const globalPythonKernelSpecsRegisteredByUs = globalPythonKernelSpecs.filter((item) =>
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

        // Then go through all of the kernels and generate their metadata
        const distinctKernelMetadata = new Map<string, LocalKernelConnectionMetadata>();

        // Go through the global kernelSpecs that use python to launch the kernel and that are not using ipykernel or have a custom environment
        const globalKernelSpecsLoadedForPython = new Set<string>();
        await Promise.all(
            globalPythonKernelSpecs
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
                    // If we cannot find a matching interpreter, then too bad.
                    // We can't use any interpreter, because the module used is not `ipykernel_launcher`.
                    // Its something special, hence ignore if we cannot find a matching interpreter.
                    const matchingInterpreter = await this.findMatchingInterpreter(
                        item.kernelSpec,
                        'startUsingLocalKernelSpec'
                    );
                    if (!matchingInterpreter) {
                        // If we cannot find a matching interpreter, then we cannot start this kernelspec.
                        // However users can have kernelspecs that have `/bin/bash` as the first argument in argv.
                        // These are situations where users are in full control of the kernel, hence we can ignore these.
                        // Thus we should not warn about these.
                        const executable = item.kernelSpec.argv.length ? item.kernelSpec.argv[0].toLowerCase() : '';
                        if (isLikelyAPythonExecutable(executable)) {
                            this.warnAboutPythonKernelSpecWithInvalidPythonExec(item.kernelSpec);
                            return;
                        }
                    }
                    const kernelSpec = LocalKernelSpecConnectionMetadata.create({
                        kernelSpec: item.kernelSpec,
                        interpreter: matchingInterpreter,
                        id: getKernelId(item.kernelSpec, matchingInterpreter)
                    });
                    distinctKernelMetadata.set(kernelSpec.id, kernelSpec);
                    if (kernelSpec.kernelSpec.specFile) {
                        globalKernelSpecsLoadedForPython.add(kernelSpec.kernelSpec.specFile);
                    }
                })
        );
        if (cancelToken.isCancellationRequested) {
            return [];
        }

        await Promise.all(
            globalPythonKernelSpecsRegisteredByUs
                .map((item) => item.kernelSpec)

                .filter((kernelSpec) => {
                    if (
                        kernelSpec.language === PYTHON_LANGUAGE &&
                        // Hide default kernel specs only if env variables are empty.
                        // If not empty, then user has modified them.
                        (!kernelSpec.env || Object.keys(kernelSpec.env).length === 0) &&
                        isDefaultKernelSpec(kernelSpec)
                    ) {
                        traceVerbose(
                            `Hiding default kernel spec '${kernelSpec.display_name}', '${
                                kernelSpec.name
                            }', ${getDisplayPath(kernelSpec.argv[0])} for interpreter ${getDisplayPath(
                                kernelSpec.interpreterPath
                            )} and spec ${getDisplayPath(kernelSpec.specFile)}`
                        );
                        return false;
                    }
                    if (kernelSpec.specFile && globalKernelSpecsLoadedForPython.has(kernelSpec.specFile)) {
                        traceVerbose(
                            `Global kernel spec ${kernelSpec.name}${getDisplayPath(
                                kernelSpec.specFile
                            )} already found with a matching Python Env`
                        );
                        return false;
                    }
                    return true;
                })
                .map(async (k) => {
                    // Find the interpreter that matches. If we find one, we want to use
                    // this to start the kernel.
                    const matchingInterpreter = await this.findMatchingInterpreter(k, 'startUsingPythonInterpreter');
                    if (matchingInterpreter && isKernelLaunchedViaLocalPythonIPyKernel(k)) {
                        const result = isKernelLaunchedViaLocalPythonIPyKernel(k)
                            ? PythonKernelConnectionMetadata.create({
                                  kernelSpec: k,
                                  interpreter: matchingInterpreter,
                                  id: getKernelId(k, matchingInterpreter)
                              })
                            : LocalKernelSpecConnectionMetadata.create({
                                  kernelSpec: k,
                                  interpreter: matchingInterpreter,
                                  id: getKernelId(k, matchingInterpreter)
                              });

                        // Check if this is a kernelspec registered by an old version of the extension.
                        const kernelSpecKind = getKernelRegistrationInfo(result.kernelSpec);
                        if (kernelSpecKind === 'registeredByOldVersionOfExt') {
                            traceVerbose(
                                `Ignoring Global Python KernelSpec '${k.display_name}', '${k.name}' (${getDisplayPath(
                                    k.specFile
                                )}) registered by an old version of the extension`
                            );
                            return;
                        }
                        traceInfo(
                            `Using interpreter ${getDisplayPath(matchingInterpreter.id)} for Global Python kernel '${
                                k.display_name
                            }', ${k.name} (${getDisplayPath(k.specFile)})`
                        );
                        return result;
                    } else {
                        // NOTE: Defaulting to the active interpreter (of any random workspace folder, even if user has multiple folders open) is hacky, but this is the only fall back we have.
                        // See here https://github.com/microsoft/vscode-jupyter/issues/12278
                        const activeInterpreterOfAWorkspaceFolder = activeInterpreters.find((i) => !!i);
                        let kernelInterpreter = activeInterpreterOfAWorkspaceFolder;
                        // If the interpreter information is stored in kernel spec.json then use that to determine the interpreter.
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
                        if (kernelSpecInterpreterPath) {
                            const interpreterInKernelSpec = activeInterpreters.find((item) =>
                                areInterpreterPathsSame(kernelSpecInterpreterPath, item?.uri)
                            );
                            if (interpreterInKernelSpec) {
                                // Found the exact interpreter as defined in metadata.
                                kernelInterpreter = interpreterInKernelSpec;
                                foundRightInterpreter = true;
                            } else {
                                try {
                                    // Get the interpreter details as defined in the metadata.
                                    // Possible the kernel spec points to an interpreter in a different workspace folder or the like.
                                    kernelInterpreter = await this.interpreterService.getInterpreterDetails(
                                        kernelSpecInterpreterPath
                                    );
                                    foundRightInterpreter = true;
                                } catch (ex) {
                                    traceError(
                                        `Failed to get interpreter details for Kernel Spec '${k.display_name}', '${
                                            k.name
                                        }' ${getDisplayPathFromLocalFile(
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
                            activeInterpreterOfAWorkspaceFolder === kernelInterpreter &&
                            !foundRightInterpreter
                        ) {
                            traceWarning(
                                `Kernel might not start correctly: Fully qualified Python exe not defined (or not found) in Kernel Spec ${
                                    k.id
                                } (${getDisplayPathFromLocalFile(
                                    k.specFile
                                )}, kernelspec.argv[0] = ${getDisplayPathFromLocalFile(
                                    k.argv[0]
                                )}), hence falling back to using the Active Interpreter ${getDisplayPathFromLocalFile(
                                    kernelInterpreter.id
                                )}`
                            );
                        } else if (!foundRightInterpreter) {
                            traceWarning(
                                `Kernel might not start correctly: Fully qualified Python exe not defined (or not found) in Kernel Spec ${
                                    k.id
                                } (${getDisplayPathFromLocalFile(
                                    k.specFile
                                )}, kernelspec.argv[0] = ${getDisplayPathFromLocalFile(k.argv[0])}).`
                            );
                        }
                        const result = LocalKernelSpecConnectionMetadata.create({
                            kernelSpec: k,
                            interpreter: kernelInterpreter,
                            id: getKernelId(k, kernelInterpreter)
                        });
                        traceVerbose(`Interpreter for Local kernel ${result.id} is ${kernelInterpreter?.id}`);

                        return result;
                    }
                })
                .map(async (item) => {
                    if (cancelToken.isCancellationRequested) {
                        return [];
                    }

                    const kernelSpec = await item;
                    traceVerbose(`Found kernel spec at end of discovery ${kernelSpec?.id}`);
                    // Check if we have already seen this.
                    if (kernelSpec && !distinctKernelMetadata.has(kernelSpec.id)) {
                        distinctKernelMetadata.set(kernelSpec.id, kernelSpec);
                    }
                })
        );
        if (cancelToken.isCancellationRequested) {
            return [];
        }

        return Array.from(distinctKernelMetadata.values());
    }
}

function isLikelyAPythonExecutable(executable: string) {
    executable = path.basename(executable).trim().toLowerCase();
    return (
        executable === 'python' ||
        executable === 'python3' ||
        executable === 'python.exe' ||
        executable === 'python3.exe'
    );
}
