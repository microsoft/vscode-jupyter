// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { CancellationToken } from 'vscode';
import { IPlatformService } from '../../common/platform/types';
import { IPathUtils } from '../../common/types';
import { IEnvironmentVariablesProvider } from '../../common/variables/types';
import { tryGetRealPath } from '../common';

const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');
const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
const macJupyterPath = path.join('Library', 'Jupyter', 'kernels');
export const baseKernelPath = path.join('share', 'jupyter', 'kernels');

@injectable()
export class JupyterPaths {
    constructor(
        @inject(IPlatformService) private platformService: IPlatformService,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils,
        @inject(IEnvironmentVariablesProvider) private readonly envVarsProvider: IEnvironmentVariablesProvider
    ) {}

    /**
     * This should return a WRITABLE place that jupyter will look for a kernel as documented
     * here: https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
     */
    public async getKernelSpecRootPath(): Promise<string | undefined> {
        if (this.platformService.isWindows) {
            // On windows the path is not correct if we combine those variables.
            // It won't point to a path that you can actually read from.
            return tryGetRealPath(path.join(this.pathUtils.home, winJupyterPath));
        } else if (this.platformService.isMac) {
            return path.join(this.pathUtils.home, macJupyterPath);
        } else {
            return path.join(this.pathUtils.home, linuxJupyterPath);
        }
    }
    /**
     * This list comes from the docs here:
     * https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
     */
    public async getKernelSpecRootPaths(cancelToken?: CancellationToken): Promise<string[]> {
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

    /**
     * Find any paths associated with the JUPYTER_PATH env var. Can be a list of dirs.
     * We need to look at the 'kernels' sub-directory and these paths are supposed to come first in the searching
     * https://jupyter.readthedocs.io/en/latest/projects/jupyter-directories.html#envvar-JUPYTER_PATH
     */
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
}
