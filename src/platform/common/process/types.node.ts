// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, ExecOptions, SpawnOptions as ChildProcessSpawnOptions } from 'child_process';
import { Observable } from 'rxjs/Observable';
import { CancellationToken } from 'vscode';

import { BaseError } from '../../errors/types';
import { IDisposable, Resource } from '../types';

export const IBufferDecoder = Symbol('IBufferDecoder');
export interface IBufferDecoder {
    decode(buffers: Buffer[]): string;
}

export type Output<T extends string | Buffer> = {
    source: 'stdout' | 'stderr';
    out: T;
};
export type ObservableExecutionResult<T extends string | Buffer> = {
    proc: ChildProcess | undefined;
    out: Observable<Output<T>>;
    dispose(): void;
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export type SpawnOptions = ChildProcessSpawnOptions & {
    encoding?: string;
    token?: CancellationToken;
    mergeStdOutErr?: boolean;
    throwOnStdErr?: boolean;
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export type ShellOptions = ExecOptions & { throwOnStdErr?: boolean; token?: CancellationToken };

export type ExecutionResult<T extends string | Buffer> = {
    stdout: T;
    stderr?: T;
};

export const IProcessLogger = Symbol('IProcessLogger');
export interface IProcessLogger {
    logProcess(file: string, ars: string[], options?: SpawnOptions): void;
}

export interface IProcessService extends IDisposable {
    execObservable(file: string, args: string[], options?: SpawnOptions): ObservableExecutionResult<string>;
    exec(file: string, args: string[], options?: SpawnOptions): Promise<ExecutionResult<string>>;
    shellExec(command: string, options?: ShellOptions): Promise<ExecutionResult<string>>;
    on(event: 'exec', listener: (file: string, args: string[], options?: SpawnOptions) => void): this;
}

export const IProcessServiceFactory = Symbol('IProcessServiceFactory');

export interface IProcessServiceFactory {
    create(resource: Resource, cancelToken?: CancellationToken): Promise<IProcessService>;
}

/**
 * Error thrown when a Daemon emits output on stderr
 *
 * Cause:
 * Something the daemon is doing is emitting an error on stderr.
 *
 * Handled by:
 *
 */
export class StdErrError extends BaseError {
    constructor(message: string) {
        super('unknown', message);
    }
}
