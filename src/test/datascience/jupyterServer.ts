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
    private _jupyterServerWithoutAuthProc?: ChildProcess;
    private _jupyterServerWithoutAuth?: Promise<Uri>;
    private _jupyterServerWithToken1234Proc?: ChildProcess;
    private _jupyterServerWithToken1234?: Promise<Uri>;
    private constructor() {}
    public dispose() {
        if (this._jupyterServerWithoutAuthProc) {
            this._jupyterServerWithoutAuthProc?.kill();
        }
        if (this._jupyterServerWithToken1234Proc) {
            this._jupyterServerWithToken1234Proc?.kill();
        }
    }
    public async startJupyterWithoutAuth(): Promise<Uri> {
        if (!this._jupyterServerWithoutAuth) {
            this._jupyterServerWithoutAuth = new Promise<Uri>(async (resolve, reject) => {
                const port = await getFreePort({ host: 'localhost' });
                try {
                    this._jupyterServerWithoutAuthProc = await this.startJupyterServer({ port, token: '' });
                    resolve(Uri.parse(`http://localhost:${port}`));
                } catch (ex) {
                    reject(ex);
                }
            });
        }
        return this._jupyterServerWithoutAuth;
    }
    public async startJupyterWithToken1234(): Promise<Uri> {
        if (!this._jupyterServerWithToken1234) {
            this._jupyterServerWithToken1234 = new Promise<Uri>(async (resolve, reject) => {
                const port = await getFreePort({ host: 'localhost' });
                try {
                    this._jupyterServerWithToken1234Proc = await this.startJupyterServer({ port, token: '1234' });
                    resolve(Uri.parse(`http://localhost:${port}`));
                } catch (ex) {
                    reject(ex);
                }
            });
        }
        return this._jupyterServerWithToken1234;
    }

    private startJupyterServer(options: { token: string; port: number }): Promise<ChildProcess> {
        return new Promise<ChildProcess>(async (resolve, reject) => {
            try {
                const api = await initialize();
                const pythonExecFactory = api.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
                const pythonExecutionService = await pythonExecFactory.create({ pythonPath: PYTHON_PATH });
                const result = pythonExecutionService.execModuleObservable(
                    'jupyter',
                    ['notebook', `--NotebookApp.port=${options.port}`, `--NotebookApp.token=${options.token}`],
                    {
                        cwd: testFolder
                    }
                );
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
                    if (output.out.indexOf('The Jupyter Notebook is running at')) {
                        subscription.unsubscribe();
                        resolve(result.proc);
                    }
                });
            } catch (ex) {
                reject(ex);
            }
        });
    }
}
