// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable, named } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import * as uriPath from '../../../platform/vscode-path/resources';
import { CancellationToken, Memento, Uri } from 'vscode';
import { IPlatformService } from '../../../platform/common/platform/types';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { traceError } from '../../../platform/logging';
import { IDisposableRegistry, IMemento, GLOBAL_MEMENTO, IExtensionContext } from '../../../platform/common/types';
import { tryGetRealPath } from '../../../platform/common/utils.node';
import { IEnvironmentVariablesProvider } from '../../../platform/common/variables/types';
import { traceDecoratorVerbose } from '../../../platform/logging';
import { getUserHomeDir } from '../../../platform/common/utils/platform.node';
import { fsPathToUri } from '../../../platform/vscode-path/utils';
import { ResourceSet } from '../../../platform/vscode-path/map';
import { noop } from '../../../platform/common/utils/misc';

const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');
const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
const macJupyterPath = path.join('Library', 'Jupyter', 'kernels');
const winJupyterRuntimePath = path.join('AppData', 'Roaming', 'jupyter', 'runtime');
const winJupyterDataDirPath = path.join('AppData', 'Roaming', 'jupyter');
const macJupyterRuntimePath = path.join('Library', 'Jupyter', 'runtime');
const macJupyterDataDirPath = path.join('Library', 'Jupyter');

export const baseKernelPath = path.join('share', 'jupyter', 'kernels');
const CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH = 'CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH.';
const CACHE_KEY_FOR_JUPYTER_PATHS = 'CACHE_KEY_FOR_JUPYTER_PATHS_.';

@injectable()
export class JupyterPaths {
    private cachedKernelSpecRootPath?: Promise<Uri | undefined>;
    private cachedJupyterPaths?: Promise<Uri[]>;
    constructor(
        @inject(IPlatformService) private platformService: IPlatformService,
        @inject(IEnvironmentVariablesProvider) private readonly envVarsProvider: IEnvironmentVariablesProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode,
        @inject(IExtensionContext) private readonly context: IExtensionContext
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
     * Contains the name of the directory where the Jupyter extension will temporary register Kernels when using non-raw.
     * (this way we don't register kernels in global path).
     */
    public async getKernelSpecTempRegistrationFolder() {
        const dir = uriPath.joinPath(this.context.extensionUri, 'temp', 'jupyter', 'kernels');
        await this.fs.ensureLocalDir(dir.fsPath);
        return dir;
    }
    /**
     * This should return a WRITABLE place that jupyter will look for a kernel as documented
     * here: https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
     */
    @traceDecoratorVerbose('Getting Jupyter KernelSpec Root Path')
    public async getKernelSpecRootPath(): Promise<Uri | undefined> {
        this.cachedKernelSpecRootPath =
            this.cachedKernelSpecRootPath ||
            (async () => {
                const userHomeDir = getUserHomeDir();
                if (userHomeDir) {
                    if (this.platformService.isWindows) {
                        // On windows the path is not correct if we combine those variables.
                        // It won't point to a path that you can actually read from.
                        return tryGetRealPath(uriPath.joinPath(userHomeDir, winJupyterPath));
                    } else if (this.platformService.isMac) {
                        return uriPath.joinPath(userHomeDir, macJupyterPath);
                    } else {
                        return uriPath.joinPath(userHomeDir, linuxJupyterPath);
                    }
                }
            })();
        this.cachedKernelSpecRootPath
            .then((value) => {
                return this.updateCachedRootPath(value);
            })
            .ignoreErrors();
        if (this.getCachedRootPath()) {
            return this.getCachedRootPath();
        }
        return this.cachedKernelSpecRootPath;
    }
    /**
     * Returns the value for `JUPYTER_RUNTIME_DIR`, location where Jupyter stores runtime files.
     * Such as kernel connection files.
     */
    public async getRuntimeDir(): Promise<Uri | undefined> {
        let runtimeDir: Uri | undefined;
        const userHomeDir = getUserHomeDir();
        if (userHomeDir) {
            if (this.platformService.isWindows) {
                // On windows the path is not correct if we combine those variables.
                // It won't point to a path that you can actually read from.
                runtimeDir = await tryGetRealPath(uriPath.joinPath(userHomeDir, winJupyterRuntimePath));
            } else if (this.platformService.isMac) {
                runtimeDir = uriPath.joinPath(userHomeDir, macJupyterRuntimePath);
            } else {
                runtimeDir = process.env['$XDG_RUNTIME_DIR']
                    ? fsPathToUri(path.join(process.env['$XDG_RUNTIME_DIR'], 'jupyter', 'runtime'))
                    : uriPath.joinPath(userHomeDir, '.local', 'share', 'jupyter', 'runtime');
            }
        }
        if (!runtimeDir) {
            traceError(`Failed to determine Jupyter runtime directory`);
            return;
        }

        try {
            // Make sure the local file exists
            if (!(await this.fs.localDirectoryExists(runtimeDir.fsPath))) {
                await this.fs.ensureLocalDir(runtimeDir.fsPath);
            }
            return runtimeDir;
        } catch (ex) {
            traceError(`Failed to create runtime directory, reverting to temp directory ${runtimeDir}`, ex);
        }
    }
    /**
     * Returns the value for `JUPYTER_DATA_DIR`, location where Jupyter stores nbextensions files.
     */
    public async getDataDir(): Promise<Uri | undefined> {
        let dataDir: Uri | undefined;
        const userHomeDir = getUserHomeDir();
        if (userHomeDir) {
            if (this.platformService.isWindows) {
                // On windows the path is not correct if we combine those variables.
                // It won't point to a path that you can actually read from.
                dataDir = await tryGetRealPath(uriPath.joinPath(userHomeDir, winJupyterDataDirPath));
            } else if (this.platformService.isMac) {
                dataDir = uriPath.joinPath(userHomeDir, macJupyterDataDirPath);
            } else {
                dataDir = process.env['$XDG_DATA_HOME']
                    ? fsPathToUri(path.join(process.env['$XDG_DATA_HOME'], 'jupyter'))
                    : uriPath.joinPath(userHomeDir, '.local', 'share', 'jupyter');
            }
        }
        if (dataDir) {
            return dataDir;
        } else {
            traceError(`Failed to determine Jupyter runtime directory`);
        }
    }
    /**
     * This list comes from the docs here:
     * https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
     */
    @traceDecoratorVerbose('Get KernelSpec root path')
    public async getKernelSpecRootPaths(cancelToken?: CancellationToken): Promise<Uri[]> {
        // Paths specified in JUPYTER_PATH are supposed to come first in searching
        const paths = new ResourceSet(await this.getJupyterPathPaths(cancelToken));

        if (this.platformService.isWindows) {
            const winPath = await this.getKernelSpecRootPath();
            if (winPath) {
                paths.add(winPath);
            }

            if (process.env.ALLUSERSPROFILE) {
                paths.add(Uri.file(path.join(process.env.ALLUSERSPROFILE, 'jupyter', 'kernels')));
            }
        } else {
            // Unix based
            const secondPart = this.platformService.isMac ? macJupyterPath : linuxJupyterPath;

            paths.add(Uri.file(path.join('/', 'usr', 'share', 'jupyter', 'kernels')));
            paths.add(Uri.file(path.join('/', 'usr', 'local', 'share', 'jupyter', 'kernels')));
            const userHome = getUserHomeDir();
            if (userHome) {
                paths.add(uriPath.joinPath(userHome, secondPart));
            }
        }

        return Array.from(paths);
    }

    /**
     * Find any paths associated with the JUPYTER_PATH env var. Can be a list of dirs.
     * We need to look at the 'kernels' sub-directory and these paths are supposed to come first in the searching
     * https://jupyter.readthedocs.io/en/latest/projects/jupyter-directories.html#envvar-JUPYTER_PATH
     */
    @traceDecoratorVerbose('Get Jupyter Paths')
    private async getJupyterPathPaths(cancelToken?: CancellationToken): Promise<Uri[]> {
        this.cachedJupyterPaths =
            this.cachedJupyterPaths ||
            (async () => {
                const paths = new ResourceSet();
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
                        const realPath = await tryGetRealPath(Uri.file(jupyterPath));
                        if (realPath) {
                            paths.add(realPath);
                        }
                    });
                }

                return Array.from(paths);
            })();
        this.cachedJupyterPaths.then((value) => {
            if (value.length > 0) {
                this.updateCachedPaths(value).then(noop, noop);
            }
            if (this.getCachedPaths().length > 0) {
                return this.getCachedPaths();
            }
        }, noop);
        return this.cachedJupyterPaths;
    }

    private getCachedPaths(): Uri[] {
        return this.globalState.get<string[]>(CACHE_KEY_FOR_JUPYTER_PATHS, []).map((s) => Uri.parse(s));
    }

    private updateCachedPaths(paths: Uri[]) {
        return this.globalState.update(CACHE_KEY_FOR_JUPYTER_PATHS, paths.map(Uri.toString));
    }

    private getCachedRootPath(): Uri | undefined {
        if (this.globalState.get(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH)) {
            const cached = this.globalState.get<string>(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH);
            if (cached) {
                return Uri.parse(cached);
            }
        }
    }

    private updateCachedRootPath(path: Uri | undefined) {
        if (path) {
            this.globalState.update(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH, path.toString()).then(noop, noop);
        } else {
            this.globalState.update(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH, undefined).then(noop, noop);
        }
    }
}
