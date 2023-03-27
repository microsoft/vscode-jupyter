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
import { LocalKernelSpecFinder } from './localKernelSpecFinderBase.node';
import { baseKernelPath, JupyterPaths } from './jupyterPaths.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { PYTHON_LANGUAGE, Telemetry } from '../../../platform/common/constants';
import { traceVerbose, traceError, traceWarning } from '../../../platform/logging';
import { getDisplayPath, getDisplayPathFromLocalFile } from '../../../platform/common/platform/fs-paths.node';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { areInterpreterPathsSame } from '../../../platform/pythonEnvironments/info/interpreter';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { ITrustedKernelPaths } from './types';
import { IDisposable } from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { createPromiseFromCancellation } from '../../../platform/common/cancellation';
import { sendTelemetryEvent } from '../../../telemetry';
import { getTelemetrySafeHashedString } from '../../../platform/telemetry/helpers';
import { isKernelLaunchedViaLocalPythonIPyKernel } from '../../helpers.node';

export function localPythonKernelsCacheKey() {
    const LocalPythonKernelsCacheKey = 'LOCAL_KERNEL_PYTHON_AND_RELATED_SPECS_CACHE_KEY_V_2023_3';
    return `${LocalPythonKernelsCacheKey}:${env.appHost}:${env.remoteName || ''}`;
}

export class InterpreterKernelSpecFinderHelper {
    private readonly discoveredKernelSpecFiles = new Set<string>();
    private readonly disposables: IDisposable[] = [];
    private readonly kernelsPerInterpreter = new Map<string, Promise<IJupyterKernelSpec[]>>();
    constructor(
        private readonly jupyterPaths: JupyterPaths,
        private readonly kernelSpecFinder: LocalKernelSpecFinder,
        private readonly interpreterService: IInterpreterService,
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly trustedKernels: ITrustedKernelPaths
    ) {}
    public clear() {
        this.kernelsPerInterpreter.clear();
        this.discoveredKernelSpecFiles.clear();
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public async findMatchingInterpreter(
        kernelSpec: IJupyterKernelSpec,
        isGlobalKernelSpec: boolean,
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
            if (
                isGlobalKernelSpec &&
                !isCreatedByUs &&
                pathInArgv &&
                kernelSpec.specFile &&
                (path.basename(pathInArgv).toLocaleLowerCase() === 'python' ||
                    path.basename(pathInArgv).toLocaleLowerCase() === 'python3' ||
                    path.basename(pathInArgv).toLocaleLowerCase() === 'python.exe' ||
                    path.basename(pathInArgv).toLocaleLowerCase() === 'python3.exe')
            ) {
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
        if (
            pathInArgv &&
            path.basename(pathInArgv) === pathInArgv &&
            kernelSpec.specFile &&
            isGlobalKernelSpec &&
            !isCreatedByUs
        ) {
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
                if (kernelSpec.specFile && isGlobalKernelSpec && !isCreatedByUs) {
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
                    if (kernelSpec.specFile && isGlobalKernelSpec && !isCreatedByUs) {
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
                if (kernelSpec.specFile && isGlobalKernelSpec && !isCreatedByUs) {
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
            } else if (kernelSpec.specFile && isGlobalKernelSpec && !isCreatedByUs) {
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

    public async findKernelSpecsInInterpreter(
        interpreter: PythonEnvironment,
        cancelToken: CancellationToken
    ): Promise<IJupyterKernelSpec[]> {
        const key = `${interpreter.id}${interpreter.sysPrefix}`;

        if (!this.kernelsPerInterpreter.has(key)) {
            const tokenSource = new CancellationTokenSource();
            this.disposables.push(tokenSource);
            const internalCancelToken = tokenSource.token;
            const promise = this.findKernelSpecsInInterpreterImpl(interpreter, internalCancelToken);
            promise.catch(() => {
                // If previous discovery failed, then do not cache a failure.
                if (this.kernelsPerInterpreter.get(key) === promise) {
                    this.kernelsPerInterpreter.delete(key);
                }
            });
            this.kernelsPerInterpreter.set(key, promise);
        }
        return Promise.race([
            this.kernelsPerInterpreter.get(key)!,
            createPromiseFromCancellation({ cancelAction: 'resolve', defaultValue: [], token: cancelToken })
        ]);
    }
    private async findKernelSpecsInInterpreterImpl(
        interpreter: PythonEnvironment,
        cancelToken: CancellationToken
    ): Promise<IJupyterKernelSpec[]> {
        traceVerbose(
            `Finding kernel specs for ${interpreter.id} interpreters: ${interpreter.displayName} => ${getDisplayPath(
                interpreter.uri
            )}`
        );
        // Find all the possible places to look for this resource
        const kernelSearchPath = Uri.file(path.join(interpreter.sysPrefix, baseKernelPath));
        const rootSpecPaths = await this.jupyterPaths.getKernelSpecRootPaths(cancelToken);
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
        traceVerbose(
            `Searching for kernel specs in interpreter ${interpreter.id} in path ${getDisplayPath(kernelSearchPath)}`
        );
        const kernelSpecs = await this.kernelSpecFinder.findKernelSpecsInPaths(kernelSearchPath, cancelToken);
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
                const kernelSpec = await this.kernelSpecFinder.loadKernelSpec(kernelSpecFile, cancelToken, interpreter);
                if (!kernelSpec) {
                    return;
                }
                // Sometimes we can have the same interpreter twice,
                // one with python310 and another with python, (these duplicate should ideally be removed by Python extension).
                // However given that these have been detected we should account for these,
                // Its not possible for the same kernel spec to be discovered twice and belong to two different interpreters.
                if (!kernelSpec.specFile || !this.discoveredKernelSpecFiles.has(kernelSpec.specFile)) {
                    results.push(kernelSpec);
                    kernelSpec.specFile && this.discoveredKernelSpecFiles.add(kernelSpec.specFile);
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
        traceVerbose(`Kernel Specs found in interpreter ${interpreter.id} are ${JSON.stringify(results)}`);
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
}
/**
 * Some python environments like conda can have non-python kernel specs as well, this will return those as well.
 * Those kernels can only be started within the context of the Python environment.
 * I.e. first activate the python environment, then attempt to start those non-python environments.
 * This is because some python environments setup environment variables required by these non-python kernels (e.g. path to Java executable or the like.
 */
export async function listPythonAndRelatedNonPythonKernelSpecs(
    interpreter: PythonEnvironment,
    cancelToken: CancellationToken,
    workspaceService: IWorkspaceService,
    interpreterService: IInterpreterService,
    jupyterPaths: JupyterPaths,
    interpreterKernelSpecFinder: InterpreterKernelSpecFinderHelper,
    globalKernelSpecs: LocalKernelSpecConnectionMetadata[]
): Promise<LocalKernelConnectionMetadata[]> {
    traceVerbose(`Listing Python & non-Python kernels for Interpreter ${getDisplayPath(interpreter.uri)}`);
    // First find the on disk kernel specs and interpreters
    const activeInterpreterInAWorkspacePromise = Promise.all(
        (workspaceService.workspaceFolders || []).map((folder) => interpreterService.getActiveInterpreter(folder.uri))
    );
    const [kernelSpecsBelongingToPythonEnvironment, activeInterpreters, tempDirForKernelSpecs] = await Promise.all([
        interpreterKernelSpecFinder.findKernelSpecsInInterpreter(interpreter, cancelToken),
        activeInterpreterInAWorkspacePromise,
        jupyterPaths.getKernelSpecTempRegistrationFolder()
    ]);
    if (cancelToken.isCancellationRequested) {
        return [];
    }
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
    let filteredInterpreters = [interpreter];

    // If the user has interpreters, then don't display the default kernel specs such as `python`, `python3`.
    // Such kernel specs are ambiguous, and we have absolutely no idea what interpreters they point to.
    // If a user wants to select a kernel they can pick an interpreter (this way we know exactly what interpreter needs to be started).
    // Else if you have `python3`, depending on the active/default interpreter we could start different interpreters (different for the same notebook opened from different workspace folders).

    // Then go through all of the kernels and generate their metadata
    const distinctKernelMetadata = new Map<string, LocalKernelConnectionMetadata>();

    // Go through the global kernelSpecs that use python to launch the kernel and that are not using ipykernel or have a custom environment
    const globalKernelSpecsLoadedForPython = new Set<string>();
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
                // We can't use any interpreter, because the module used is not `ipykernel_launcher`.
                // Its something special, hence ignore if we cannot find a matching interpreter.
                const matchingInterpreter = await interpreterKernelSpecFinder.findMatchingInterpreter(
                    item.kernelSpec,
                    true,
                    'startUsingLocalKernelSpec'
                );
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
                if (kernelSpec.kernelSpec.specFile) {
                    globalKernelSpecsLoadedForPython.add(kernelSpec.kernelSpec.specFile);
                }
            })
    );
    if (cancelToken.isCancellationRequested) {
        return [];
    }

    await Promise.all(
        [
            ...kernelSpecsBelongingToPythonEnvironment,
            ...globalPythonKernelSpecsRegisteredByUs.map((item) => item.kernelSpec)
        ]
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
                if (cancelToken.isCancellationRequested) {
                    return;
                }

                // Find the interpreter that matches. If we find one, we want to use
                // this to start the kernel.
                const matchingInterpreter = kernelSpecsBelongingToPythonEnvironment.includes(k)
                    ? interpreter
                    : await interpreterKernelSpecFinder.findMatchingInterpreter(
                          k,
                          false,
                          'startUsingPythonInterpreter'
                      );
                if (matchingInterpreter && isKernelLaunchedViaLocalPythonIPyKernel(k)) {
                    const result = PythonKernelConnectionMetadata.create({
                        kernelSpec: k,
                        interpreter: matchingInterpreter,
                        id: getKernelId(k, matchingInterpreter)
                    });
                    traceVerbose(`Interpreter for Local Python kernel ${result.id} is ${matchingInterpreter.id}`);

                    // Hide the interpreters from list of kernels unless the user created this kernel spec.
                    // Users can create their own kernels with custom environment variables, in such cases, we should list that
                    // kernel as well as the interpreter (so they can use both).
                    const kernelSpecKind = getKernelRegistrationInfo(result.kernelSpec);
                    if (
                        kernelSpecKind === 'registeredByNewVersionOfExt' ||
                        kernelSpecKind === 'registeredByOldVersionOfExt'
                    ) {
                        filteredInterpreters = filteredInterpreters.filter((i) => {
                            if (matchingInterpreter.id !== i.id) {
                                return true;
                            } else {
                                traceVerbose(
                                    `Hiding interpreter ${i.id} as it matches kernel spec ${k.name} and matching interpreter is ${matchingInterpreter.id}`
                                );
                                return false;
                            }
                        });
                    }

                    // Return our metadata that uses an interpreter to start
                    return result;
                } else {
                    const activeInterpreterOfAWorkspaceFolder = activeInterpreters.find((i) => !!i);
                    // Possible we already have interpreter information in the kernelSpec.
                    // E.g its possible this is a non-python kernelSpec that belongs to a Conda environment.
                    let kernelInterpreter =
                        (kernelSpecsBelongingToPythonEnvironment.includes(k) ? interpreter : undefined) ||
                        // NOTE: Defaulting to the active interpreter is hacky, but the only fall back we have.
                        // See here https://github.com/microsoft/vscode-jupyter/issues/12278
                        (k.language === PYTHON_LANGUAGE ? activeInterpreterOfAWorkspaceFolder : undefined);
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
                    if (k.language === PYTHON_LANGUAGE) {
                        if (kernelSpecInterpreterPath) {
                            foundRightInterpreter = false;
                            const interpreterInKernelSpec = activeInterpreters.find((item) =>
                                areInterpreterPathsSame(kernelSpecInterpreterPath, item?.uri)
                            );
                            if (interpreterInKernelSpec) {
                                // Found the exact interpreter as defined in metadata.
                                kernelInterpreter = interpreterInKernelSpec;
                            } else {
                                try {
                                    // Get the interpreter details as defined in the metadata.
                                    // Possible the kernel spec points to an interpreter in a different workspace folder or the like.
                                    kernelInterpreter = await interpreterService.getInterpreterDetails(
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
                            activeInterpreterOfAWorkspaceFolder === kernelInterpreter &&
                            !foundRightInterpreter
                        ) {
                            traceWarning(
                                `Kernel Spec ${k.id} in ${getDisplayPathFromLocalFile(
                                    k.specFile
                                )} has interpreter metadata but we couldn't find the interpreter, using best match of ${
                                    kernelInterpreter?.id
                                }`
                            );
                        }
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

    await Promise.all(
        filteredInterpreters.map(async (i) => {
            // Update spec to have a default spec file
            const spec = await createInterpreterKernelSpec(i, tempDirForKernelSpecs);
            const result = PythonKernelConnectionMetadata.create({
                kernelSpec: spec,
                interpreter: i,
                id: getKernelId(spec, i)
            });
            traceVerbose(`Kernel for interpreter ${i.id} is ${result.id}`);
            if (!distinctKernelMetadata.has(result.id)) {
                distinctKernelMetadata.set(result.id, result);
            }
        })
    );
    if (cancelToken.isCancellationRequested) {
        return [];
    }

    return Array.from(distinctKernelMetadata.values());
}
