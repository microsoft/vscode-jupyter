// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ChildProcess } from 'child_process';
import * as getFreePort from 'get-port';
import * as path from 'path';
import { Uri } from 'vscode';
import { traceError, traceInfo } from '../../client/common/logger';
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
        this._jupyterServerWithTokenABCDProc = undefined;
    }
    public async startJupyterWithToken(token = '7d25707a86975be50ee9757c929fef9012d27cf43153d1c1'): Promise<Uri> {
        traceInfo(`Start Setup.B1`);
        if (!this._jupyterServerWithTokenABCD) {
            traceInfo(`Start Setup.B2`);
            this._jupyterServerWithTokenABCD = new Promise<Uri>(async (resolve, reject) => {
                traceInfo(`Start Setup.B3`);
                const port = await getFreePort({ host: 'localhost' });
                traceInfo(`Start Setup.B4`);
                try {
                    traceInfo(`Start Setup.B5`);
                    this._jupyterServerWithTokenABCDProc = await this.startJupyterServer({
                        port,
                        token
                    });
                    traceInfo(`Start Setup.B6`);
                    resolve(Uri.parse(`http://localhost:${port}/?token=${token}`));
                } catch (ex) {
                    reject(ex);
                }
            });
        }
        return this._jupyterServerWithTokenABCD;
    }

    private startJupyterServer({ token, port }: { token: string; port: number }): Promise<ChildProcess> {
        traceInfo(`Start Setup.C1`);
        return new Promise<ChildProcess>(async (resolve, reject) => {
            try {
                traceInfo(`Start Setup.C2`);
                const api = await initialize();
                traceInfo(`Start Setup.C3`);
                const pythonExecFactory = api.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
                traceInfo(`Start Setup.C4`);
                const pythonExecutionService = await pythonExecFactory.create({ pythonPath: PYTHON_PATH });
                traceInfo(`Start Setup.C5`);
                const result = pythonExecutionService.execModuleObservable(
                    'jupyter',
                    ['notebook', '--no-browser', `--NotebookApp.port=${port}`, `--NotebookApp.token=${token}`],
                    {
                        cwd: testFolder
                    }
                );
                traceInfo(`Start Setup.C6`);
                if (!result.proc) {
                    throw new Error('Starting Jupyter failed, no process');
                }
                traceInfo(`Start Setup.C7`);
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

                traceInfo(`Start Setup.C8`);
                const subscription = result.out.subscribe((output) => {
                    traceInfo(`Start Setup.C9`);
                    traceInfo(`Test Remote Jupyter Server Output: ${output.out}`);
                    if (output.out.indexOf('Use Control-C to stop this server and shut down all kernels')) {
                        traceInfo(`Start Setup.C10`);
                        subscription.unsubscribe();
                        resolve(result.proc!);
                    }
                });
            } catch (ex) {
                traceInfo(`Start Setup.C11`);
                traceError('Starting remote jupyter server failed', ex);
                reject(ex);
            }
        });
    }
}
