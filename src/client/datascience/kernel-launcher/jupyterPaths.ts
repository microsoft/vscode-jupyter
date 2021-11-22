// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import { CancellationToken, Memento } from 'vscode';
import { IPlatformService } from '../../common/platform/types';
import { GLOBAL_MEMENTO, IDisposableRegistry, IMemento, IPathUtils } from '../../common/types';
import { IEnvironmentVariablesProvider } from '../../common/variables/types';
import { traceDecorators } from '../../logging';
import { tryGetRealPath } from '../common';

const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');
const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
const macJupyterPath = path.join('Library', 'Jupyter', 'kernels');
export const baseKernelPath = path.join('share', 'jupyter', 'kernels');
const CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH = 'CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH';
const CACHE_KEY_FOR_JUPYTER_PATHS = 'CACHE_KEY_FOR_JUPYTER_PATHS_';

@injectable()
export class JupyterPaths {
    private cachedKernelSpecRootPath?: Promise<string | undefined>;
    private cachedJupyterPaths?: Promise<string[]>;
    constructor(
        @inject(IPlatformService) private platformService: IPlatformService,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils,
        @inject(IEnvironmentVariablesProvider) private readonly envVarsProvider: IEnvironmentVariablesProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento
    ) {
        this.envVarsProvider.onDidEnvironmentVariablesChange(
            () => {
                this.cachedJupyterPaths = undefined;
            },
            this,
            disposables
        );
    }

    /**
     * This should return a WRITABLE place that jupyter will look for a kernel as documented
     * here: https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
     */
    @traceDecorators.verbose('Getting Jupyter KernelSpec Root Path')
    public async getKernelSpecRootPath(): Promise<string | undefined> {
        this.cachedKernelSpecRootPath =
            this.cachedKernelSpecRootPath ||
            (async () => {
                if (this.platformService.isWindows) {
                    // On windows the path is not correct if we combine those variables.
                    // It won't point to a path that you can actually read from.
                    return tryGetRealPath(path.join(this.pathUtils.home, winJupyterPath));
                } else if (this.platformService.isMac) {
                    return path.join(this.pathUtils.home, macJupyterPath);
                } else {
                    return path.join(this.pathUtils.home, linuxJupyterPath);
                }
            })();
        void this.cachedKernelSpecRootPath.then((value) => {
            if (value) {
                void this.globalState.update(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH, value);
            }
        });
        if (this.globalState.get(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH)) {
            return this.globalState.get(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH);
        }
        return this.cachedKernelSpecRootPath;
    }
    /**
     * This list comes from the docs here:
     * https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
     */
    @traceDecorators.verbose('Get Kernelspec root path')
    public async getKernelSpecRootPaths(cancelToken?: CancellationToken): Promise<string[]> {
        // Paths specified in JUPYTER_PATH are supposed to come first in searching
        const paths = new Set<string>(await this.getJupyterPathPaths(cancelToken));

        if (this.platformService.isWindows) {
            const winPath = await this.getKernelSpecRootPath();
            if (winPath) {
                paths.add(winPath);
            }

            if (process.env.ALLUSERSPROFILE) {
                paths.add(path.join(process.env.ALLUSERSPROFILE, 'jupyter', 'kernels'));
            }
        } else {
            // Unix based
            const secondPart = this.platformService.isMac ? macJupyterPath : linuxJupyterPath;

            paths.add(path.join('/', 'usr', 'share', 'jupyter', 'kernels'));
            paths.add(path.join('/', 'usr', 'local', 'share', 'jupyter', 'kernels'));
            paths.add(path.join(this.pathUtils.home, secondPart));
        }

        return Array.from(paths);
    }

    /**
     * Find any paths associated with the JUPYTER_PATH env var. Can be a list of dirs.
     * We need to look at the 'kernels' sub-directory and these paths are supposed to come first in the searching
     * https://jupyter.readthedocs.io/en/latest/projects/jupyter-directories.html#envvar-JUPYTER_PATH
     */
    @traceDecorators.verbose('Get Jupyter Paths')
    private async getJupyterPathPaths(cancelToken?: CancellationToken): Promise<string[]> {
        this.cachedJupyterPaths =
            this.cachedJupyterPaths ||
            (async () => {
                const paths = new Set<string>();
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
                            paths.add(realPath);
                        }
                    });
                }

                return Array.from(paths);
            })();
        void this.cachedJupyterPaths.then((value) => {
            if (value.length > 0) {
                void this.globalState.update(CACHE_KEY_FOR_JUPYTER_PATHS, value);
            }
        });
        if (this.globalState.get<string[]>(CACHE_KEY_FOR_JUPYTER_PATHS, []).length > 0) {
            return this.globalState.get<string[]>(CACHE_KEY_FOR_JUPYTER_PATHS, []);
        }
        return this.cachedJupyterPaths;
    }
}
