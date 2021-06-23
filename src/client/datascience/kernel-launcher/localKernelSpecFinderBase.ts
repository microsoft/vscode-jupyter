// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { CancellationToken } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceDecorators, traceError, traceInfo, traceInfoIf } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { ReadWrite, Resource } from '../../common/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { getInterpreterKernelSpecName, isKernelRegisteredByUs } from '../jupyter/kernels/helpers';
import { JupyterKernelSpec } from '../jupyter/kernels/jupyterKernelSpec';
import { KernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../jupyter/kernels/types';
import { IJupyterKernelSpec } from '../types';

type KernelSpecFileWithContainingInterpreter = { interpreter?: PythonEnvironment; kernelSpecFile: string };

@injectable()
export abstract class LocalKernelSpecFinderBase {
    private cache?: KernelSpecFileWithContainingInterpreter[];
    // Store our results when listing all possible kernelspecs for a resource
    private workspaceToMetadata = new Map<
        string,
        Promise<(KernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]>
    >();

    // Store any json file that we have loaded from disk before
    private pathToKernelSpec = new Map<string, Promise<IJupyterKernelSpec | undefined>>();

    constructor(
        @inject(IFileSystem) protected readonly fs: IFileSystem,
        @inject(IWorkspaceService) protected readonly workspaceService: IWorkspaceService
    ) {}

    @traceDecorators.error('List kernels failed')
    protected async listKernelsWithCache(
        resource: Resource,
        finder: () => Promise<(KernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]>
    ): Promise<(KernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]> {
        // Get an id for the workspace folder, if we don't have one, use the fsPath of the resource
        const workspaceFolderId =
            this.workspaceService.getWorkspaceFolderIdentifier(
                resource,
                resource?.fsPath || this.workspaceService.rootPath
            ) || 'root';

        // If we have already searched for this resource, then use that.
        const promise = this.workspaceToMetadata.get(workspaceFolderId);
        if (promise) {
            return promise;
        }

        this.workspaceToMetadata.set(
            workspaceFolderId,
            finder().then((items) => {
                const distinctKernelMetadata = new Map<
                    string,
                    KernelSpecConnectionMetadata | PythonKernelConnectionMetadata
                >();
                traceInfoIf(
                    !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                    `Kernel specs for ${resource?.toString() || 'undefined'} are \n ${JSON.stringify(
                        items,
                        undefined,
                        4
                    )}`
                );
                items.map((kernelSpec) => {
                    // Check if we have already seen this.
                    if (!distinctKernelMetadata.has(kernelSpec.id)) {
                        distinctKernelMetadata.set(kernelSpec.id, kernelSpec);
                    }
                });

                return Array.from(distinctKernelMetadata.values()).sort((a, b) => {
                    if (a.kernelSpec?.display_name === b.kernelSpec?.display_name) {
                        return 0;
                    } else {
                        return 1;
                    }
                });
            })
        );

        // ! as the has and set above verify that we have a return here
        return this.workspaceToMetadata.get(workspaceFolderId)!;
    }

    /**
     * Load the IJupyterKernelSpec for a given spec path, check the ones that we have already loaded first
     */
    protected async getKernelSpec(
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

    /**
     * Load kernelspec json from disk
     */
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

        // Possible user deleted the underlying kernel.
        const interpreterPath = interpreter?.path || kernelJson?.metadata?.interpreter?.path;
        if (
            isKernelRegisteredByUs(kernelSpec) &&
            interpreterPath &&
            !(await this.fs.localFileExists(interpreterPath))
        ) {
            return;
        }

        return kernelSpec;
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
