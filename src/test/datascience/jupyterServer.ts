// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as getFreePort from 'get-port';
import * as path from 'path';
import * as tcpPortUsed from 'tcp-port-used';
import { Uri } from 'vscode';
import { disposeAllDisposables } from '../../platform/common/helpers.node';
import { traceError, traceInfo, traceInfoIfCI } from '../../platform/common/logger.node';
import { IPythonExecutionFactory } from '../../platform/common/process/types';
import { IAsyncDisposable, IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { PYTHON_PATH, sleep } from '../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants';
import { initialize } from '../initialize';
const testFolder = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience');

export class JupyterServer implements IAsyncDisposable {
    public static get instance(): JupyterServer {
        if (!JupyterServer._instance) {
            JupyterServer._instance = new JupyterServer();
        }
        return JupyterServer._instance;
    }
    private static _instance: JupyterServer;
    private _disposables: IDisposable[] = [];
    private _jupyterServerWithToken?: Promise<Uri>;
    private _secondJupyterServerWithToken?: Promise<Uri>;
    private availablePort?: number;
    private availableSecondPort?: number;
    public async dispose() {
        this._jupyterServerWithToken = undefined;
        this._secondJupyterServerWithToken = undefined;
        disposeAllDisposables(this._disposables);
        traceInfo('Shutting Jupyter server used for remote tests');
        if (this.availablePort) {
            await tcpPortUsed.waitUntilFree(this.availablePort, 200, 5_000);
        }
        if (this.availableSecondPort) {
            await tcpPortUsed.waitUntilFree(this.availableSecondPort, 200, 5_000);
        }
    }
    public async startJupyterWithToken(token = '7d25707a86975be50ee9757c929fef9012d27cf43153d1c1'): Promise<Uri> {
        if (!this._jupyterServerWithToken) {
            this._jupyterServerWithToken = new Promise<Uri>(async (resolve, reject) => {
                const port = await this.getFreePort();
                // Possible previous instance of jupyter has not completely shutdown.
                // Wait for it to shutdown fully so that we can re-use the same port.
                await tcpPortUsed.waitUntilFree(port, 200, 10_000);
                try {
                    await this.startJupyterServer({
                        port,
                        token
                    });
                    await sleep(5_000); // Wait for some time for Jupyter to warm up & be ready to accept connections.
                    resolve(Uri.parse(`http://localhost:${port}/?token=${token}`));
                } catch (ex) {
                    reject(ex);
                }
            });
        }
        return this._jupyterServerWithToken;
    }
    public async startSecondJupyterWithToken(token = 'fbd00a866c54f5d9f64df9ba820860de56f32379407d03e8'): Promise<Uri> {
        if (!this._secondJupyterServerWithToken) {
            this._secondJupyterServerWithToken = new Promise<Uri>(async (resolve, reject) => {
                const port = await this.getSecondFreePort();
                // Possible previous instance of jupyter has not completely shutdown.
                // Wait for it to shutdown fully so that we can re-use the same port.
                await tcpPortUsed.waitUntilFree(port, 200, 10_000);
                try {
                    await this.startJupyterServer({
                        port,
                        token
                    });
                    await sleep(5_000); // Wait for some time for Jupyter to warm up & be ready to accept connections.
                    resolve(Uri.parse(`http://localhost:${port}/?token=${token}`));
                } catch (ex) {
                    reject(ex);
                }
            });
        }
        return this._secondJupyterServerWithToken;
    }
    private async getFreePort() {
        // Always use the same port (when using different ports, our code doesn't work as we need to re-load VSC).
        // The remote uri is cached in a few places (known issue).
        if (!this.availablePort) {
            this.availablePort = await getFreePort({ host: 'localhost' }).then((p) => p);
        }
        return this.availablePort!;
    }
    private async getSecondFreePort() {
        // Always use the same port (when using different ports, our code doesn't work as we need to re-load VSC).
        // The remote uri is cached in a few places (known issue).
        if (!this.availableSecondPort) {
            this.availableSecondPort = await getFreePort({ host: 'localhost' }).then((p) => p);
        }
        return this.availableSecondPort!;
    }

    private startJupyterServer({ token, port }: { token: string; port: number }): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                const api = await initialize();
                const pythonExecFactory = api.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
                const pythonExecutionService = await pythonExecFactory.create({
                    interpreter: { path: PYTHON_PATH } as PythonEnvironment
                });
                const notebookArgs = [
                    'notebook',
                    '--no-browser',
                    `--NotebookApp.port=${port}`,
                    `--NotebookApp.token=${token}`
                ];
                traceInfoIfCI(`Starting Jupyter on CI with args ${notebookArgs.join(' ')}`);
                const result = pythonExecutionService.execModuleObservable('jupyter', notebookArgs, {
                    cwd: testFolder
                });
                if (!result.proc) {
                    throw new Error('Starting Jupyter failed, no process');
                }
                result.proc.once('close', () => traceInfo('Shutting Jupyter server used for remote tests (closed)'));
                result.proc.once('disconnect', () =>
                    traceInfo('Shutting Jupyter server used for remote tests (disconnected)')
                );
                result.proc.once('exit', () => traceInfo('Shutting Jupyter server used for remote tests (exited)'));
                const procDisposable = {
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
                };
                api.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry).push(procDisposable);

                const subscription = result.out.subscribe((output) => {
                    traceInfo(`Test Remote Jupyter Server Output: ${output.out}`);
                    if (output.out.indexOf('Use Control-C to stop this server and shut down all kernels')) {
                        resolve();
                    }
                });
                this._disposables.push(procDisposable);
                this._disposables.push({ dispose: () => subscription.unsubscribe() });
            } catch (ex) {
                traceError('Starting remote jupyter server failed', ex);
                reject(ex);
            }
        });
    }
}
