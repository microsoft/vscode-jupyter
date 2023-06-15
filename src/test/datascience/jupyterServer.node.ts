// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable local-rules/node-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** DO NOT USE VSCODE in this file. It's loaded outside of an extension */

import * as crypto from 'crypto';
import getFreePort from 'get-port';
import * as tcpPortUsed from 'tcp-port-used';
import uuid from 'uuid/v4';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as child_process from 'child_process';
const uuidToHex = require('uuid-to-hex') as typeof import('uuid-to-hex');
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants.node';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { Observable } from 'rxjs-compat/Observable';
const testFolder = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience');
const isCI = process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true';

import { sleep } from '../core';
import { EXTENSION_ROOT_DIR } from '../../platform/constants.node';
import { noop } from '../../platform/common/utils/misc';

function getPythonPath(): string {
    if (process.env.CI_PYTHON_PATH && fs.existsSync(process.env.CI_PYTHON_PATH)) {
        return process.env.CI_PYTHON_PATH;
    }
    // eslint-disable-next-line
    // TODO: Change this to python3.
    // See https://github.com/microsoft/vscode-python/issues/10910.
    return 'python';
}

class BufferDecoder {
    public decode(buffers: Buffer[]): string {
        return Buffer.concat(buffers).toString('utf-8');
    }
}

// This class is used by web and node tests. The web tests need to start a server outside of VS code (because they can't start python)
// so this class can't use anything that requires VS code types
//
// However this code is being launched by node, so it can use node types.
interface IDisposable {
    dispose(): void;
}

type Output<T extends string | Buffer> = {
    source: 'stdout' | 'stderr';
    out: T;
};

type ObservableExecutionResult<T extends string | Buffer> = {
    proc: child_process.ChildProcess | undefined;
    out: Observable<Output<T>>;
    dispose(): void;
};

// Tracing can't be used either
function traceInfo(message: string) {
    console.log(message);
}

function traceInfoIfCI(message: string) {
    if (isCI) {
        traceInfo(message);
    }
}

export class JupyterServer {
    /**
     * Used in vscode debugger launcher `preDebugWebTest.js` to kill the Jupyter Server by pid.
     */
    public pid: number = -1;
    public static get instance(): JupyterServer {
        if (!JupyterServer._instance) {
            JupyterServer._instance = new JupyterServer();
        }
        return JupyterServer._instance;
    }
    private static _instance: JupyterServer;
    private _disposables: IDisposable[] = [];
    private _jupyterServerWithToken?: Promise<string>;
    private _secondJupyterServerWithToken?: Promise<string>;
    private _jupyterServerWithCert?: Promise<string>;
    private availablePort?: number;
    private availableSecondPort?: number;
    private availableThirdPort?: number;
    private decoder = new BufferDecoder();
    public async dispose() {
        this._jupyterServerWithToken = undefined;
        this._secondJupyterServerWithToken = undefined;
        console.log(`Disposing jupyter server instance`);
        disposeAllDisposables(this._disposables);
        traceInfo('Shutting Jupyter server used for remote tests');
        if (this.availablePort) {
            await tcpPortUsed.waitUntilFree(this.availablePort, 200, 5_000).catch(noop);
        }
        if (this.availableSecondPort) {
            await tcpPortUsed.waitUntilFree(this.availableSecondPort, 200, 5_000).catch(noop);
        }
    }

    public async startJupyterWithCert(detached?: boolean): Promise<string> {
        if (!this._jupyterServerWithCert) {
            this._jupyterServerWithCert = new Promise<string>(async (resolve, reject) => {
                const token = this.generateToken();
                const port = await this.getThirdFreePort();
                // Possible previous instance of jupyter has not completely shutdown.
                // Wait for it to shutdown fully so that we can re-use the same port.
                await tcpPortUsed.waitUntilFree(port, 200, 10_000);
                try {
                    await this.startJupyterServer({
                        port,
                        token,
                        useCert: true,
                        detached
                    });
                    await sleep(5_000); // Wait for some time for Jupyter to warm up & be ready to accept connections.

                    // Anything with a cert is https, not http
                    resolve(`https://localhost:${port}/?token=${token}`);
                } catch (ex) {
                    reject(ex);
                }
            });
        }
        return this._jupyterServerWithCert;
    }
    public async startJupyter(options: {
        token?: string;
        port?: number;
        useCert?: boolean;
        jupyterLab?: boolean;
        password?: string;
    }): Promise<string> {
        const port = await this.getThirdFreePort();
        // Possible previous instance of jupyter has not completely shutdown.
        // Wait for it to shutdown fully so that we can re-use the same port.
        await tcpPortUsed.waitUntilFree(port, 200, 10_000);
        const token = typeof options.token === 'string' ? options.token : this.generateToken();
        await this.startJupyterServer({ ...options, port, token });
        await sleep(5_000); // Wait for some time for Jupyter to warm up & be ready to accept connections.

        // Anything with a cert is https, not http
        return `http${options.useCert ? 's' : ''}://localhost:${port}/?token=${token}`;
    }

    public async startJupyterWithToken({ detached }: { detached?: boolean } = {}): Promise<string> {
        const token = this.generateToken();
        if (!this._jupyterServerWithToken) {
            this._jupyterServerWithToken = new Promise<string>(async (resolve, reject) => {
                const port = await this.getFreePort();
                // Possible previous instance of jupyter has not completely shutdown.
                // Wait for it to shutdown fully so that we can re-use the same port.
                await tcpPortUsed.waitUntilFree(port, 200, 10_000);
                try {
                    await this.startJupyterServer({
                        port,
                        token,
                        detached
                    });
                    await sleep(5_000); // Wait for some time for Jupyter to warm up & be ready to accept connections.
                    const url = `http://localhost:${port}/?token=${token}`;
                    console.log(`Started Jupyter Server on ${url}`);
                    resolve(url);
                } catch (ex) {
                    reject(ex);
                }
            });
        }
        return this._jupyterServerWithToken;
    }
    public async startSecondJupyterWithToken(token = this.generateToken()): Promise<string> {
        if (!this._secondJupyterServerWithToken) {
            this._secondJupyterServerWithToken = new Promise<string>(async (resolve, reject) => {
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
                    const url = `http://localhost:${port}/?token=${token}`;
                    console.log(`Started Jupyter Server on ${url}`);
                    resolve(url);
                } catch (ex) {
                    reject(ex);
                }
            });
        }
        return this._secondJupyterServerWithToken;
    }

    private generateToken(): string {
        return uuidToHex(uuid());
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

    private async getThirdFreePort() {
        // Always use the same port (when using different ports, our code doesn't work as we need to re-load VSC).
        // The remote uri is cached in a few places (known issue).
        if (!this.availableThirdPort) {
            this.availableThirdPort = await getFreePort({ host: 'localhost' }).then((p) => p);
        }
        return this.availableThirdPort!;
    }

    private startJupyterServer({
        token,
        port,
        useCert,
        jupyterLab,
        password,
        detached
    }: {
        token: string;
        port: number;
        useCert?: boolean;
        jupyterLab?: boolean;
        password?: string;
        detached?: boolean;
    }): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                const args = [
                    '-m',
                    'jupyter',
                    jupyterLab ? 'lab' : 'notebook',
                    '--no-browser',
                    `--NotebookApp.port=${port}`,
                    `--NotebookApp.token=${token}`,
                    `--NotebookApp.allow_origin=*`
                ];
                if (typeof password === 'string') {
                    if (password.length === 0) {
                        args.push(`--NotebookApp.password=`);
                    } else {
                        args.push(`--NotebookApp.password=${generateHashedPassword(password)}`);
                    }
                }
                if (useCert) {
                    const pemFile = path.join(
                        EXTENSION_ROOT_DIR,
                        'src',
                        'test',
                        'datascience',
                        'serverConfigFiles',
                        'jcert.pem'
                    );
                    const keyFile = path.join(
                        EXTENSION_ROOT_DIR,
                        'src',
                        'test',
                        'datascience',
                        'serverConfigFiles',
                        'jkey.key'
                    );
                    args.push(`--certfile=${pemFile}`);
                    args.push(`--keyfile=${keyFile}`);
                }
                traceInfoIfCI(`Starting Jupyter on CI with args ${args.join(' ')}`);
                const result = this.execObservable(getPythonPath(), args, {
                    cwd: testFolder,
                    detached
                });
                if (!result.proc) {
                    throw new Error('Starting Jupyter failed, no process');
                }
                if (result.proc.pid) {
                    this.pid = result.proc.pid;
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
                            JupyterServer.kill(result.proc.pid);
                        } catch {
                            //
                        }
                    }
                };
                const subscription = result.out.subscribe((output) => {
                    // When debugging Web Tests using VSCode dfebugger, we'd like to see this info.
                    // This way we can click the link in the output panel easily.
                    console.info(output.out);
                    traceInfoIfCI(`Test Remote Jupyter Server Output: ${output.out}`);
                    if (output.out.indexOf('Use Control-C to stop this server and shut down all kernels')) {
                        resolve();
                    }
                });
                this._disposables.push(procDisposable);
                this._disposables.push({ dispose: () => subscription.unsubscribe() });
            } catch (ex) {
                traceInfo(`Starting remote jupyter server failed ${ex}`);
                reject(ex);
            }
        });
    }

    public execObservable(
        file: string,
        args: string[],
        options: child_process.SpawnOptions = {}
    ): ObservableExecutionResult<string> {
        const proc = child_process.spawn(file, args, options);
        let procExited = false;
        traceInfoIfCI(`Exec observable ${file}, ${args.join(' ')}`);
        const disposable: IDisposable = {
            // eslint-disable-next-line
            dispose: function () {
                if (proc && !proc.killed && !procExited) {
                    JupyterServer.kill(proc.pid);
                }
                if (proc) {
                    proc.unref();
                }
            }
        };

        const output = new Observable<Output<string>>((subscriber) => {
            const disposables: IDisposable[] = [];

            const on = (ee: NodeJS.EventEmitter, name: string, fn: Function) => {
                ee.on(name, fn as any);
                disposables.push({ dispose: () => ee.removeListener(name, fn as any) as any });
            };

            const sendOutput = (source: 'stdout' | 'stderr', data: Buffer) => {
                const out = this.decoder.decode([data]);
                subscriber.next({ source, out: out });
            };

            on(proc.stdout!, 'data', (data: Buffer) => sendOutput('stdout', data));
            on(proc.stderr!, 'data', (data: Buffer) => sendOutput('stderr', data));

            proc.once('close', () => {
                procExited = true;
                subscriber.complete();
                disposables.forEach((d) => d.dispose());
            });
            proc.once('exit', () => {
                procExited = true;
                subscriber.complete();
                disposables.forEach((d) => d.dispose());
            });
            proc.once('error', (ex) => {
                procExited = true;
                subscriber.error(ex);
                disposables.forEach((d) => d.dispose());
            });
        });

        return {
            proc,
            out: output,
            dispose: disposable.dispose
        };
    }

    public static kill(pid?: number): void {
        try {
            if (!pid) {
                return;
            }
            if (process.platform === 'win32') {
                // Windows doesn't support SIGTERM, so execute taskkill to kill the process
                child_process.execSync(`taskkill /pid ${pid} /T /F`);
            } else {
                process.kill(pid);
            }
        } catch {
            // Ignore.
        }
    }
}

function generateHashedPassword(password: string) {
    const hash = crypto.createHash('sha1');
    const salt = genRandomString(16);
    hash.update(password);
    hash.update(salt);
    return `sha1:${salt}:${hash.digest('hex').toString()}`;
}

/**
 * generates random string of characters i.e salt
 * @function
 * @param {number} length - Length of the random string.
 */
function genRandomString(length = 16) {
    return crypto
        .randomBytes(Math.ceil(length / 2))
        .toString('hex') /** convert to hexadecimal format */
        .slice(0, length); /** return required number of characters */
}
