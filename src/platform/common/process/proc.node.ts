// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { exec, execSync, spawn } from 'child_process';
import { CancellationError, Disposable, EventEmitter } from 'vscode';
import { ignoreLogging, traceDecoratorVerbose, traceInfoIfCI } from '../../logging';
import { TraceOptions } from '../../logging/types';
import { IDisposable } from '../types';
import { createDeferred } from '../utils/async';
import { EnvironmentVariables } from '../variables/types';
import { DEFAULT_ENCODING } from './constants.node';
import {
    ExecutionResult,
    IBufferDecoder,
    IProcessService,
    ObservableExecutionResult,
    Output,
    ShellOptions,
    SpawnOptions,
    StdErrError
} from './types.node';
import { logProcess } from './logger.node';
import { dispose } from '../utils/lifecycle';
import { noop } from '../utils/misc';

export class BufferDecoder implements IBufferDecoder {
    public decode(buffers: Buffer[]): string {
        return Buffer.concat(buffers).toString(DEFAULT_ENCODING);
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Used to create node processes and kill them.
 * Tracks the process and its output.
 * Can make observables or promises for launching.
 * Environment variables to launch with can be passed into the constructor.
 */
export class ProcessService implements IProcessService {
    private processesToKill = new Set<IDisposable>();
    private readonly decoder: IBufferDecoder;
    constructor(private readonly env?: EnvironmentVariables) {
        this.decoder = new BufferDecoder();
    }
    public static isAlive(pid?: number): boolean {
        try {
            if (!pid) {
                return false;
            }
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }
    public static kill(pid?: number): void {
        try {
            if (!pid) {
                return;
            }
            if (process.platform === 'win32') {
                // Windows doesn't support SIGTERM, so execute taskkill to kill the process
                execSync(`taskkill /pid ${pid} /T /F`);
            } else {
                process.kill(pid);
            }
        } catch {
            // Ignore.
        }
    }
    public dispose() {
        this.processesToKill.forEach((p) => {
            try {
                p.dispose();
            } catch {
                // ignore.
            }
        });
    }

    public execObservable(file: string, args: string[], options: SpawnOptions = {}): ObservableExecutionResult<string> {
        const spawnOptions = this.getDefaultOptions(options);
        const proc = spawn(file, args, spawnOptions);
        let procExited = false;
        traceInfoIfCI(`Exec observable ${file}, ${args.join(' ')}`);
        const disposables: IDisposable[] = [];
        const disposable: IDisposable = {
            // eslint-disable-next-line
            dispose: function () {
                if (proc && !proc.killed && !procExited) {
                    ProcessService.kill(proc.pid);
                }
                if (proc) {
                    proc.unref();
                }
                dispose(disposables);
            }
        };
        this.processesToKill.add(disposable);

        const output = createObservable<Output<string>>();
        disposables.push(output);

        const on = (ee: NodeJS.EventEmitter, name: string, fn: Function) => {
            ee.on(name, fn as any);
            disposables.push({ dispose: () => ee.removeListener(name, fn as any) as any });
        };

        if (options.token) {
            disposables.push(
                options.token.onCancellationRequested(() => {
                    if (!procExited && !proc.killed) {
                        ProcessService.kill(proc.pid);
                        procExited = true;
                    }
                })
            );
        }

        const sendOutput = (source: 'stdout' | 'stderr', data: Buffer) => {
            const out = this.decoder.decode([data]);
            if (source === 'stderr' && options.throwOnStdErr) {
                output.reject(new StdErrError(out));
            } else {
                output.fire({ source, out: out });
            }
        };

        on(proc.stdout!, 'data', (data: Buffer) => sendOutput('stdout', data));
        on(proc.stderr!, 'data', (data: Buffer) => sendOutput('stderr', data));

        proc.once('close', () => {
            procExited = true;
            output.resolve();
            disposables.forEach((d) => d.dispose());
        });
        proc.once('exit', () => {
            procExited = true;
            output.resolve();
            disposables.forEach((d) => d.dispose());
        });
        proc.once('error', (ex) => {
            procExited = true;
            output.reject(ex);
            disposables.forEach((d) => d.dispose());
        });

        logProcess(file, args, options);

        return {
            proc,
            out: output,
            dispose: disposable.dispose
        };
    }
    public exec(file: string, args: string[], options: SpawnOptions = {}): Promise<ExecutionResult<string>> {
        const spawnOptions = this.getDefaultOptions(options);
        const proc = spawn(file, args, spawnOptions);
        const deferred = createDeferred<ExecutionResult<string>>();
        const disposable: IDisposable = {
            dispose: () => {
                if (!proc.killed && !deferred.completed) {
                    ProcessService.kill(proc.pid);
                }
            }
        };
        this.processesToKill.add(disposable);
        const disposables: IDisposable[] = [];

        const on = (ee: NodeJS.EventEmitter, name: string, fn: Function) => {
            ee.on(name, fn as any);
            disposables.push({ dispose: () => ee.removeListener(name, fn as any) as any });
        };

        if (options.token) {
            disposables.push(options.token.onCancellationRequested(disposable.dispose));
        }

        const stdoutBuffers: Buffer[] = [];
        on(proc.stdout!, 'data', (data: Buffer) => stdoutBuffers.push(data));
        const stderrBuffers: Buffer[] = [];
        on(proc.stderr!, 'data', (data: Buffer) => {
            if (options.mergeStdOutErr) {
                stdoutBuffers.push(data);
                stderrBuffers.push(data);
            } else {
                stderrBuffers.push(data);
            }
        });

        proc.once('close', () => {
            if (deferred.completed) {
                return;
            }
            const stderr: string | undefined =
                stderrBuffers.length === 0 ? undefined : this.decoder.decode(stderrBuffers);
            if (stderr && stderr.length > 0 && options.throwOnStdErr) {
                deferred.reject(new StdErrError(stderr));
            } else {
                const stdout = this.decoder.decode(stdoutBuffers);
                deferred.resolve({ stdout, stderr });
            }
            disposables.forEach((d) => d.dispose());
        });
        proc.once('error', (ex) => {
            deferred.reject(ex);
            disposables.forEach((d) => d.dispose());
        });

        logProcess(file, args, options);

        return deferred.promise;
    }

    @traceDecoratorVerbose('Execing shell command', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public shellExec(command: string, @ignoreLogging() options: ShellOptions = {}): Promise<ExecutionResult<string>> {
        const shellOptions = this.getDefaultOptions(options);
        return new Promise((resolve, reject) => {
            let cancelDisposable: Disposable | undefined;
            const proc = exec(command, shellOptions, (e, stdout, stderr) => {
                cancelDisposable?.dispose();
                if (e && e !== null) {
                    reject(e);
                } else if (shellOptions.throwOnStdErr && stderr && stderr.length) {
                    reject(new Error(stderr));
                } else {
                    // Make sure stderr is undefined if we actually had none. This is checked
                    // elsewhere because that's how exec behaves.
                    resolve({ stderr: stderr && stderr.length > 0 ? stderr : undefined, stdout: stdout });
                }
            });
            if (options.token) {
                cancelDisposable = options.token.onCancellationRequested(() => {
                    if (proc.exitCode === null && !proc.killed) {
                        reject(new CancellationError());
                        ProcessService.kill(proc.pid);
                    }
                });
            }

            const disposable: IDisposable = {
                dispose: () => {
                    if (!proc.killed) {
                        ProcessService.kill(proc.pid);
                    }
                }
            };
            this.processesToKill.add(disposable);
        });
    }

    private getDefaultOptions<T extends ShellOptions | SpawnOptions>(options: T): T {
        const defaultOptions = { ...options };
        const execOptions = defaultOptions as SpawnOptions;
        if (execOptions) {
            const encoding = (execOptions.encoding =
                typeof execOptions.encoding === 'string' && execOptions.encoding.length > 0
                    ? execOptions.encoding
                    : DEFAULT_ENCODING);
            delete execOptions.encoding;
            execOptions.encoding = encoding;
        }
        if (!defaultOptions.env || Object.keys(defaultOptions.env).length === 0) {
            const env = this.env ? this.env : process.env;
            defaultOptions.env = { ...env };
        } else {
            defaultOptions.env = { ...defaultOptions.env };
        }

        // Always ensure we have unbuffered output.
        defaultOptions.env.PYTHONUNBUFFERED = '1';
        if (!defaultOptions.env.PYTHONIOENCODING) {
            defaultOptions.env.PYTHONIOENCODING = 'utf-8';
        }

        return defaultOptions;
    }
}

export function createObservable<T>() {
    const onDidChange = new EventEmitter<T>();
    const promise = createDeferred<void>();
    // No dangling promises.
    promise.promise.catch(noop);
    return {
        get onDidChange() {
            return onDidChange.event;
        },
        get done() {
            return promise.promise;
        },
        resolve: promise.resolve.bind(promise),
        reject: promise.reject.bind(promise),
        fire: onDidChange.fire.bind(onDidChange),
        dispose: () => {
            onDidChange.dispose();
        }
    };
}
