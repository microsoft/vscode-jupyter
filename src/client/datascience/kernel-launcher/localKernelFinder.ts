// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { CancellationToken } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { IWorkspaceService } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceDecorators, traceError, traceInfo, traceInfoIf } from '../../common/logger';
import { IFileSystem, IPlatformService } from '../../common/platform/types';
import { IPathUtils, ReadWrite, Resource } from '../../common/types';
import { IEnvironmentVariablesProvider } from '../../common/variables/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { captureTelemetry } from '../../telemetry';
import { Telemetry } from '../constants';
import {
    findPreferredKernel,
    createInterpreterKernelSpec,
    getDisplayNameOrNameOfKernelConnection,
    getInterpreterKernelSpecName,
    getKernelId
} from '../jupyter/kernels/helpers';
import { JupyterKernelSpec } from '../jupyter/kernels/jupyterKernelSpec';
import {
    KernelSpecConnectionMetadata,
    LocalKernelConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../jupyter/kernels/types';
import { IJupyterKernelSpec } from '../types';
import { ILocalKernelFinder } from './types';
import { getResourceType, tryGetRealPath } from '../common';
import { isPythonNotebook } from '../notebook/helpers/helpers';

const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');
const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
const macJupyterPath = path.join('Library', 'Jupyter', 'kernels');
const baseKernelPath = path.join('share', 'jupyter', 'kernels');

type KernelSpecFileWithContainingInterpreter = { interpreter?: PythonEnvironment; kernelSpecFile: string };

/**
 * Helper to ensure we can differentiate between two types in union types, keeping typing information.
 * (basically avoiding the need to case using `as`).
 * We cannot use `xx in` as jupyter uses `JSONObject` which is too broad and captures anything and everything.
 *
 * @param {(nbformat.IKernelspecMetadata | PythonEnvironment)} item
 * @returns {item is PythonEnvironment}
 */
export function isInterpreter(item: nbformat.INotebookMetadata | PythonEnvironment): item is PythonEnvironment {
    // Interpreters will not have a `display_name` property, but have `path` and `type` properties.
    return !!(item as PythonEnvironment).path && !(item as nbformat.INotebookMetadata).kernelspec?.display_name;
}

// This class searches for a kernel that matches the given kernel name.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class LocalKernelFinder implements ILocalKernelFinder {
    private cache?: KernelSpecFileWithContainingInterpreter[];
    // Store our results when listing all possible kernelspecs for a resource
    private workspaceToMetadata = new Map<string, Promise<LocalKernelConnectionMetadata[]>>();

    // Store any json file that we have loaded from disk before
    private pathToKernelSpec = new Map<string, Promise<IJupyterKernelSpec | undefined>>();

    constructor(
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IPlatformService) private platformService: IPlatformService,
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IEnvironmentVariablesProvider) private readonly envVarsProvider: IEnvironmentVariablesProvider,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
    ) {}
    @traceDecorators.verbose('Find kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    public async findKernel(
        resource: Resource,
        option?: nbformat.INotebookMetadata,
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata | undefined> {
        try {
            // Get list of all of the specs
            const kernels = await this.listKernels(resource, cancelToken);
            const isPythonNbOrInteractiveWindow =
                isPythonNotebook(option) || getResourceType(resource) === 'interactive';

            // Always include the interpreter in the search if we can
            const preferredInterpreter =
                option && isInterpreter(option)
                    ? option
                    : resource && isPythonNbOrInteractiveWindow && this.extensionChecker.isPythonExtensionInstalled
                    ? await this.interpreterService.getActiveInterpreter(resource)
                    : undefined;

            // Find the preferred kernel index from the list.
            const notebookMetadata = option && !isInterpreter(option) ? option : undefined;
            const preferred = findPreferredKernel(
                kernels,
                resource,
                [],
                notebookMetadata,
                preferredInterpreter,
                undefined
            );
            if (preferred) {
                traceInfoIf(
                    !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                    `findKernel found ${getDisplayNameOrNameOfKernelConnection(preferred)}`
                );
                return preferred as LocalKernelConnectionMetadata;
            }
        } catch (e) {
            traceError(`findKernel crashed: ${e} ${e.stack}`);
            return undefined;
        }
    }

    // Search all our local file system locations for installed kernel specs and return them
    @captureTelemetry(Telemetry.KernelListingPerf)
    public async listKernels(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata[]> {
        try {
            // Get an id for the workspace folder, if we don't have one, use the fsPath of the resource
            const workspaceFolderId =
                this.workspaceService.getWorkspaceFolderIdentifier(
                    resource,
                    resource?.fsPath || this.workspaceService.rootPath
                ) || 'root';

            // If we have not already searched for this resource, then generate the search
            if (workspaceFolderId && !this.workspaceToMetadata.has(workspaceFolderId)) {
                traceInfo(`IANHU listKernels for ${workspaceFolderId}`);
                this.workspaceToMetadata.set(
                    workspaceFolderId,
                    this.findResourceKernelMetadata(resource, cancelToken).then((items) => {
                        // traceInfoIf(
                        // !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                        // `Kernel specs for ${resource?.toString() || 'undefined'} are \n ${JSON.stringify(
                        // items,
                        // undefined,
                        // 4
                        // )}`
                        // );
                        traceInfo(
                            `Kernel specs for ${resource?.toString() || 'undefined'} are \n ${JSON.stringify(
                                items,
                                undefined,
                                4
                            )}`
                        );
                        return items;
                    })
                );
            }

            // ! as the has and set above verify that we have a return here
            return await this.workspaceToMetadata.get(workspaceFolderId)!;
        } catch (e) {
            traceError(`List kernels failed: ${e} ${e.stack}`);
            throw e;
        }
    }

    // This should return a WRITABLE place that jupyter will look for a kernel as documented
    // here: https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
    public async getKernelSpecRootPath(): Promise<string | undefined> {
        if (this.platformService.isWindows) {
            return tryGetRealPath(path.join(this.pathUtils.home, winJupyterPath));
        } else if (this.platformService.isMac) {
            return path.join(this.pathUtils.home, macJupyterPath);
        } else {
            return path.join(this.pathUtils.home, linuxJupyterPath);
        }
    }

    private async findResourceKernelMetadata(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata[]> {
        // First find the on disk kernel specs and interpreters
        const [kernelSpecs, interpreters, rootSpecPath, activeInterpreter] = await Promise.all([
            this.findResourceKernelSpecs(resource, cancelToken),
            this.findResourceInterpreters(resource, cancelToken),
            this.getKernelSpecRootPath(),
            this.getActiveInterpreter(resource)
        ]);

        // Copy the interpreter list. We need to filter out those items
        // which have matched one or more kernelspecs
        let filteredInterpreters = [...interpreters];

        // Then go through all of the kernels and generate their metadata
        const kernelMetadata = await Promise.all(
            kernelSpecs.map(async (k) => {
                // Find the interpreter that matches. If we find one, we want to use
                // this to start the kernel.
                const matchingInterpreter = this.findMatchingInterpreter(k, interpreters);
                if (matchingInterpreter) {
                    const result: PythonKernelConnectionMetadata = {
                        kind: 'startUsingPythonInterpreter',
                        kernelSpec: k,
                        interpreter: matchingInterpreter,
                        id: getKernelId(k, matchingInterpreter)
                    };

                    // If interpreters were found, remove them from the interpreter list we'll eventually
                    // return as interpreter only items
                    filteredInterpreters = filteredInterpreters.filter((i) => matchingInterpreter !== i);

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
                        this.extensionChecker.isPythonExtensionInstalled &&
                        k.metadata?.interpreter?.path &&
                        k.metadata?.interpreter?.path !== activeInterpreter?.path
                    ) {
                        interpreter = await this.interpreterService
                            .getInterpreterDetails(k.metadata?.interpreter?.path)
                            .catch((ex) => {
                                traceError(`Failed to get interpreter details for Kernel Spec ${k.specFile}`, ex);
                                return interpreter;
                            });
                    }
                    const result: KernelSpecConnectionMetadata = {
                        kind: 'startUsingKernelSpec',
                        kernelSpec: k,
                        interpreter,
                        id: getKernelId(k, interpreter)
                    };
                    return result;
                }
            })
        );

        // Combine the two into our list
        const results = [
            ...kernelMetadata,
            ...filteredInterpreters.map((i) => {
                // Update spec to have a default spec file
                const spec = createInterpreterKernelSpec(i, rootSpecPath);
                const result: PythonKernelConnectionMetadata = {
                    kind: 'startUsingPythonInterpreter',
                    kernelSpec: spec,
                    interpreter: i,
                    id: getKernelId(spec, i)
                };
                return result;
            })
        ];

        // Sort them so that the active interpreter comes first (if we have one for it).
        // This allows searches to prioritize this kernel first. If you sort for
        // a UI do it after this function is called.
        return results.sort((a, b) => {
            if (a.kernelSpec?.display_name === b.kernelSpec?.display_name) {
                return 0;
            } else if (
                a.interpreter?.path === activeInterpreter?.path &&
                a.kernelSpec?.display_name === activeInterpreter?.displayName
            ) {
                return -1;
            } else {
                return 1;
            }
        });
    }

    private findMatchingInterpreter(
        kernelSpec: IJupyterKernelSpec,
        interpreters: PythonEnvironment[]
    ): PythonEnvironment | undefined {
        // If we know for a fact that the kernel spec is a Non-Python kernel, then return nothing.
        if (kernelSpec.language && kernelSpec.language !== PYTHON_LANGUAGE) {
            traceInfoIf(
                !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                `Kernel ${kernelSpec.name} is not python based so does not have an interpreter.`
            );
            return;
        }
        // 1. Check if current interpreter has the same path
        const exactMatch = interpreters.find((i) => {
            if (
                kernelSpec.metadata?.interpreter?.path &&
                this.fs.areLocalPathsSame(kernelSpec.metadata?.interpreter?.path, i.path)
            ) {
                traceInfo(`Kernel ${kernelSpec.name} matches ${i.displayName} based on metadata path.`);
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
        const exactMatchBasedOnArgv = interpreters.find((i) => {
            if (
                pathInArgv &&
                path.basename(pathInArgv) !== pathInArgv &&
                this.fs.areLocalPathsSame(pathInArgv, i.path)
            ) {
                traceInfo(`Kernel ${kernelSpec.name} matches ${i.displayName} based on path in argv.`);
                return true;
            }
            return false;
        });
        if (exactMatchBasedOnArgv) {
            return exactMatchBasedOnArgv;
        }
        // 2. Check if `interpreterPath` is defined in kernel metadata.
        if (kernelSpec.interpreterPath) {
            const matchBasedOnInterpreterPath = interpreters.find((i) => {
                if (kernelSpec.interpreterPath && this.fs.areLocalPathsSame(kernelSpec.interpreterPath, i.path)) {
                    traceInfo(`Kernel ${kernelSpec.name} matches ${i.displayName} based on interpreter path.`);
                    return true;
                }
                return false;
            });
            if (matchBasedOnInterpreterPath) {
                return matchBasedOnInterpreterPath;
            }
        }

        return interpreters.find((i) => {
            // 3. Check display name
            if (kernelSpec.display_name === i.displayName) {
                traceInfo(`Kernel ${kernelSpec.name} matches ${i.displayName} based on display name.`);
                return true;
            }

            // We used to use Python 2 or Python 3 to match an interpreter based on version
            // but this seems too ambitious. The kernel spec should just launch with the default
            // python and no environment. Otherwise how do we know which interpreter is the best
            // match?
            traceInfoIf(
                !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                `Kernel ${kernelSpec.name} does not match ${i.displayName} interpreter.`
            );

            return false;
        });
    }

    private async findResourceKernelSpecs(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec[]> {
        let results: IJupyterKernelSpec[] = [];

        // Find all the possible places to look for this resource
        const paths = await this.findAllResourcePossibleKernelPaths(resource, cancelToken);
        const searchResults = await this.kernelGlobSearch(paths, cancelToken);

        await Promise.all(
            searchResults.map(async (resultPath) => {
                // Add these into our path cache to speed up later finds
                const kernelspec = await this.getKernelSpec(
                    resultPath.kernelSpecFile,
                    resultPath.interpreter,
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
            if (existing && existing.path !== r.path) {
                // This item is a dupe but has a different path to start the exe
                unique.push(r);
            } else if (!existing) {
                unique.push(r);
                byDisplayName.set(r.display_name, r);
            }
        });

        return unique;
    }

    private async findResourceInterpreters(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<PythonEnvironment[]> {
        // Find all available interpreters
        const interpreters = this.extensionChecker.isPythonExtensionInstalled
            ? await this.interpreterService.getInterpreters(resource)
            : [];
        if (cancelToken?.isCancellationRequested) {
            return [];
        }
        return interpreters;
    }

    // Load the IJupyterKernelSpec for a given spec path, check the ones that we have already loaded first
    private async getKernelSpec(
        specPath: string,
        interpreter?: PythonEnvironment,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined> {
        // If we have not already loaded this kernel spec, then load it
        if (!this.pathToKernelSpec.has(specPath)) {
            this.pathToKernelSpec.set(specPath, this.loadKernelSpec(specPath, interpreter, cancelToken));
        }

        // ! as the has and set above verify that we have a return here
        return this.pathToKernelSpec.get(specPath)!.then((value) => {
            if (value) {
                return value;
            }

            // If we failed to get a kernelspec full path from our cache and loaded list
            this.pathToKernelSpec.delete(specPath);
            this.cache = this.cache?.filter((itempath) => itempath.kernelSpecFile !== specPath);
            return undefined;
        });
    }

    // Load kernelspec json from disk
    private async loadKernelSpec(
        specPath: string,
        interpreter?: PythonEnvironment,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined> {
        let kernelJson: ReadWrite<IJupyterKernelSpec>;
        try {
            traceInfo(`Loading kernelspec from ${specPath} for ${interpreter?.path}`);
            kernelJson = JSON.parse(await this.fs.readLocalFile(specPath));
        } catch {
            traceError(`Failed to parse kernelspec ${specPath}`);
            return undefined;
        }
        if (cancelToken?.isCancellationRequested) {
            return undefined;
        }

        // Special case. If we have an interpreter path this means this spec file came
        // from an interpreter location (like a conda environment). Modify the name to make sure it fits
        // the kernel instead
        kernelJson.name = interpreter ? getInterpreterKernelSpecName(interpreter) : kernelJson.name;

        // Update the display name too if we have an interpreter.
        kernelJson.display_name =
            kernelJson.language === PYTHON_LANGUAGE
                ? interpreter?.displayName || kernelJson.display_name
                : kernelJson.display_name;

        const kernelSpec: IJupyterKernelSpec = new JupyterKernelSpec(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            kernelJson as any,
            specPath,
            // Interpreter information may be saved in the metadata (if this is a kernel spec created/registered by us).
            interpreter?.path || kernelJson?.metadata?.interpreter?.path
        );

        // Some registered kernel specs do not have a name, in this case use the last part of the path
        kernelSpec.name = kernelJson?.name || path.basename(path.dirname(specPath));
        return kernelSpec;
    }

    // For the given resource, find atll the file paths for kernel specs that wewant to associate with this
    private async findAllResourcePossibleKernelPaths(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<(string | { interpreter: PythonEnvironment; kernelSearchPath: string })[]> {
        const [activeInterpreterPath, interpreterPaths, diskPaths] = await Promise.all([
            this.getActiveInterpreterPath(resource),
            this.getInterpreterPaths(resource, cancelToken),
            this.getDiskPaths(cancelToken)
        ]);

        const kernelSpecPathsAlreadyListed = new Set<string>();
        const combinedInterpreterPaths = [...activeInterpreterPath, ...interpreterPaths].filter((item) => {
            if (kernelSpecPathsAlreadyListed.has(item.kernelSearchPath)) {
                return false;
            }
            kernelSpecPathsAlreadyListed.add(item.kernelSearchPath);
            return true;
        });

        const combinedKernelPaths: (
            | string
            | { interpreter: PythonEnvironment; kernelSearchPath: string }
        )[] = combinedInterpreterPaths;
        diskPaths.forEach((item) => {
            if (!kernelSpecPathsAlreadyListed.has(item)) {
                combinedKernelPaths.push(item);
            }
        });

        return combinedKernelPaths;
    }

    private async getActiveInterpreterPath(
        resource: Resource
    ): Promise<{ interpreter: PythonEnvironment; kernelSearchPath: string }[]> {
        const activeInterpreter = await this.getActiveInterpreter(resource);

        if (activeInterpreter) {
            return [
                {
                    interpreter: activeInterpreter,
                    kernelSearchPath: path.join(activeInterpreter.sysPrefix, 'share', 'jupyter', 'kernels')
                }
            ];
        }
        return [];
    }

    private async getInterpreterPaths(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<{ interpreter: PythonEnvironment; kernelSearchPath: string }[]> {
        if (this.extensionChecker.isPythonExtensionInstalled) {
            const interpreters = await this.interpreterService.getInterpreters(resource);
            if (cancelToken?.isCancellationRequested) {
                return [];
            }
            traceInfo(`Search all interpreters ${interpreters.map((item) => item.path).join(', ')}`);
            const interpreterPaths = new Set<string>();
            return interpreters
                .filter((interpreter) => {
                    if (interpreterPaths.has(interpreter.path)) {
                        return false;
                    }
                    interpreterPaths.add(interpreter.path);
                    return true;
                })
                .map((interpreter) => {
                    return {
                        interpreter,
                        kernelSearchPath: path.join(interpreter.sysPrefix, baseKernelPath)
                    };
                });
        }
        return [];
    }

    // Find any paths associated with the JUPYTER_PATH env var. Can be a list of dirs.
    // We need to look at the 'kernels' sub-directory and these paths are supposed to come first in the searching
    // https://jupyter.readthedocs.io/en/latest/projects/jupyter-directories.html#envvar-JUPYTER_PATH
    private async getJupyterPathPaths(cancelToken?: CancellationToken): Promise<string[]> {
        const paths: string[] = [];
        const vars = await this.envVarsProvider.getEnvironmentVariables();
        if (cancelToken?.isCancellationRequested) {
            return [];
        }
        const jupyterPathVars = vars.JUPYTER_PATH
            ? vars.JUPYTER_PATH.split(path.delimiter).map((jupyterPath) => {
                  return path.join(jupyterPath, 'kernels');
              })
            : [];

        if (jupyterPathVars.length > 0) {
            jupyterPathVars.forEach(async (jupyterPath) => {
                const realPath = await tryGetRealPath(jupyterPath);
                if (realPath) {
                    paths.push(realPath);
                }
            });
        }

        return paths;
    }

    private async getActiveInterpreter(resource?: Resource): Promise<PythonEnvironment | undefined> {
        if (this.extensionChecker.isPythonExtensionInstalled) {
            return this.interpreterService.getActiveInterpreter(resource);
        }
        return undefined;
    }

    // This list comes from the docs here:
    // https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
    private async getDiskPaths(cancelToken?: CancellationToken): Promise<string[]> {
        // Paths specified in JUPYTER_PATH are supposed to come first in searching
        const paths: string[] = await this.getJupyterPathPaths(cancelToken);

        if (this.platformService.isWindows) {
            const winPath = await this.getKernelSpecRootPath();
            if (winPath) {
                paths.push(winPath);
            }

            if (process.env.ALLUSERSPROFILE) {
                paths.push(path.join(process.env.ALLUSERSPROFILE, 'jupyter', 'kernels'));
            }
        } else {
            // Unix based
            const secondPart = this.platformService.isMac ? macJupyterPath : linuxJupyterPath;

            paths.push(
                path.join('/', 'usr', 'share', 'jupyter', 'kernels'),
                path.join('/', 'usr', 'local', 'share', 'jupyter', 'kernels'),
                path.join(this.pathUtils.home, secondPart)
            );
        }

        return paths;
    }

    // Given a set of paths, search for kernel.json files and return back the full paths of all of them that we find
    private async kernelGlobSearch(
        paths: (string | { interpreter: PythonEnvironment; kernelSearchPath: string })[],
        cancelToken?: CancellationToken
    ): Promise<KernelSpecFileWithContainingInterpreter[]> {
        const searchResults = await Promise.all(
            paths.map(async (searchItem) => {
                const searchPath = typeof searchItem === 'string' ? searchItem : searchItem.kernelSearchPath;
                if (await this.fs.localDirectoryExists(searchPath)) {
                    const files = await this.fs.searchLocal(`**/kernel.json`, searchPath, true);
                    return {
                        interpreter: typeof searchItem === 'string' ? undefined : searchItem.interpreter,
                        kernelSpecFiles: files.map((item) => path.join(searchPath, item))
                    };
                }
            })
        );
        if (cancelToken?.isCancellationRequested) {
            return [];
        }
        const kernelSpecFiles: KernelSpecFileWithContainingInterpreter[] = [];
        searchResults.forEach((item) => {
            if (item) {
                for (const kernelSpecFile of item.kernelSpecFiles) {
                    kernelSpecFiles.push({ interpreter: item.interpreter, kernelSpecFile });
                }
            }
        });

        return kernelSpecFiles;
    }
}
