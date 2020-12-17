// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { CancellationToken } from 'vscode';

import { IPythonExtensionChecker } from '../../api/types';
import { IWorkspaceService } from '../../common/application/types';
import { traceDecorators, traceError, traceInfo, traceWarning } from '../../common/logger';
import { IFileSystem, IPlatformService } from '../../common/platform/types';
import { IPythonExecutionFactory } from '../../common/process/types';
import { IExtensionContext, IPathUtils, Resource } from '../../common/types';
import { IEnvironmentVariablesProvider } from '../../common/variables/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { captureTelemetry } from '../../telemetry';
import { getRealPath } from '../common';
import { Telemetry } from '../constants';
import { JupyterKernelSpec } from '../jupyter/kernels/jupyterKernelSpec';
import { IJupyterKernelSpec } from '../types';
import { IKernelFinder } from './types';

const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');
const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
const macJupyterPath = path.join('Library', 'Jupyter', 'kernels');
const baseKernelPath = path.join('share', 'jupyter', 'kernels');

const cacheFile = 'kernelSpecPaths.json';

type KernelSpecFileWithContainingInterpreter = { interpreterPath?: string; kernelSpecFile: string };

// This class searches for a kernel that matches the given kernel name.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
// If a kernel name is not given, it returns a default IJupyterKernelSpec created from the current interpreter.
// Before returning the IJupyterKernelSpec it makes sure that ipykernel is installed into the kernel spec interpreter
@injectable()
export class KernelFinder implements IKernelFinder {
    private cache?: KernelSpecFileWithContainingInterpreter[];
    private cacheDirty = false;

    // Store our results when listing all possible kernelspecs for a resource
    private workspaceToKernels = new Map<string, Promise<IJupyterKernelSpec[]>>();

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
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
    ) {}
    @traceDecorators.verbose('Find kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    public async findKernelSpec(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata
    ): Promise<IJupyterKernelSpec | undefined> {
        traceInfo(
            `Searching for kernel based on ${JSON.stringify(notebookMetadata?.kernelspec || {})} for ${
                resource?.fsPath || ''
            }`
        );
        await this.readCache();

        const searchBasedOnKernelSpecMetadata = this.findKernelSpecBasedOnKernelSpecMetadata(
            resource,
            notebookMetadata && notebookMetadata.kernelspec ? notebookMetadata.kernelspec : undefined
        );

        if (!notebookMetadata || notebookMetadata.kernelspec || !notebookMetadata.language_info?.name) {
            return searchBasedOnKernelSpecMetadata;
        }

        // If given a language, then find based on language else revert to default behaviour.
        const searchBasedOnLanguage = await this.findKernelSpecBasedOnLanguage(
            resource,
            notebookMetadata.language_info.name
        );
        // If none found based on language, then return the default.s
        return searchBasedOnLanguage || searchBasedOnKernelSpecMetadata;
    }
    // Search all our local file system locations for installed kernel specs and return them
    @captureTelemetry(Telemetry.KernelListingPerf)
    public async listKernelSpecs(resource: Resource): Promise<IJupyterKernelSpec[]> {
        if (!resource) {
            // We need a resource to search for related kernel specs
            return [];
        }

        // Get an id for the workspace folder, if we don't have one, use the fsPath of the resource
        const workspaceFolderId = this.workspaceService.getWorkspaceFolderIdentifier(resource, resource.fsPath);

        // If we have not already searched for this resource, then generate the search
        if (!this.workspaceToKernels.has(workspaceFolderId)) {
            this.workspaceToKernels.set(workspaceFolderId, this.findResourceKernelSpecs(resource));
        }

        this.writeCache().ignoreErrors();

        // ! as the has and set above verify that we have a return here
        return this.workspaceToKernels.get(workspaceFolderId)!;
    }

    private async findKernelSpecBasedOnKernelSpecMetadata(
        resource: Resource,
        kernelSpecMetadata?: nbformat.IKernelspecMetadata
    ) {
        if (!kernelSpecMetadata || !kernelSpecMetadata?.name) {
            return;
        }

        try {
            let kernelSpec = await this.searchCache(kernelSpecMetadata);
            if (kernelSpec) {
                return kernelSpec;
            }

            // Check in active interpreter first
            kernelSpec = await this.getKernelSpecFromActiveInterpreter(kernelSpecMetadata, resource);

            if (kernelSpec) {
                return kernelSpec;
            }

            const diskSearch = this.findDiskPath(kernelSpecMetadata);
            const interpreterSearch = this.getInterpreterPaths(resource).then((interpreterPaths) =>
                this.findInterpreterPath(interpreterPaths, kernelSpecMetadata)
            );

            let result = await Promise.race([diskSearch, interpreterSearch]);
            if (!result) {
                const both = await Promise.all([diskSearch, interpreterSearch]);
                result = both[0] ? both[0] : both[1];
            }

            return result;
        } finally {
            this.writeCache().ignoreErrors();
        }
    }

    @traceDecorators.verbose('Find kernel spec based on language')
    private async findKernelSpecBasedOnLanguage(resource: Resource, language: string) {
        const specs = await this.listKernelSpecs(resource);
        return specs.find((item) => item.language?.toLowerCase() === language.toLowerCase());
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

    // Load the IJupyterKernelSpec for a given spec path, check the ones that we have already loaded first
    private async getKernelSpec(specPath: string, interpreterPath?: string): Promise<IJupyterKernelSpec | undefined> {
        // If we have not already loaded this kernel spec, then load it
        if (!this.pathToKernelSpec.has(specPath)) {
            this.pathToKernelSpec.set(specPath, this.loadKernelSpec(specPath, interpreterPath));
        }

        // ! as the has and set above verify that we have a return here
        return this.pathToKernelSpec.get(specPath)!.then((value) => {
            if (value) {
                return value;
            }

            // If we failed to get a kernelspec pull path from our cache and loaded list
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
            // eslint-disable-next-line no-console
            console.debug(`Search all interpreters ${interpreters.map((item) => item.path).join(', ')}`);
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

    private async getKernelSpecFromActiveInterpreter(
        kernelSpecMetadata: nbformat.IKernelspecMetadata,
        resource: Resource
    ): Promise<IJupyterKernelSpec | undefined> {
        const activePath = await this.getActiveInterpreterPath(resource);
        return this.getKernelSpecFromDisk(activePath, kernelSpecMetadata);
    }

    private async findInterpreterPath(
        interpreterPaths: { interpreter: PythonEnvironment; kernelSearchPath: string }[],
        kernelSpecMetadata?: nbformat.IKernelspecMetadata
    ): Promise<IJupyterKernelSpec | undefined> {
        const kernelSpecs = await Promise.all(
            interpreterPaths.map(async (item) => {
                const kernelSpec = await this.getKernelSpecFromDisk([item.kernelSearchPath], kernelSpecMetadata);
                if (!kernelSpec) {
                    return;
                }
                return {
                    ...kernelSpec,
                    interpreterPath: item.interpreter.path
                };
            })
        );

        return kernelSpecs.find((item) => item !== undefined);
    }

    // Jupyter looks for kernels in these paths:
    // https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
    private async findDiskPath(
        kernelSpecMetadata?: nbformat.IKernelspecMetadata
    ): Promise<IJupyterKernelSpec | undefined> {
        const paths = await this.getDiskPaths();

        return this.getKernelSpecFromDisk(paths, kernelSpecMetadata);
    }

    private async getKernelSpecFromDisk(
        paths: (string | { interpreter: PythonEnvironment; kernelSearchPath: string })[],
        kernelSpecMetadata?: nbformat.IKernelspecMetadata
    ): Promise<IJupyterKernelSpec | undefined> {
        const searchResults = await this.kernelGlobSearch(paths);
        searchResults.forEach((specPath) => {
            this.updateCache(specPath);
        });

        return this.searchCache(kernelSpecMetadata);
    }

    private async readCache(): Promise<void> {
        try {
            if (Array.isArray(this.cache) && this.cache.length > 0) {
                return;
            }
            this.cache = [];
            this.cache = JSON.parse(
                await this.fs.readLocalFile(path.join(this.context.globalStorageUri.fsPath, cacheFile))
            );
        } catch {
            traceInfo('No kernelSpec cache found.');
        }
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
            this.cacheDirty = false;
        }
    }

    private async searchCache(
        kernelSpecMetadata?: nbformat.IKernelspecMetadata
    ): Promise<IJupyterKernelSpec | undefined> {
        if (!this.cache || !kernelSpecMetadata?.name) {
            return;
        }
        const items = await Promise.all(
            this.cache
                .filter((kernelPath) => {
                    try {
                        return path.basename(path.dirname(kernelPath.kernelSpecFile)) === kernelSpecMetadata.name;
                    } catch (e) {
                        traceInfo('KernelSpec path in cache is not a string.', e);
                        return false;
                    }
                })
                .map((kernelJsonFile) =>
                    this.getKernelSpec(kernelJsonFile.kernelSpecFile, kernelJsonFile.interpreterPath)
                )
        );
        const kernelSpecsWithSameName = items.filter((item) => !!item).map((item) => item!);
        switch (kernelSpecsWithSameName.length) {
            case 0:
                return undefined;
            case 1:
                return kernelSpecsWithSameName[0];
            default: {
                const matchingKernelSpec = kernelSpecsWithSameName.find(
                    (item) => item.display_name === kernelSpecMetadata.display_name
                );
                if (!matchingKernelSpec) {
                    traceWarning(
                        `Multiple kernels with the same name. Defaulting to first kernel. Unable to find the kernelspec with the display name '${kernelSpecMetadata?.display_name}'`
                    );
                }
                return matchingKernelSpec || kernelSpecsWithSameName[0];
            }
        }
    }
}
