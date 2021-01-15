// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ChildProcess } from 'child_process';
import * as getFreePort from 'get-port';
import * as path from 'path';
import { Uri } from 'vscode';
import { IPythonExecutionFactory } from '../../client/common/process/types';
import { IDisposable, IDisposableRegistry } from '../../client/common/types';
import { PYTHON_PATH } from '../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants';
import { initialize } from '../initialize';
const testFolder = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience');

export class JupyterServer implements IDisposable {
    public static get instance(): JupyterServer {
        if (!JupyterServer._instance) {
            JupyterServer._instance = new JupyterServer();
        }
        return JupyterServer._instance;
    }
    private static _instance: JupyterServer;
    private _jupyterServerWithTokenABCDProc?: ChildProcess;
    private _jupyterServerWithTokenABCD?: Promise<Uri>;
    public dispose() {
        if (this._jupyterServerWithTokenABCDProc) {
            this._jupyterServerWithTokenABCDProc?.kill();
        }
    }
    public async startJupyterWithToken(token = '7d25707a86975be50ee9757c929fef9012d27cf43153d1c1'): Promise<Uri> {
        if (!this._jupyterServerWithTokenABCD) {
            this._jupyterServerWithTokenABCD = new Promise<Uri>(async (resolve, reject) => {
                const port = await getFreePort({ host: 'localhost' });
                try {
                    this._jupyterServerWithTokenABCDProc = await this.startJupyterServer({
                        port,
                        token
                    });
                    resolve(Uri.parse(`http://localhost:${port}/?token=${token}`));
                } catch (ex) {
                    reject(ex);
                }
            });
        }
        return this._jupyterServerWithTokenABCD;
    }

    private startJupyterServer({ token, port }: { token: string; port: number }): Promise<ChildProcess> {
        return new Promise<ChildProcess>(async (resolve, reject) => {
            try {
                const api = await initialize();
                const pythonExecFactory = api.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
                const pythonExecutionService = await pythonExecFactory.create({ pythonPath: PYTHON_PATH });
                const result = pythonExecutionService.execModuleObservable(
                    'jupyter',
                    ['notebook', '--no-browser', `--NotebookApp.port=${port}`, `--NotebookApp.token=${token}`],
                    {
                        cwd: testFolder
                    }
                );
                if (!result.proc) {
                    throw new Error('Starting Jupyter failed, no process');
                }
                api.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry).push({
                    dispose: () => {
                        if (!result.proc) {
                            return;
                        }
                        try {
                            result.proc?.kill();
                        } catch {
                            //
                        }
                    }
                });

                const subscription = result.out.subscribe((output) => {
                    if (output.out.indexOf('Use Control-C to stop this server and shut down all kernels')) {
                        subscription.unsubscribe();
                        resolve(result.proc!);
                    }
                });
            } catch (ex) {
                reject(ex);
            }
        });
    }
}
