// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import * as uriPath from '../../../platform/vscode-path/resources';
import { CancellationToken, Memento, Uri } from 'vscode';
import {
    createInterpreterKernelSpec,
    getKernelId,
    getKernelRegistrationInfo,
    isDefaultKernelSpec
} from '../../../kernels/helpers';
import {
    IJupyterKernelSpec,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../kernels/types';
import { LocalKernelSpecFinderBase } from './localKernelSpecFinderBase.node';
import { baseKernelPath, JupyterPaths } from './jupyterPaths.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfoIfCI, traceVerbose, traceError } from '../../../platform/logging';
import { getDisplayPath, getDisplayPathFromLocalFile } from '../../../platform/common/platform/fs-paths.node';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IMemento, GLOBAL_MEMENTO, Resource } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { areInterpreterPathsSame } from '../../../platform/pythonEnvironments/info/interpreter';
import { captureTelemetry, Telemetry } from '../../../telemetry';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { ResourceSet } from '../../../platform/vscode-path/map';

/**
 * Returns all Python kernels and any related kernels registered in the python environment.
 * If Python extension is not installed, this will return all Python kernels registered globally.
 * If Python extension is intalled,
 *     - This will return Python kernels regsitered by us in global locations.
 *     - This will return Python interpreters that can be started as kernels.
 *     - This will return any non-python kernels that are registered in Python environments (e.g. Java kernels within a conda environment)
 */
@injectable()
export class LocalPythonAndRelatedNonPythonKernelSpecFinder extends LocalKernelSpecFinderBase {
    constructor(
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IFileSystemNode) fs: IFileSystemNode,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(LocalKnownPathKernelSpecFinder)
        private readonly kernelSpecsFromKnownLocations: LocalKnownPathKernelSpecFinder,
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalState: Memento
    ) {
        super(fs, workspaceService, extensionChecker, globalState);
    }
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    public async listKernelSpecs(resource: Resource, ignoreCache?: boolean, cancelToken?: CancellationToken) {
        // Get an id for the workspace folder, if we don't have one, use the fsPath of the resource
        const workspaceFolderId =
            this.workspaceService.getWorkspaceFolderIdentifier(
                resource,
                resource?.fsPath || this.workspaceService.rootFolder?.fsPath
            ) || 'root';
        return this.listKernelsWithCache(
            workspaceFolderId,
            true,
            () => this.listKernelsImplementation(resource, cancelToken),
            ignoreCache
        );
    }
    private async listKernelsImplementation(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<(LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]> {
        const interpreters = this.extensionChecker.isPythonExtensionInstalled
            ? await this.interpreterService.getInterpreters(resource)
            : [];

        traceInfoIfCI(`Listing kernels for ${interpreters.length} interpreters`);
        // If we don't have Python extension installed or don't discover any Python interpreters
        // then list all of the global python kernel specs.
        if (interpreters.length === 0 || !this.extensionChecker.isPythonExtensionInstalled) {
            return this.listGlobalPythonKernelSpecs(false, cancelToken);
        } else {
            return this.listPythonAndRelatedNonPythonKernelSpecs(resource, interpreters, cancelToken);
        }
    }
    private async listGlobalPythonKernelSpecs(
        includeKernelsRegisteredByUs: boolean,
        cancelToken?: CancellationToken
    ): Promise<LocalKernelSpecConnectionMetadata[]> {
        const kernelSpecs = await this.kernelSpecsFromKnownLocations.listKernelSpecs(true, cancelToken);
        return (
            kernelSpecs
                .filter((item) => item.kernelSpec.language === PYTHON_LANGUAGE)
                // If there are any kernels that we registered (then don't return them).
                // Those were registered by us to start kernels from Jupyter extension (not stuff that user created).
                // We should only return global kernels the user created themselves, others will appear when searching for interprters.
                .filter((item) => (includeKernelsRegisteredByUs ? true : !getKernelRegistrationInfo(item.kernelSpec)))
                .map((item) => <LocalKernelSpecConnectionMetadata>item)
        );
    }
    /**
     * Some python environments like conda can have non-python kernel specs as well, this will return those as well.
     * Those kernels can only be started within the context of the Python environment.
     * I.e. first actiavte the python environment, then attempt to start those non-python environments.
     * This is because some python environments setup environment variables required by these non-python kernels (e.g. path to Java executable or the like.
     */
    private async listPythonAndRelatedNonPythonKernelSpecs(
        resource: Resource,
        interpreters: PythonEnvironment[],
        cancelToken?: CancellationToken
    ): Promise<(LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]> {
        // First find the on disk kernel specs and interpreters
        const [kernelSpecs, activeInterpreter, globalKernelSpecs, tempDirForKernelSpecs] = await Promise.all([
            this.findKernelSpecsInInterpreters(interpreters, cancelToken),
            this.interpreterService.getActiveInterpreter(resource),
            this.listGlobalPythonKernelSpecs(true, cancelToken),
            this.jupyterPaths.getKernelSpecTempRegistrationFolder()
        ]);
        const globalPythonKernelSpecsRegisteredByUs = globalKernelSpecs.filter((item) =>
            getKernelRegistrationInfo(item.kernelSpec)
        );
        // Possible there are Python kernels (language=python, but not necessarily using ipykernel).
        // E.g. cadabra2 is one such kernel (similar to powershell kernel but language is still python).
        const usingNonIpyKernelLauncher = (
            item: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata
        ) => {
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
        // which have matched one or more kernelspecs
        let filteredInterpreters = [...interpreters];

        // If the user has interpreters, then don't display the default kernel specs such as `python`, `python3`.
        // Such kernel specs are ambiguous, and we have absolutely no idea what interpreters they point to.
        // If a user wants to select a kernel they can pick an interpreter (this way we know exactly what interpreter needs to be started).
        // Else if you have `python3`, depending on the active/default interpreter we could start different interpreters (different for the same notebook opened from different workspace folders).
        const hideDefaultKernelSpecs = interpreters.length > 0 || activeInterpreter ? true : false;

        // Then go through all of the kernels and generate their metadata
        const distinctKernelMetadata = new Map<
            string,
            LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata
        >();

        // Go through the global kernelspecs that use python to launch the kernel and that are not using ipykernel or have a custom environment
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
                    // If we cannot find a matching interpreter, then too bad.
                    // We can't use any interpreter, because the module used is not `ipykernel_laucnher`.
                    // Its something special, hence ignore if we cannot find a matching interpreter.
                    const matchingInterpreter = await this.findMatchingInterpreter(item.kernelSpec, interpreters);
                    if (!matchingInterpreter) {
                        traceVerbose(
                            `Kernel Spec for ${
                                item.kernelSpec.display_name
                            } ignored as we cannot find a matching interpreter ${JSON.stringify(item)}`
                        );
                        return;
                    }
                    const kernelSpec: LocalKernelSpecConnectionMetadata = {
                        kind: 'startUsingLocalKernelSpec',
                        kernelSpec: item.kernelSpec,
                        interpreter: matchingInterpreter,
                        id: getKernelId(item.kernelSpec, matchingInterpreter)
                    };
                    distinctKernelMetadata.set(kernelSpec.id, kernelSpec);
                })
        );
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
                    // Find the interpreter that matches. If we find one, we want to use
                    // this to start the kernel.
                    const matchingInterpreter = await this.findMatchingInterpreter(k, interpreters);
                    if (matchingInterpreter) {
                        const result: PythonKernelConnectionMetadata = {
                            kind: 'startUsingPythonInterpreter',
                            kernelSpec: k,
                            interpreter: matchingInterpreter,
                            id: getKernelId(k, matchingInterpreter)
                        };

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
                        let interpreter = k.language === PYTHON_LANGUAGE ? activeInterpreter : undefined;
                        // If the interpreter information is stored in kernelspec.json then use that to determine the interpreter.
                        // This can happen under the following circumstances:
                        // 1. Open workspace folder XYZ, and create a virtual environment named venvA
                        // 2. Now assume we don't have raw kernels, and a kernel gets registered for venvA in kernelspecs folder.
                        // 3. The kernel spec will contain metadata pointing to venvA.
                        // 4. Now open a different folder (e.g. a sub directory of XYZ or a completely different folder).
                        // 5. Now venvA will not be listed as an interpreter as Python will not discover this.
                        // 6. However the kernel we registered against venvA will be in global kernels folder
                        // In such an instance the interpreter information is stored in the kernelspec.json file.
                        if (
                            k.language === PYTHON_LANGUAGE &&
                            k.metadata?.interpreter?.path &&
                            !areInterpreterPathsSame(Uri.file(k.metadata?.interpreter?.path), activeInterpreter?.uri)
                        ) {
                            try {
                                interpreter = await this.interpreterService.getInterpreterDetails(
                                    Uri.file(k.metadata?.interpreter?.path)
                                );
                            } catch (ex) {
                                traceError(
                                    `Failed to get interpreter details for Kernel Spec ${getDisplayPathFromLocalFile(
                                        k.specFile
                                    )} with interpreter path ${getDisplayPath(
                                        Uri.file(k.metadata?.interpreter?.path)
                                    )}`,
                                    ex
                                );
                                return;
                            }
                        }
                        const result: LocalKernelSpecConnectionMetadata = {
                            kind: 'startUsingLocalKernelSpec',
                            kernelSpec: k,
                            interpreter,
                            id: getKernelId(k, interpreter)
                        };
                        return result;
                    }
                })
                .map(async (item) => {
                    const kernelSpec: undefined | LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata =
                        await item;
                    // Check if we have already seen this.
                    if (kernelSpec && !distinctKernelMetadata.has(kernelSpec.id)) {
                        distinctKernelMetadata.set(kernelSpec.id, kernelSpec);
                    }
                })
        );

        // Combine the two into our list
        const results = [
            ...Array.from(distinctKernelMetadata.values()),
            ...filteredInterpreters.map((i) => {
                // Update spec to have a default spec file
                const spec = createInterpreterKernelSpec(i, tempDirForKernelSpecs);
                const result: PythonKernelConnectionMetadata = {
                    kind: 'startUsingPythonInterpreter',
                    kernelSpec: spec,
                    interpreter: i,
                    id: getKernelId(spec, i)
                };
                return result;
            })
        ];

        return results.sort((a, b) => {
            if (a.kernelSpec.display_name.toUpperCase() === b.kernelSpec.display_name.toUpperCase()) {
                return 0;
            } else if (
                areInterpreterPathsSame(a.interpreter?.uri, activeInterpreter?.uri) &&
                a.kernelSpec.display_name.toUpperCase() === activeInterpreter?.displayName?.toUpperCase()
            ) {
                return -1;
            } else {
                return 1;
            }
        });
    }

    private async findMatchingInterpreter(
        kernelSpec: IJupyterKernelSpec,
        interpreters: PythonEnvironment[]
    ): Promise<PythonEnvironment | undefined> {
        // If we know for a fact that the kernel spec is a Non-Python kernel, then return nothing.
        if (kernelSpec.language && kernelSpec.language !== PYTHON_LANGUAGE) {
            traceInfoIfCI(`Kernel ${kernelSpec.name} is not python based so does not have an interpreter.`);
            return;
        }
        // 1. Check if current interpreter has the same path
        const exactMatch = interpreters.find((i) => {
            if (
                kernelSpec.metadata?.interpreter?.path &&
                areInterpreterPathsSame(Uri.file(kernelSpec.metadata?.interpreter?.path), i.uri)
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
            const interpreterInArgv = await this.interpreterService.getInterpreterDetails(Uri.file(pathInArgv));
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
        cancelToken?: CancellationToken
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
        // Exclude the glbal paths from the list.
        // What could happens is, we could have a global python interpreter and that returns a global path.
        // But we could have a kernel spec in global path that points to a completely different interpreter.
        // We already have a way of identifying the interpreter associated with a global kernelspec.
        // Hence exclude global paths from the list of interpreter specific paths (as global paths are NOT interpreter specific).
        const paths = interpreterPaths.filter(
            (item) => !rootSpecPaths.find((i) => uriPath.isEqual(i, item.kernelSearchPath))
        );

        const searchResults = await this.findKernelSpecsInPaths(paths, cancelToken);
        let results: IJupyterKernelSpec[] = [];
        await Promise.all(
            searchResults.map(async (resultPath) => {
                // Add these into our path cache to speed up later finds
                const kernelspec = await this.getKernelSpec(
                    resultPath.kernelSpecFile,
                    resultPath.interpreter,
                    globalSpecRootPath,
                    cancelToken
                );

                if (kernelspec) {
                    results.push(kernelspec);
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
                originalSpecFiles.add(r.metadata?.originalSpecFile);
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
