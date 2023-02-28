// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import * as path from '../../../platform/vscode-path/path';
import { traceVerbose } from '../../logging';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { getDisplayPath } from '../platform/fs-paths.node';
import { IFileSystem, IPlatformService } from '../platform/types';
import { ResourceMap } from '../resourceMap';
import { swallowExceptions } from '../utils/decorators';
import { IProcessServiceFactory } from './types.node';

@injectable()
export class GlobalPythonSiteService {
    private readonly userSitePaths = new ResourceMap<Promise<Uri | undefined>>();
    constructor(
        @inject(IProcessServiceFactory) private readonly processFactory: IProcessServiceFactory,
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}

    @swallowExceptions()
    public async getUserSitePath(interpreter: PythonEnvironment): Promise<Uri | undefined> {
        if (interpreter.envType !== EnvironmentType.Unknown) {
            return;
        }

        if (!this.userSitePaths.has(interpreter.uri)) {
            const promise = this.getUserSitePathImpl(interpreter);
            promise.catch(() => {
                if (this.userSitePaths.get(interpreter.uri) === promise) {
                    this.userSitePaths.delete(interpreter.uri);
                }
            });
            this.userSitePaths.set(interpreter.uri, promise);
        }
        return this.userSitePaths.get(interpreter.uri);
    }
    /**
     * Tested the following scenarios:
     * 1. HomeBrew Python on Mac
     * 2. Python install from Python org on Mac
     * 3. apt-get install python3 on Ubuntu
     * 4. Windows Store Python on Windows
     *
     * In all of these cases when we install packages a warning is displayed in the terminal
     * indicating the fact that packages are being installed in a directory that is not on the PATH.
     * Upon further investigation it is found that this directory is a USER_SITE directory.
     *
     * After all, when we install packages into the global envs we use the `--user` flag.
     * Which results in installing the packages in a user directory (hence USER_SITE).
     *
     * The work around here is to ensure we add that path into the PATH
     * This service merely returns the path that needs to be added to the PATH.
     */
    private async getUserSitePathImpl(interpreter: PythonEnvironment): Promise<Uri | undefined> {
        const processService = await this.processFactory.create();
        const delimiter = 'USER_BASE_VALUE';
        const { stdout } = await processService.exec(interpreter.uri.fsPath, [
            '-c',
            `import site;print("${delimiter}");print(site.USER_SITE);print("${delimiter}");`
        ]);
        if (stdout.includes(delimiter)) {
            const output = stdout
                .substring(stdout.indexOf(delimiter) + delimiter.length, stdout.lastIndexOf(delimiter))
                .trim();
            let sitePath = Uri.file(output);
            if (this.platform.isWindows) {
                sitePath = Uri.file(path.join(path.dirname(sitePath.fsPath), 'Scripts'));
            } else if (sitePath.fsPath.endsWith('site-packages')) {
                sitePath = Uri.file(path.join(path.dirname(path.dirname(path.dirname(sitePath.fsPath))), 'bin'));
            }
            if (!this.fs.exists(sitePath)) {
                throw new Error(
                    `USER_SITE ${sitePath.fsPath} dir does not exist for the interpreter ${getDisplayPath(
                        interpreter.uri
                    )}`
                );
            }
            traceVerbose(`USER_SITE for ${getDisplayPath(interpreter.uri)} is ${sitePath.fsPath}`);
            return sitePath;
        } else {
            throw new Error(
                `USER_SITE not found for the interpreter ${getDisplayPath(interpreter.uri)}. Stdout: ${stdout}`
            );
        }
    }
}
