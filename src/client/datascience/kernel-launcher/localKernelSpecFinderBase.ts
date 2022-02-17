// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { CancellationToken } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { IWorkspaceService } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceDecorators, traceError, traceInfoIfCI, traceVerbose } from '../../common/logger';
import { getDisplayPath } from '../../common/platform/fs-paths';
import { IFileSystem } from '../../common/platform/types';
import { ReadWrite } from '../../common/types';
import { testOnlyMethod } from '../../common/utils/decorators';
import { ignoreLogging } from '../../logging/trace';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { getInterpreterKernelSpecName, getKernelRegistrationInfo } from '../jupyter/kernels/helpers';
import { JupyterKernelSpec } from '../jupyter/kernels/jupyterKernelSpec';
import { LocalKernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../jupyter/kernels/types';
import { IJupyterKernelSpec } from '../types';

type KernelSpecFileWithContainingInterpreter = { interpreter?: PythonEnvironment; kernelSpecFile: string };
export const isDefaultPythonKernelSpecSpecName = /python\s\d*.?\d*$/;
export const oldKernelsSpecFolderName = '__old_vscode_kernelspecs';

@injectable()
export abstract class LocalKernelSpecFinderBase {
    private cache?: KernelSpecFileWithContainingInterpreter[];
    // Store our results when listing all possible kernelspecs for a resource
    private kernelSpecCache = new Map<
        string,
        {
            usesPython: boolean;
            wasPythonExtInstalled: boolean;
            promise: Promise<(LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]>;
        }
    >();

    // Store any json file that we have loaded from disk before
    private pathToKernelSpec = new Map<string, Promise<IJupyterKernelSpec | undefined>>();

    constructor(
        @inject(IFileSystem) protected readonly fs: IFileSystem,
        @inject(IWorkspaceService) protected readonly workspaceService: IWorkspaceService,
        protected readonly extensionChecker: IPythonExtensionChecker
    ) {}

    @testOnlyMethod()
    public clearCache() {
        this.kernelSpecCache.clear();
    }
    /**
     * @param {boolean} dependsOnPythonExtension Whether this list of kernels fetched depends on whether the python extension is installed/not installed.
     * If for instance first Python Extension isn't installed, then we call this again, after installing it, then the cache will be blown away
     */
    @traceDecorators.error('List kernels failed')
    protected async listKernelsWithCache(
        cacheKey: string,
        dependsOnPythonExtension: boolean,
        @ignoreLogging() finder: () => Promise<(LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]>,
        ignoreCache?: boolean
    ): Promise<(LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]> {
        // If we have already searched for this resource, then use that.
        const result = this.kernelSpecCache.get(cacheKey);
        if (result && !ignoreCache) {
            // If python extension is now installed & was not installed previously, then ignore the previous cache.
            if (
                result.usesPython &&
                result.wasPythonExtInstalled === this.extensionChecker.isPythonExtensionInstalled
            ) {
                return result.promise;
            } else if (!result.usesPython) {
                return result.promise;
            }
        }
        const promise = finder().then((items) => {
            const distinctKernelMetadata = new Map<
                string,
                LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata
            >();
            traceInfoIfCI(
                `Kernel specs for ${cacheKey?.toString() || 'undefined'} are \n ${JSON.stringify(items, undefined, 4)}`
            );
            items.map((kernelSpec) => {
                // Check if we have already seen this.
                if (!distinctKernelMetadata.has(kernelSpec.id)) {
                    distinctKernelMetadata.set(kernelSpec.id, kernelSpec);
                }
            });

            return Array.from(distinctKernelMetadata.values()).sort((a, b) => {
                const nameA = a.kernelSpec.display_name.toUpperCase();
                const nameB = b.kernelSpec.display_name.toUpperCase();
                if (nameA === nameB) {
                    return 0;
                } else if (nameA < nameB) {
                    return -1;
                } else {
                    return 1;
                }
            });
        });
        // Keep track of whether Python extension was installed or not when fetching this list of kernels.
        // Next time if its installed then we can ignore this cache.
        const wasPythonExtInstalled = this.extensionChecker.isPythonExtensionInstalled;
        this.kernelSpecCache.set(cacheKey, { usesPython: dependsOnPythonExtension, promise, wasPythonExtInstalled });

        // ! as the has and set above verify that we have a return here
        return this.kernelSpecCache.get(cacheKey)!.promise;
    }

    /**
     * Load the IJupyterKernelSpec for a given spec path, check the ones that we have already loaded first
     */
    protected async getKernelSpec(
        specPath: string,
        interpreter?: PythonEnvironment,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined> {
        // This is a backup folder for old kernels created by us.
        if (specPath.includes(oldKernelsSpecFolderName)) {
            return;
        }
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

    /**
     * Load kernelspec json from disk
     */
    private async loadKernelSpec(
        specPath: string,
        interpreter?: PythonEnvironment,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined> {
        return loadKernelSpec(specPath, this.fs, interpreter, cancelToken);
    }
    // Given a set of paths, search for kernel.json files and return back the full paths of all of them that we find
    protected async findKernelSpecsInPaths(
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

/**
 * Load kernelspec json from disk
 */
export async function loadKernelSpec(
    specPath: string,
    fs: IFileSystem,
    interpreter?: PythonEnvironment,
    cancelToken?: CancellationToken
): Promise<IJupyterKernelSpec | undefined> {
    // This is a backup folder for old kernels created by us.
    if (specPath.includes(oldKernelsSpecFolderName)) {
        return;
    }
    let kernelJson: ReadWrite<IJupyterKernelSpec>;
    try {
        traceVerbose(`Loading kernelspec from ${getDisplayPath(specPath)} for ${getDisplayPath(interpreter?.path)}`);
        kernelJson = JSON.parse(await fs.readLocalFile(specPath));
    } catch (ex) {
        traceError(`Failed to parse kernelspec ${specPath}`, ex);
        return;
    }
    if (cancelToken?.isCancellationRequested) {
        return;
    }

    // Special case. If we have an interpreter path this means this spec file came
    // from an interpreter location (like a conda environment). Modify the name to make sure it fits
    // the kernel instead
    // kernelJson.originalName = kernelJson.name;
    kernelJson.name = interpreter ? getInterpreterKernelSpecName(interpreter) : kernelJson.name;

    // Update the display name too if we have an interpreter.
    const isDefaultPythonName = kernelJson.display_name.toLowerCase().match(isDefaultPythonKernelSpecSpecName);
    if (!isDefaultPythonName && kernelJson.language === PYTHON_LANGUAGE && kernelJson.argv.length > 2) {
        // Default kernel spec argv for Python kernels is `"python","-m","ipykernel_launcher","-f","{connection_file}"`
        // Some older versions had `ipykernel` instead of `ipykernel_launcher`
        // If its different, then use that as an identifier for the kernel name.
        const argv = kernelJson.argv
            .slice(1) // ignore python
            .map((arg) => arg.toLowerCase())
            .filter((arg) => !['-m', 'ipykernel', 'ipykernel_launcher', '-f', '{connection_file}'].includes(arg));
        if (argv.length) {
            kernelJson.name = `${kernelJson.name}.${argv.join('#')}`;
        }
    }
    kernelJson.metadata = kernelJson.metadata || {};
    kernelJson.metadata.vscode = kernelJson.metadata.vscode || {};
    if (!kernelJson.metadata.vscode.originalSpecFile) {
        kernelJson.metadata.vscode.originalSpecFile = specPath;
    }
    if (!kernelJson.metadata.vscode.originalDisplayName) {
        kernelJson.metadata.vscode.originalDisplayName = kernelJson.display_name;
    }
    if (kernelJson.metadata.originalSpecFile) {
        kernelJson.metadata.vscode.originalSpecFile = kernelJson.metadata.originalSpecFile;
        delete kernelJson.metadata.originalSpecFile;
    }

    const kernelSpec: IJupyterKernelSpec = new JupyterKernelSpec(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        kernelJson as any,
        specPath,
        // Interpreter information may be saved in the metadata (if this is a kernel spec created/registered by us).
        interpreter?.path || kernelJson?.metadata?.interpreter?.path,
        getKernelRegistrationInfo(kernelJson)
    );

    // Some registered kernel specs do not have a name, in this case use the last part of the path
    kernelSpec.name = kernelJson?.name || path.basename(path.dirname(specPath));

    // Possible user deleted the underlying kernel.
    const interpreterPath = interpreter?.path || kernelJson?.metadata?.interpreter?.path;
    if (interpreterPath && !(await fs.localFileExists(interpreterPath))) {
        return;
    }

    return kernelSpec;
}
