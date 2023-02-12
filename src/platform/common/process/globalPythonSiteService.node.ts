// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { traceWarning } from '../../logging';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { getDisplayPath } from '../platform/fs-paths.node';
import { ResourceMap } from '../resourceMap';
import { IProcessServiceFactory } from './types.node';

@injectable()
export class GlobalPythonSiteService {
    private readonly userSitePaths = new ResourceMap<Promise<Uri | undefined>>();
    constructor(@inject(IProcessServiceFactory) private readonly processFactory: IProcessServiceFactory) {}

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
    public async getUserSitePathImpl(interpreter: PythonEnvironment): Promise<Uri | undefined> {
        try {
            const processService = await this.processFactory.create();
            const delimiter = 'USER_BASE_VALUE';
            const { stdout } = await processService.exec(interpreter.uri.fsPath, [
                '-c',
                `import site;print("${delimiter}");print(site.USER_BASE);print("${delimiter}");`
            ]);
            if (stdout.includes(delimiter)) {
                const output = stdout
                    .substring(stdout.indexOf(delimiter) + delimiter.length, stdout.lastIndexOf(delimiter))
                    .trim();
                if (output.length > 0) {
                    return Uri.file(output);
                }
            }
        } catch (ex) {
            traceWarning(`Failed to get the USER_BASE value for the interpreter ${getDisplayPath(interpreter.uri)}`);
        }
    }
}
