// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import * as path from '../vscode-path/resources';
import { EnvironmentType } from '../pythonEnvironments/info';
import { IFileSystem, IPlatformService } from '../common/platform/types';
import { ResourceMap } from '../common/resourceMap';
import { swallowExceptions } from '../common/utils/decorators';
import { IProcessServiceFactory } from '../common/process/types.node';
import { traceVerbose } from '../logging';
import { getDisplayPath } from '../common/platform/fs-paths';
import { Environment } from '@vscode/python-extension';
import { getEnvironmentType } from './helpers';

@injectable()
export class GlobalPythonExecutablePathService {
    private readonly userSitePaths = new ResourceMap<Promise<Uri | undefined>>();
    constructor(
        @inject(IProcessServiceFactory) private readonly processFactory: IProcessServiceFactory,
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}

    /**
     * Gets the path where executables are installed for the given Global Python interpreter.
     */
    @swallowExceptions()
    public async getExecutablesPath(environment: Environment): Promise<Uri | undefined> {
        const executable = environment.executable.uri;
        if (getEnvironmentType(environment) !== EnvironmentType.Unknown || !executable) {
            return;
        }

        if (!this.userSitePaths.has(executable)) {
            const promise = this.getUserSitePathImpl(executable);
            promise.catch(() => {
                if (this.userSitePaths.get(executable) === promise) {
                    this.userSitePaths.delete(executable);
                }
            });
            this.userSitePaths.set(executable, promise);
        }
        return this.userSitePaths.get(executable);
    }
    /**
     * Tested the following scenarios:
     * 1. HomeBrew Python on Mac
     * 2. Python install from Python org on Mac
     * 3. apt-get install python3 on Ubuntu
     * 4. Windows Store Python on Windows
     *
     * Also documented here by other users
     * https://stackoverflow.com/questions/35898734/pip-installs-packages-successfully-but-executables-not-found-from-command-line
     *
     * In all of these cases when we install packages a warning is displayed in the terminal
     * indicating the fact that packages are being installed in a directory that is not on the PATH.
     * Upon further investigation it is found that this directory is a USER_SITE or USER_BASE directory.
     *
     * After all, when we install packages into the global envs we use the `--user` flag.
     * Which results in installing the packages in a user directory (hence USER_SITE or USER_BASE).
     *
     * The work around here is to ensure we add that path into the PATH
     * This service merely returns the path that needs to be added to the PATH.
     *
     * On windows it is USER_SITE/../Scripts
     * On Unix it is USER_BASE/bin
     *
     */
    private async getUserSitePathImpl(executable: Uri): Promise<Uri | undefined> {
        const processService = await this.processFactory.create(undefined);
        const delimiter = 'USER_BASE_VALUE';
        const valueToUse = this.platform.isWindows ? 'USER_SITE' : 'USER_BASE';
        // Add delimiters as sometimes, the python runtime can spit out warning/information messages as well.
        const { stdout } = await processService.exec(executable.fsPath, [
            '-c',
            `import site;print("${delimiter}");print(site.${valueToUse});print("${delimiter}");`
        ]);
        if (stdout.includes(delimiter)) {
            const output = stdout
                .substring(stdout.indexOf(delimiter) + delimiter.length, stdout.lastIndexOf(delimiter))
                .trim();
            const outputPath = Uri.file(output);
            let sitePath: Uri | undefined;
            if (this.platform.isWindows) {
                sitePath = Uri.joinPath(path.dirname(outputPath), 'Scripts');
            } else {
                sitePath = Uri.joinPath(outputPath, 'bin');
            }
            if (!sitePath || !this.fs.exists(sitePath)) {
                throw new Error(
                    `USER_SITE ${sitePath.fsPath} dir does not exist for the interpreter ${getDisplayPath(executable)}`
                );
            }
            traceVerbose(`USER_SITE for ${getDisplayPath(executable)} is ${sitePath.fsPath}`);
            return sitePath;
        } else {
            throw new Error(`USER_SITE not found for the interpreter ${getDisplayPath(executable)}. Stdout: ${stdout}`);
        }
    }
}
