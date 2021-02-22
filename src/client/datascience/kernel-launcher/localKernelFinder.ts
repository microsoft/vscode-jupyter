// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type { nbformat } from '@jupyterlab/coreutils';
import { sha256 } from 'hash.js';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { CancellationToken } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { IWorkspaceService } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceDecorators, traceError, traceInfo, traceInfoIf, traceWarning } from '../../common/logger';
import { IFileSystem, IPlatformService } from '../../common/platform/types';
import { IPythonExecutionFactory } from '../../common/process/types';
import { IExtensionContext, IExtensions, IPathUtils, Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { IEnvironmentVariablesProvider } from '../../common/variables/types';
import { IInterpreterSelector } from '../../interpreter/configuration/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { captureTelemetry } from '../../telemetry';
import { getRealPath } from '../common';
import { Telemetry } from '../constants';
import { findPreferredKernelIndex } from '../jupyter/kernels/helpers';
import { JupyterKernelSpec } from '../jupyter/kernels/jupyterKernelSpec';
import {
    DefaultKernelConnectionMetadata,
    KernelConnectionMetadata,
    KernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../jupyter/kernels/types';
import { getInterpreterInfoStoredInMetadata } from '../notebookStorage/baseModel';
import { IJupyterKernelSpec } from '../types';
import { ILocalKernelFinder } from './types';

const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');
const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
const macJupyterPath = path.join('Library', 'Jupyter', 'kernels');
const baseKernelPath = path.join('share', 'jupyter', 'kernels');

const cacheFile = 'kernelSpecPaths.json';

type KernelSpecFileWithContainingInterpreter = { interpreterPath?: string; kernelSpecFile: string };

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

const isSimplePythonDisplayName = /python\s?\d?\.?\d?/;

// This class searches for a kernel that matches the given kernel name.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class LocalKernelFinder implements ILocalKernelFinder {
    private cache?: KernelSpecFileWithContainingInterpreter[];
    private cacheDirty = false;

    // Store our results when listing all possible kernelspecs for a resource
    private workspaceToMetadata = new Map<string, Promise<KernelConnectionMetadata[]>>();

    // Store any json file that we have loaded from disk before
    private pathToKernelSpec = new Map<string, Promise<IJupyterKernelSpec | undefined>>();

    constructor(
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IPlatformService) private platformService: IPlatformService,
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IPythonExecutionFactory) private readonly exeFactory: IPythonExecutionFactory,
        @inject(IEnvironmentVariablesProvider) private readonly envVarsProvider: IEnvironmentVariablesProvider,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IInterpreterSelector) private readonly interpreterSelector: IInterpreterSelector
    ) {}
    @traceDecorators.verbose('Find kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    public async findKernel(
        resource: Resource,
        option?: nbformat.INotebookMetadata | PythonEnvironment,
        _cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined> {
        // Get list of all of the specs
        const kernels = await this.listKernels(resource);

        // Always include the interpreter in the search if we can
        const interpreter =
            option && isInterpreter(option)
                ? option
                : resource && this.extensionChecker.isPythonExtensionInstalled
                ? await this.interpreterService.getActiveInterpreter(resource)
                : undefined;

        // Find the preferred kernel index from the list.
        const notebookMetadata = option && !isInterpreter(option) ? option : undefined;
        const preferred = findPreferredKernelIndex(kernels, resource, [], notebookMetadata, interpreter, undefined);
        if (preferred >= 0) {
            return kernels[preferred];
        }
    }

    // Search all our local file system locations for installed kernel specs and return them
    @captureTelemetry(Telemetry.KernelListingPerf)
    public async listKernels(resource: Resource): Promise<KernelConnectionMetadata[]> {
        // Get an id for the workspace folder, if we don't have one, use the fsPath of the resource
        const workspaceFolderId = this.workspaceService.getWorkspaceFolderIdentifier(
            resource,
            resource?.fsPath || this.workspaceService.rootPath
        );

        // If we have not already searched for this resource, then generate the search
        if (workspaceFolderId && !this.workspaceToMetadata.has(workspaceFolderId)) {
            this.workspaceToMetadata.set(workspaceFolderId, this.findResourceKernelMetadata(resource));
        }

        this.writeCache().ignoreErrors();

        // ! as the has and set above verify that we have a return here
        const promise = this.workspaceToMetadata.get(workspaceFolderId)!;
        return promise.then((items) => {
            traceInfoIf(
                !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                `Kernel specs for ${resource?.toString() || 'undefined'} are \n ${JSON.stringify(items)}`
            );
            return items;
        });
    }

    public clearCache(resource: Resource) {
        // Ideally we'd put a filewatcher on all of the kernel locations instead of this.

        // Get an id for the workspace folder, if we don't have one, use the fsPath of the resource
        const workspaceFolderId = this.workspaceService.getWorkspaceFolderIdentifier(
            resource,
            resource?.fsPath || this.workspaceService.rootPath
        );
        this.workspaceToMetadata.delete(workspaceFolderId);
    }

    private async findResourceKernelMetadata(resource: Resource): Promise<KernelConnectionMetadata[]> {
        // First find the on disk kernel specs and interpreters
        let [kernelSpecs, interpreters] = await Promise.all([
            this.findResourceKernelSpecs(resource),
            this.findResourceInterpreters(resource)
        ]);

        // Filter interpreters using the kernel specs
        interpreters = interpreters.filter((interpreter) => {
            // If the interpreter is registered as a kernel then don't inlcude it.
            if (
                kernelSpecs.find((installedKernel) => {
                    const kernelDisplayName = installedKernel.display_name || installedKernel.name || '';
                    // Possible user has a kernel named `Python` or `Python 3`.
                    // & if we have such a kernel, we should not display the corresponding interpreter.
                    if (
                        kernelDisplayName !== interpreter?.displayName &&
                        !isSimplePythonDisplayName.test(kernelDisplayName.toLowerCase())
                    ) {
                        return false;
                    }

                    // If the python kernel belongs to an existing interpreter with the same path,
                    // Or if the python kernel has the exact same path as the interpreter, then its a duplicate.
                    // Paths on windows can either contain \ or / Both work.
                    // Thus, C:\Python.exe is the same as C:/Python.exe
                    // In the kernelspec.json we could have paths in argv such as C:\\Python.exe or C:/Python.exe.
                    const interpreterPathToCheck = (interpreter?.path || '').replace(/\\/g, '/');
                    return (
                        this.fs.areLocalPathsSame(
                            ((installedKernel.argv || [])[0] || '').replace(/\\/g, '/'),
                            interpreterPathToCheck
                        ) ||
                        this.fs.areLocalPathsSame(
                            (
                                installedKernel.interpreterPath ||
                                installedKernel.metadata?.interpreter?.path ||
                                ''
                            ).replace(/\\/g, '/'),
                            interpreterPathToCheck
                        )
                    );
                })
            ) {
                return false;
            }
            return true;
        });

        // Combine the two into our list
        return [
            ...kernelSpecs.map((k) => {
                const result: KernelSpecConnectionMetadata = {
                    kind: 'startUsingKernelSpec',
                    kernelSpec: k
                };
                return result;
            }),
            ...interpreters.map((i) => {
                const result: PythonKernelConnectionMetadata = {
                    kind: 'startUsingPythonInterpreter',
                    kernelSpec: undefined,
                    interpreter: i
                };
                return result;
            })
        ];
    }

    private async findResourceKernelSpecs(resource: Resource): Promise<IJupyterKernelSpec[]> {
        const results: IJupyterKernelSpec[] = [];

        // Find all the possible places to look for this resource
        const paths = await this.findAllResourcePossibleKernelPaths(resource);
        const searchResults = await this.kernelGlobSearch(paths);

        await Promise.all(
            searchResults.map(async (resultPath) => {
                // Add these into our path cache to speed up later finds
                this.updateCache(resultPath);
                const kernelspec = await this.getKernelSpec(resultPath.kernelSpecFile, resultPath.interpreterPath);

                if (kernelspec) {
                    results.push(kernelspec);
                }
            })
        );

        return results;
    }

    private async findResourceInterpreters(resource: Resource): Promise<PythonEnvironment[]> {
        // Find all available interpreters
        const interpreters = this.extensionChecker.isPythonExtensionInstalled
            ? await this.interpreterSelector.getSuggestions(resource)
            : [];

        return interpreters.map((i) => i.interpreter);
    }

    // Load the IJupyterKernelSpec for a given spec path, check the ones that we have already loaded first
    private async getKernelSpec(specPath: string, interpreterPath?: string): Promise<IJupyterKernelSpec | undefined> {
        // If we have not already loaded this kernel spec, then load it
        if (!this.pathToKernelSpec.has(specPath)) {
            this.pathToKernelSpec.set(specPath, this.loadKernelSpec(specPath, interpreterPath));
        }

        // ! as the has and set above verify that we have a return here
        return this.pathToKernelSpec.get(specPath)!.then((value) => {
            if (value) {
                // Special case. Look at the kernel spec metadata. If it has an vscode.extension_id metadata and this
                // extension is installed, skip it. It means this kernel is owned by that other extension
                if (
                    value.metadata?.vscode?.extension_id &&
                    this.extensions.getExtension(value.metadata.vscode.extension_id)
                ) {
                    return undefined;
                }

                // Otherwise this is a valid value.
                return value;
            }

            // If we failed to get a kernelspec full path from our cache and loaded list
            this.pathToKernelSpec.delete(specPath);
            this.cache = this.cache?.filter((itempath) => itempath.kernelSpecFile !== specPath);
            return undefined;
        });
    }

    // Load kernelspec json from disk
    private async loadKernelSpec(specPath: string, interpreterPath?: string): Promise<IJupyterKernelSpec | undefined> {
        let kernelJson;
        try {
            traceInfo(`Loading kernelspec from ${specPath} for ${interpreterPath}`);
            kernelJson = JSON.parse(await this.fs.readLocalFile(specPath));
        } catch {
            traceError(`Failed to parse kernelspec ${specPath}`);
            return undefined;
        }
        const kernelSpec: IJupyterKernelSpec = new JupyterKernelSpec(kernelJson, specPath, interpreterPath);

        // Some registered kernel specs do not have a name, in this case use the last part of the path
        kernelSpec.name = kernelJson?.name || path.basename(path.dirname(specPath));
        return kernelSpec;
    }

    // For the given resource, find atll the file paths for kernel specs that wewant to associate with this
    private async findAllResourcePossibleKernelPaths(
        resource: Resource,
        _cancelToken?: CancellationToken
    ): Promise<(string | { interpreter: PythonEnvironment; kernelSearchPath: string })[]> {
        const [activeInterpreterPath, interpreterPaths, diskPaths] = await Promise.all([
            this.getActiveInterpreterPath(resource),
            this.getInterpreterPaths(resource),
            this.getDiskPaths()
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
        resource: Resource
    ): Promise<{ interpreter: PythonEnvironment; kernelSearchPath: string }[]> {
        if (this.extensionChecker.isPythonExtensionInstalled) {
            const interpreters = await this.interpreterService.getInterpreters(resource);
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
    private async getJupyterPathPaths(): Promise<string[]> {
        const paths: string[] = [];
        const vars = await this.envVarsProvider.getEnvironmentVariables();
        const jupyterPathVars = vars.JUPYTER_PATH
            ? vars.JUPYTER_PATH.split(path.delimiter).map((jupyterPath) => {
                  return path.join(jupyterPath, 'kernels');
              })
            : [];

        if (jupyterPathVars.length > 0) {
            if (this.platformService.isWindows) {
                const activeInterpreter = await this.getActiveInterpreter();
                if (activeInterpreter) {
                    jupyterPathVars.forEach(async (jupyterPath) => {
                        const jupyterWinPath = await getRealPath(
                            this.fs,
                            this.exeFactory,
                            activeInterpreter.path,
                            jupyterPath
                        );

                        if (jupyterWinPath) {
                            paths.push(jupyterWinPath);
                        }
                    });
                } else {
                    paths.push(...jupyterPathVars);
                }
            } else {
                // Unix based
                paths.push(...jupyterPathVars);
            }
        }

        return paths;
    }

    private async getActiveInterpreter(resource?: Resource): Promise<PythonEnvironment | undefined> {
        if (this.extensionChecker.isPythonExtensionInstalled) {
            return this.interpreterService.getActiveInterpreter(resource);
        }
        return undefined;
    }

    private async getDiskPaths(): Promise<string[]> {
        // Paths specified in JUPYTER_PATH are supposed to come first in searching
        const paths: string[] = await this.getJupyterPathPaths();

        if (this.platformService.isWindows) {
            const activeInterpreter = await this.getActiveInterpreter();
            if (activeInterpreter) {
                const winPath = await getRealPath(
                    this.fs,
                    this.exeFactory,
                    activeInterpreter.path,
                    path.join(this.pathUtils.home, winJupyterPath)
                );
                if (winPath) {
                    paths.push(winPath);
                }
            } else {
                paths.push(path.join(this.pathUtils.home, winJupyterPath));
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
        paths: (string | { interpreter: PythonEnvironment; kernelSearchPath: string })[]
    ): Promise<KernelSpecFileWithContainingInterpreter[]> {
        const searchResults = await Promise.all(
            paths.map((searchItem) => {
                const searchPath = typeof searchItem === 'string' ? searchItem : searchItem.kernelSearchPath;
                return this.fs.searchLocal(`**/kernel.json`, searchPath, true).then((kernelSpecFilesFound) => {
                    return {
                        interpreter: typeof searchItem === 'string' ? undefined : searchItem.interpreter,
                        kernelSpecFiles: kernelSpecFilesFound.map((item) => path.join(searchPath, item))
                    };
                });
            })
        );
        const kernelSpecFiles: KernelSpecFileWithContainingInterpreter[] = [];
        searchResults.forEach((item) => {
            for (const kernelSpecFile of item.kernelSpecFiles) {
                kernelSpecFiles.push({ interpreterPath: item.interpreter?.path, kernelSpecFile });
            }
        });

        return kernelSpecFiles;
    }

    private updateCache(newPath: KernelSpecFileWithContainingInterpreter) {
        this.cache = Array.isArray(this.cache) ? this.cache : [];
        if (
            !this.cache.find(
                (item) =>
                    item.interpreterPath === newPath.interpreterPath && item.kernelSpecFile === newPath.kernelSpecFile
            )
        ) {
            this.cache.push(newPath);
            this.cacheDirty = true;
        }
    }

    private async writeCache() {
        if (this.cacheDirty && Array.isArray(this.cache)) {
            await this.fs.writeLocalFile(
                path.join(this.context.globalStorageUri.fsPath, cacheFile),
                JSON.stringify(this.cache)
            );
            traceInfoIf(
                !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                `Kernel specs in cache ${JSON.stringify(this.cache)}`
            );
            this.cacheDirty = false;
        }
    }
}
