// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { ChildProcess } from 'child_process';
import { kill } from 'process';
import * as fs from 'fs-extra';
import * as tmp from 'tmp';
import { CancellationToken, Event, EventEmitter } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { createPromiseFromCancellation } from '../../common/cancellation';
import {
    getErrorMessageFromPythonTraceback,
    getTelemetrySafeErrorMessageFromPythonTraceback
} from '../../common/errors/errorUtils';
import { traceDecorators, traceError, traceInfo, traceVerbose, traceWarning } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IProcessServiceFactory, IPythonExecutionFactory, ObservableExecutionResult } from '../../common/process/types';
import { Resource } from '../../common/types';
import { createDeferred } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { noop, swallowExceptions } from '../../common/utils/misc';
import { captureTelemetry } from '../../telemetry';
import { Telemetry } from '../constants';
import {
    connectionFilePlaceholder,
    findIndexOfConnectionFile,
    isPythonKernelConnection
} from '../jupyter/kernels/helpers';
import { KernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../jupyter/kernels/types';
import { IJupyterKernelSpec } from '../types';
import { KernelDaemonPool } from './kernelDaemonPool';
import { KernelEnvironmentVariablesService } from './kernelEnvVarsService';
import { PythonKernelLauncherDaemon } from './kernelLauncherDaemon';
import { IKernelConnection, IKernelProcess, IPythonKernelDaemon } from './types';
import { BaseError } from '../../common/errors/types';
import { KernelProcessExitedError } from '../errors/kernelProcessExitedError';
import { PythonKernelDiedError } from '../errors/pythonKernelDiedError';
import { KernelDiedError } from '../errors/kernelDiedError';
import { KernelPortNotUsedTimeoutError } from '../errors/kernelPortNotUsedTimeoutError';

// Launches and disposes a kernel process given a kernelspec and a resource or python interpreter.
// Exposes connection information and the process itself.
export class KernelProcess implements IKernelProcess {
    public get exited(): Event<{ exitCode?: number; reason?: string }> {
        return this.exitEvent.event;
    }
    public get kernelConnectionMetadata(): Readonly<KernelSpecConnectionMetadata | PythonKernelConnectionMetadata> {
        return this._kernelConnectionMetadata;
    }
    public get connection(): Readonly<IKernelConnection> {
        return this._connection;
    }
    private get isPythonKernel(): boolean {
        return isPythonKernelConnection(this.kernelConnectionMetadata);
    }
    public get canInterrupt() {
        if (this.pythonDaemon) {
            return true;
        }
        if (this._kernelConnectionMetadata.kernelSpec.interrupt_mode === 'message') {
            return false;
        }
        return true;
    }
    private _process?: ChildProcess;
    private exitEvent = new EventEmitter<{ exitCode?: number; reason?: string }>();
    private pythonKernelLauncher?: PythonKernelLauncherDaemon;
    private launchedOnce?: boolean;
    private disposed?: boolean;
    private pythonDaemon?: IPythonKernelDaemon;
    private connectionFile?: string;
    private _launchKernelSpec?: IJupyterKernelSpec;
    private readonly _kernelConnectionMetadata: Readonly<KernelSpecConnectionMetadata | PythonKernelConnectionMetadata>;
    constructor(
        private readonly processExecutionFactory: IProcessServiceFactory,
        private readonly daemonPool: KernelDaemonPool,
        private readonly _connection: IKernelConnection,
        kernelConnectionMetadata: KernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        private readonly fileSystem: IFileSystem,
        private readonly resource: Resource,
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly kernelEnvVarsService: KernelEnvironmentVariablesService,
        private readonly pythonExecFactory: IPythonExecutionFactory
    ) {
        this._kernelConnectionMetadata = kernelConnectionMetadata;
    }
    public async interrupt(): Promise<void> {
        if (!this.canInterrupt) {
            throw new Error('Kernel interrupt not supported in KernelProcess.ts');
        }
        if (this.pythonDaemon) {
            traceInfo('Interrupting kernel via Daemon message');
            await this.pythonDaemon.interrupt();
        } else if (this._kernelConnectionMetadata.kernelSpec.interrupt_mode !== 'message' && this._process) {
            traceInfo('Interrupting kernel via Signals');
            kill(this._process.pid, 'SIGINT');
        } else {
            traceError('No process to interrupt in KernleProcess.ts');
        }
    }

    @captureTelemetry(Telemetry.RawKernelProcessLaunch, undefined, true)
    public async launch(workingDirectory: string, timeout: number, cancelToken?: CancellationToken): Promise<void> {
        if (this.launchedOnce) {
            throw new Error('Kernel has already been launched.');
        }
        this.launchedOnce = true;

        // Update our connection arguments in the kernel spec
        await this.updateConnectionArgs();

        const exeObs = await this.launchAsObservable(workingDirectory);

        let stdout = '';
        let stderr = '';
        let stderrProc = '';
        let exitEventFired = false;
        let providedExitCode: number | null;
        const deferred = createDeferred();
        exeObs.proc!.on('exit', (exitCode) => {
            exitCode = exitCode || providedExitCode;
            traceInfo('KernelProcess Exit', `Exit - ${exitCode}`, stderrProc);
            if (this.disposed) {
                return;
            }
            if (!exitEventFired) {
                this.exitEvent.fire({
                    exitCode: exitCode || undefined,
                    reason: getTelemetrySafeErrorMessageFromPythonTraceback(stderrProc) || stderrProc
                });
                exitEventFired = true;
            }
            deferred.reject(new KernelProcessExitedError(exitCode || -1, stderr));
        });

        exeObs.proc!.stdout?.on('data', (data: Buffer | string) => {
            // We get these from execObs.out.subscribe.
            // Hence log only using traceLevel = verbose.
            // But only useful if daemon doesn't start for any reason.
            traceVerbose(`KernelProcess output: ${(data || '').toString()}`);
        });

        exeObs.proc!.stderr?.on('data', (data: Buffer | string) => {
            // We get these from execObs.out.subscribe.
            // Hence log only using traceLevel = verbose.
            // But only useful if daemon doesn't start for any reason.
            stderrProc += data.toString();
            traceVerbose(`KernelProcess error: ${(data || '').toString()}`);
        });

        exeObs.out.subscribe(
            (output) => {
                if (output.source === 'stderr') {
                    // Capture stderr, incase kernel doesn't start.
                    stderr += output.out;
                    traceWarning(`StdErr from Kernel Process ${output.out}`);
                } else {
                    stdout += output.out;
                    traceInfo(`Kernel Output: ${stdout}`);
                }
            },
            (error) => {
                if (this.disposed) {
                    traceInfo('Kernel died', error, stderr);
                    return;
                }
                traceError('Kernel died', error, stderr);
                if (error instanceof PythonKernelDiedError) {
                    providedExitCode = error.exitCode;
                    if (this.disposed) {
                        traceInfo('KernelProcess Exit', `Exit - ${error.exitCode}, ${error.reason}`, error);
                        return;
                    } else {
                        traceError('KernelProcess Exit', `Exit - ${error.exitCode}, ${error.reason}`, error);
                    }
                    if (!stderrProc && (error.stdErr || error.reason || error.message)) {
                        // This is used when process exits.
                        stderrProc = error.stdErr || error.reason || error.message;
                    }
                    if (!exitEventFired) {
                        let reason = error.reason || error.message;
                        this.exitEvent.fire({
                            exitCode: error.exitCode,
                            reason: getTelemetrySafeErrorMessageFromPythonTraceback(reason)
                        });
                        exitEventFired = true;
                    }
                    deferred.reject(error);
                }
            },
            () => {
                console.error('Completed');
            }
        );

        // Don't return until our heartbeat channel is open for connections or the kernel died or we timed out
        try {
            const tcpPortUsed = require('tcp-port-used') as typeof import('tcp-port-used');
            // Wait on shell port as this is used for communications (hence shell port is guaranteed to be used, where as heart beat isn't).
            // Wait for shell & iopub to be used (iopub is where we get a response & this is similar to what Jupyter does today).
            // Kernel must be connected to bo Shell & IoPub channels for kernel communication to work.
            const portsUsed = Promise.all([
                tcpPortUsed.waitUntilUsed(this.connection.shell_port, 200, timeout),
                tcpPortUsed.waitUntilUsed(this.connection.iopub_port, 200, timeout)
            ]).catch((ex) => {
                traceError(`waitUntilUsed timed out`, ex);
                // Throw an error we recognize.
                return Promise.reject(new KernelPortNotUsedTimeoutError(this.kernelConnectionMetadata));
            });
            await Promise.race([
                portsUsed,
                deferred.promise,
                createPromiseFromCancellation({
                    token: cancelToken,
                    cancelAction: 'reject'
                })
            ]);
        } catch (e) {
            traceError('Disposing kernel process due to an error', e);
            traceError(stderrProc || stderr);
            // Make sure to dispose if we never connect.
            void this.dispose();

            if (!cancelToken?.isCancellationRequested && e instanceof BaseError) {
                throw e;
            } else {
                // Possible this isn't an error we recognize, hence wrap it in a user friendly message.
                if (cancelToken?.isCancellationRequested) {
                    traceWarning('User cancelled the kernel launch');
                }
                // If we have the python error message in std outputs, display that.
                const errorMessage =
                    getErrorMessageFromPythonTraceback(stderrProc || stderr) ||
                    (stderrProc || stderr).substring(0, 100);
                throw new KernelDiedError(
                    localize.DataScience.kernelDied().format(errorMessage),
                    // Include what ever we have as the stderr.
                    stderrProc + '\n' + stderr + '\n',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    e as any
                );
            }
        }
    }

    public async dispose(): Promise<void> {
        traceInfo('Dispose Kernel process');
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        if (this.pythonDaemon) {
            await this.pythonDaemon.kill().catch(noop);
            swallowExceptions(() => this.pythonDaemon?.dispose());
        }
        swallowExceptions(() => {
            this._process?.kill(); // NOSONAR
            this.exitEvent.fire({});
        });
        swallowExceptions(() => this.pythonKernelLauncher?.dispose());
        swallowExceptions(async () => (this.connectionFile ? fs.remove(this.connectionFile) : noop()));
    }

    private get launchKernelSpec(): IJupyterKernelSpec {
        if (this._launchKernelSpec) {
            return this._launchKernelSpec;
        }

        let kernelSpec = this._kernelConnectionMetadata.kernelSpec;
        // We always expect a kernel spec.
        if (!kernelSpec) {
            throw new Error('KernelSpec cannot be empty in KernelProcess.ts');
        }
        if (!Array.isArray(kernelSpec.argv)) {
            traceError('KernelSpec.argv in KernelProcess is undefined');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this._launchKernelSpec = undefined;
        } else {
            // Copy our kernelspec and assign a new argv array
            this._launchKernelSpec = { ...kernelSpec, argv: [...kernelSpec.argv] };
        }
        return this._launchKernelSpec!;
    }

    // Instead of having to use a connection file update our local copy of the kernelspec to launch
    // directly with command line arguments
    private async updateConnectionArgs() {
        // First check to see if we have a kernelspec that expects a connection file,
        // Error if we don't have one. We expect '-f', '{connectionfile}' in our launch args
        const indexOfConnectionFile = findIndexOfConnectionFile(this.launchKernelSpec);

        // Technically if we don't have a kernelspec then index should already be -1, but the check here lets us avoid ? on the type
        if (indexOfConnectionFile === -1) {
            throw new Error(
                `Connection file not found in kernelspec json args, ${this.launchKernelSpec.argv.join(' ')}`
            );
        }

        if (
            this.isPythonKernel &&
            indexOfConnectionFile === 0 &&
            this.launchKernelSpec.argv[indexOfConnectionFile - 1] !== '-f'
        ) {
            throw new Error(
                `Connection file not found in kernelspec json args, ${this.launchKernelSpec.argv.join(' ')}`
            );
        }

        // Python kernels are special. Handle the extra arguments.
        if (this.isPythonKernel) {
            // Slice out -f and the connection file from the args
            this.launchKernelSpec.argv.splice(indexOfConnectionFile - 1, 2);

            // Add in our connection command line args
            this.launchKernelSpec.argv.push(...this.addPythonConnectionArgs());
        } else {
            // For other kernels, just write to the connection file.
            // Note: We have to dispose the temp file and recreate it because otherwise the file
            // system will hold onto the file with an open handle. THis doesn't work so well when
            // a different process tries to open it.
            const tempFile = await this.fileSystem.createTemporaryLocalFile('.json');
            this.connectionFile = tempFile.filePath;
            await tempFile.dispose();
            await this.fileSystem.writeLocalFile(this.connectionFile, JSON.stringify(this._connection));

            // Then replace the connection file argument with this file
            // Remmeber, non-python kernels can have argv as `--connection-file={connection_file}`,
            // hence we should not replace the entire entry, but just replace the text `{connection_file}`
            // See https://github.com/microsoft/vscode-jupyter/issues/7203
            if (this.launchKernelSpec.argv[indexOfConnectionFile].includes('--connection-file')) {
                const connectionFile = this.connectionFile.includes(' ')
                    ? `"${this.connectionFile}"` // Quoted for spaces in file paths.
                    : this.connectionFile;
                this.launchKernelSpec.argv[indexOfConnectionFile] = this.launchKernelSpec.argv[
                    indexOfConnectionFile
                ].replace(connectionFilePlaceholder, connectionFile);
            } else {
                // Even though we don't have `--connection-file` don't assume it won't be `--config-file` for other kernels.
                // E.g. in Python the name of the argument is `-f` and in.
                this.launchKernelSpec.argv[indexOfConnectionFile] = this.launchKernelSpec.argv[
                    indexOfConnectionFile
                ].replace(connectionFilePlaceholder, this.connectionFile);
            }
        }
    }

    // Add the command line arguments
    private addPythonConnectionArgs(): string[] {
        const newConnectionArgs: string[] = [];

        newConnectionArgs.push(`--ip=${this._connection.ip}`);
        newConnectionArgs.push(`--stdin=${this._connection.stdin_port}`);
        newConnectionArgs.push(`--control=${this._connection.control_port}`);
        newConnectionArgs.push(`--hb=${this._connection.hb_port}`);
        newConnectionArgs.push(`--Session.signature_scheme="${this._connection.signature_scheme}"`);
        newConnectionArgs.push(`--Session.key=b"${this._connection.key}"`); // Note we need the 'b here at the start for a byte string
        newConnectionArgs.push(`--shell=${this._connection.shell_port}`);
        newConnectionArgs.push(`--transport="${this._connection.transport}"`);
        newConnectionArgs.push(`--iopub=${this._connection.iopub_port}`);

        // Turn this on if you get desparate. It can cause crashes though as the
        // logging code isn't that robust.
        // if (isTestExecution()) {
        //     // Extra logging for tests
        //     newConnectionArgs.push(`--log-level=10`);
        // }

        // We still put in the tmp name to make sure the kernel picks a valid connection file name. It won't read it as
        // we passed in the arguments, but it will use it as the file name so it doesn't clash with other kernels.
        newConnectionArgs.push(`--f=${tmp.tmpNameSync({ postfix: '.json' })}`);

        return newConnectionArgs;
    }

    @traceDecorators.verbose('Launching kernel in kernelProcess.ts')
    private async launchAsObservable(workingDirectory: string) {
        let exeObs: ObservableExecutionResult<string> | undefined;

        // Use a daemon only if the python extension is available. It requires the active interpreter
        if (this.isPythonKernel && this.extensionChecker.isPythonExtensionInstalled) {
            this.pythonKernelLauncher = new PythonKernelLauncherDaemon(
                this.daemonPool,
                this.pythonExecFactory,
                this.kernelEnvVarsService
            );
            const kernelDaemonLaunch = await this.pythonKernelLauncher.launch(
                this.resource,
                workingDirectory,
                this.launchKernelSpec,
                this._kernelConnectionMetadata.interpreter
            );

            this.pythonDaemon = kernelDaemonLaunch.daemon;
            exeObs = kernelDaemonLaunch.observableOutput;
        }

        // If we are not python just use the ProcessExecutionFactory
        if (!exeObs) {
            // First part of argument is always the executable.
            const executable = this.launchKernelSpec.argv[0];
            traceInfo(`Launching Raw Kernel & not daemon ${this.launchKernelSpec.display_name} # ${executable}`);
            const [executionService, env] = await Promise.all([
                this.processExecutionFactory.create(this.resource),
                // Pass undefined for the interpreter here as we are not explicitly launching with a Python Environment
                // Note that there might still be python env vars to merge from the kernel spec in the case of something like
                // a Java kernel registered in a conda environment
                this.kernelEnvVarsService.getEnvironmentVariables(this.resource, undefined, this.launchKernelSpec)
            ]);

            // Add quotations to arguments if they have a blank space in them.
            // This will mainly quote paths so that they can run, other arguments shouldn't be quoted or it may cause errors.
            // The first argument is sliced because it is the executable command.
            const args = this.launchKernelSpec.argv.slice(1).map((a) => {
                // Some kernel specs (non-python) can have argv as `--connection-file={connection_file}`
                // The `connection-file` will be quoted when we update it with the real path.
                if (a.includes('--connection-file')) {
                    return a;
                }
                if (a.includes(' ')) {
                    return `"${a}"`;
                }
                return a;
            });
            exeObs = executionService.execObservable(executable, args, {
                env,
                cwd: workingDirectory
            });
        }

        if (!exeObs || !exeObs.proc) {
            throw new Error('KernelProcess failed to launch');
        }

        this._process = exeObs.proc;
        return exeObs;
    }
}
