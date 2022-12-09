// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { ChildProcess } from 'child_process';
import { kill } from 'process';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from '../../../platform/vscode-path/path';
import { CancellationError, CancellationToken, Event, EventEmitter, Uri } from 'vscode';
import {
    connectionFilePlaceholder,
    findIndexOfConnectionFile,
    isPythonKernelConnection
} from '../../../kernels/helpers';
import {
    IJupyterKernelSpec,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../kernels/types';
import { IKernelConnection, IKernelProcess } from '../types';
import { KernelEnvironmentVariablesService } from './kernelEnvVarsService.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import {
    Cancellation,
    createPromiseFromCancellation,
    isCancellationError
} from '../../../platform/common/cancellation';
import {
    getTelemetrySafeErrorMessageFromPythonTraceback,
    getErrorMessageFromPythonTraceback
} from '../../../platform/errors/errorUtils';
import { BaseError } from '../../../platform/errors/types';
import {
    traceInfo,
    traceError,
    traceVerbose,
    traceWarning,
    traceInfoIfCI,
    traceDecoratorVerbose,
    ignoreLogging
} from '../../../platform/logging';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import {
    IProcessServiceFactory,
    IPythonExecutionFactory,
    ObservableExecutionResult,
    IProcessService
} from '../../../platform/common/process/types.node';
import { Resource, IOutputChannel, IJupyterSettings } from '../../../platform/common/types';
import { createDeferred, sleep } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop, swallowExceptions } from '../../../platform/common/utils/misc';
import { KernelDiedError } from '../../errors/kernelDiedError';
import { KernelPortNotUsedTimeoutError } from '../../errors/kernelPortNotUsedTimeoutError';
import { KernelProcessExitedError } from '../../errors/kernelProcessExitedError';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { Interrupter, PythonKernelInterruptDaemon } from '../finder/pythonKernelInterruptDaemon.node';
import { TraceOptions } from '../../../platform/logging/types';
import { JupyterPaths } from '../finder/jupyterPaths.node';
import { ProcessService } from '../../../platform/common/process/proc.node';
import { IPlatformService } from '../../../platform/common/platform/types';
import pidtree from 'pidtree';

const kernelOutputWithConnectionFile = 'To connect another client to this kernel, use:';
const kernelOutputToNotLog =
    'NOTE: When using the `ipython kernel` entry point, Ctrl-C will not work.\n\nTo exit, you will have to explicitly quit this process, by either sending\n"quit" from a client, or using Ctrl-\\ in UNIX-like environments.\n\nTo read more about this, see https://github.com/ipython/ipython/issues/2049\n\n\n';

// Launches and disposes a kernel process given a kernelspec and a resource or python interpreter.
// Exposes connection information and the process itself.
export class KernelProcess implements IKernelProcess {
    private _pid?: number;
    private _disposingPromise?: Promise<void>;
    public get pid() {
        return this._pid;
    }
    public get exited(): Event<{ exitCode?: number; reason?: string }> {
        return this.exitEvent.event;
    }
    public get kernelConnectionMetadata(): Readonly<
        LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata
    > {
        return this._kernelConnectionMetadata;
    }
    public get connection(): Readonly<IKernelConnection> {
        return this._connection;
    }
    private get isPythonKernel(): boolean {
        return isPythonKernelConnection(this.kernelConnectionMetadata);
    }
    public get canInterrupt() {
        if (this._kernelConnectionMetadata.kernelSpec.interrupt_mode === 'message') {
            return false;
        }
        return true;
    }
    private _process?: ChildProcess;
    private exitEvent = new EventEmitter<{ exitCode?: number; reason?: string }>();
    private launchedOnce?: boolean;
    private disposed?: boolean;
    private connectionFile?: string;
    private _launchKernelSpec?: IJupyterKernelSpec;
    private interrupter?: Interrupter;
    private readonly _kernelConnectionMetadata: Readonly<
        LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata
    >;
    constructor(
        private readonly processExecutionFactory: IProcessServiceFactory,
        private readonly _connection: IKernelConnection,
        kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        private readonly fileSystem: IFileSystemNode,
        private readonly resource: Resource,
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly kernelEnvVarsService: KernelEnvironmentVariablesService,
        private readonly pythonExecFactory: IPythonExecutionFactory,
        private readonly outputChannel: IOutputChannel | undefined,
        private readonly jupyterSettings: IJupyterSettings,
        private readonly jupyterPaths: JupyterPaths,
        private readonly pythonKernelInterruptDaemon: PythonKernelInterruptDaemon,
        private readonly platform: IPlatformService
    ) {
        this._kernelConnectionMetadata = kernelConnectionMetadata;
    }
    public async interrupt(): Promise<void> {
        if (!this.canInterrupt) {
            throw new Error('Kernel interrupt not supported in KernelProcess.ts');
        } else if (
            this._kernelConnectionMetadata.kernelSpec.interrupt_mode !== 'message' &&
            this._process &&
            !this.interrupter
        ) {
            traceInfo('Interrupting kernel via SIGINT');
            if (this._process.pid) {
                kill(this._process.pid, 'SIGINT');
            }
        } else if (
            this._kernelConnectionMetadata.kernelSpec.interrupt_mode !== 'message' &&
            this._process &&
            this.interrupter &&
            isPythonKernelConnection(this._kernelConnectionMetadata)
        ) {
            traceInfo('Interrupting kernel via custom event (Win32)');
            return this.interrupter.interrupt();
        } else {
            traceError('No process to interrupt in KernleProcess.ts');
        }
    }

    @capturePerfTelemetry(Telemetry.RawKernelProcessLaunch)
    public async launch(workingDirectory: string, timeout: number, cancelToken: CancellationToken): Promise<void> {
        if (this.launchedOnce) {
            throw new Error('Kernel has already been launched.');
        }
        this.launchedOnce = true;

        // Update our connection arguments in the kernel spec
        await this.updateConnectionArgs();
        Cancellation.throwIfCanceled(cancelToken);
        const exeObs = await this.launchAsObservable(workingDirectory, cancelToken);
        if (cancelToken.isCancellationRequested) {
            throw new CancellationError();
        }

        let stdout = '';
        let stderr = '';
        let stderrProc = '';
        let exitEventFired = false;
        let providedExitCode: number | null;
        const deferred = createDeferred();
        deferred.promise.catch(noop);
        exeObs.proc!.on('exit', (exitCode) => {
            exitCode = exitCode || providedExitCode;
            traceVerbose('KernelProcess Exit', `Exit - ${exitCode}`, stderrProc);
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
            if (!cancelToken.isCancellationRequested) {
                traceInfoIfCI(`KernelProcessExitedError raised`, stderr);
                deferred.reject(new KernelProcessExitedError(exitCode || -1, stderr, this.kernelConnectionMetadata));
            }
        });

        exeObs.proc!.stdout?.on('data', (data: Buffer | string) => {
            // We get these from execObs.out.subscribe.
            // Hence log only using traceLevel = verbose.
            // But only useful if daemon doesn't start for any reason.
            traceVerbose(`KernelProcess output: ${(data || '').toString()}`);
            this.sendToOutput((data || '').toString());
        });

        exeObs.proc!.stderr?.on('data', (data: Buffer | string) => {
            // We get these from execObs.out.subscribe.
            // Hence log only using traceLevel = verbose.
            // But only useful if daemon doesn't start for any reason.
            stderrProc += data.toString();
            traceVerbose(`KernelProcess error: ${(data || '').toString()}`);
            this.sendToOutput((data || '').toString());
        });

        let sawKernelConnectionFile = false;
        exeObs.out.subscribe(
            (output) => {
                if (output.source === 'stderr') {
                    if (!sawKernelConnectionFile) {
                        // We would like to remove the unnecessary warning from ipykernel that ends up confusing users when things go wrong.
                        // The message we want to remove is:
                        //          '..../site-packages/traitlets/traitlets.py:2202: FutureWarning: Supporting extra quotes around strings is deprecated in traitlets 5.0. You can use 'hmac-sha256' instead of '"hmac-sha256"' if you require traitlets >=5.
                        //          warn(
                        ///         .../site-packages/traitlets/traitlets.py:2157: FutureWarning: Supporting extra quotes around Bytes is deprecated in traitlets 5.0. Use '841dde17-f6aa-4ea7-9c02-b3bb414b28b3' instead of 'b"841dde17-f6aa-4ea7-9c02-b3bb414b28b3"'.
                        //          warn(
                        const lines = output.out.splitLines({ trim: true, removeEmptyEntries: true });
                        if (
                            lines.length === 4 &&
                            lines[0].endsWith(
                                `FutureWarning: Supporting extra quotes around strings is deprecated in traitlets 5.0. You can use 'hmac-sha256' instead of '"hmac-sha256"' if you require traitlets >=5.`
                            ) &&
                            lines[1] === 'warn(' &&
                            lines[2].includes(
                                `FutureWarning: Supporting extra quotes around Bytes is deprecated in traitlets 5.0. Use`
                            ) &&
                            lines[3] === 'warn('
                        ) {
                            return;
                        }
                    }
                    // Capture stderr, incase kernel doesn't start.
                    stderr += output.out;

                    traceWarning(`StdErr from Kernel Process ${output.out}`);
                } else {
                    stdout += output.out;
                    // Strip unwanted stuff from the output, else it just chews up unnecessary space.
                    if (!sawKernelConnectionFile) {
                        stdout = stdout.replace(kernelOutputToNotLog, '');
                        stdout = stdout.replace(kernelOutputToNotLog.split(/\r?\n/).join(os.EOL), '');
                        // Strip the leading space, as we've removed some leading text.
                        stdout = stdout.trimStart();
                        const lines = stdout.splitLines({ trim: true, removeEmptyEntries: true });
                        if (
                            lines.length === 2 &&
                            lines[0] === kernelOutputWithConnectionFile &&
                            lines[1].startsWith('--existing') &&
                            lines[1].endsWith('.json')
                        ) {
                            stdout = `${lines.join(' ')}${os.EOL}`;
                        }
                    }
                    if (stdout.includes(kernelOutputWithConnectionFile)) {
                        sawKernelConnectionFile = true;
                    }
                    traceVerbose(`Kernel Output: ${stdout}`);
                }
                this.sendToOutput(output.out);
            },
            (error) => {
                if (this.disposed) {
                    traceWarning('Kernel died', error, stderr);
                    return;
                }
                traceError('Kernel died', error, stderr);
                deferred.reject(error);
            }
        );

        // Don't return until our heartbeat channel is open for connections or the kernel died or we timed out
        try {
            if (deferred.rejected) {
                await deferred.promise;
            }
            const tcpPortUsed = require('tcp-port-used') as typeof import('tcp-port-used');
            // Wait on shell port as this is used for communications (hence shell port is guaranteed to be used, where as heart beat isn't).
            // Wait for shell & iopub to be used (iopub is where we get a response & this is similar to what Jupyter does today).
            // Kernel must be connected to bo Shell & IoPub channels for kernel communication to work.
            const portsUsed = Promise.all([
                tcpPortUsed.waitUntilUsed(this.connection.shell_port, 200, timeout),
                tcpPortUsed.waitUntilUsed(this.connection.iopub_port, 200, timeout)
            ]).catch((ex) => {
                if (cancelToken.isCancellationRequested || deferred.rejected) {
                    return;
                }
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
            if (!cancelToken?.isCancellationRequested && !isCancellationError(e)) {
                traceError('Disposing kernel process due to an error', e);
                traceError(stderrProc || stderr);
            }
            // Make sure to dispose if we never connect.
            await this.dispose();

            if (!cancelToken?.isCancellationRequested && e instanceof BaseError) {
                throw e;
            } else {
                // Possible this isn't an error we recognize, hence wrap it in a user friendly message.
                if (cancelToken?.isCancellationRequested) {
                    traceVerbose('User cancelled the kernel launch');
                }
                // If we have the python error message in std outputs, display that.
                const errorMessage =
                    getErrorMessageFromPythonTraceback(stderrProc || stderr) ||
                    (stderrProc || stderr).substring(0, 100);
                traceInfoIfCI(`KernelDiedError raised`, errorMessage, stderrProc + '\n' + stderr + '\n');
                throw new KernelDiedError(
                    DataScience.kernelDied().format(errorMessage),
                    // Include what ever we have as the stderr.
                    stderrProc + '\n' + stderr + '\n',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    e as any,
                    this.kernelConnectionMetadata
                );
            }
        }
    }

    public async dispose(): Promise<void> {
        if (this._disposingPromise) {
            return this._disposingPromise;
        }
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const pid = this._process?.pid;
        traceInfo(`Dispose Kernel process ${pid}.`);
        this._disposingPromise = (async () => {
            await Promise.race([
                sleep(1_000), // Wait for a max of 1s, we don't want to delay killing the kernel process.
                this.killChildProcesses(this._process?.pid).catch(noop)
            ]);
            try {
                this.interrupter?.dispose().ignoreErrors();
                this._process?.kill(); // NOSONAR
                this.exitEvent.fire({});
            } catch (ex) {
                traceError(`Error disposing kernel process ${pid}`, ex);
            }
            swallowExceptions(async () => {
                if (this.connectionFile) {
                    await this.fileSystem
                        .delete(Uri.file(this.connectionFile))
                        .catch((ex) =>
                            traceWarning(`Failed to delete connection file ${this.connectionFile} for pid ${pid}`, ex)
                        );
                }
            });
            traceVerbose(`Disposed Kernel process ${pid}.`);
        })();
    }

    private async killChildProcesses(pid?: number) {
        // Do not remove this code, in in unit tests we end up running this,
        // then we run into the danger of kill all of the processes on the machine.
        // because calling `pidtree` without a pid will return all pids and hence everything ends up getting killed.
        if (!pid || !ProcessService.isAlive(pid)) {
            return;
        }
        try {
            if (this.platform.isWindows) {
                const windir = process.env['WINDIR'] || 'C:\\Windows';
                const TASK_KILL = path.join(windir, 'System32', 'taskkill.exe');
                await new ProcessService().exec(TASK_KILL, ['/F', '/T', '/PID', pid.toString()]);
            } else {
                await new Promise<void>((resolve) => {
                    pidtree(pid, (ex: unknown, pids: number[]) => {
                        if (ex) {
                            traceWarning(`Failed to kill children for ${pid}`, ex);
                        } else {
                            pids.forEach((procId) => ProcessService.kill(procId));
                        }
                        resolve();
                    });
                });
            }
        } catch (ex) {
            traceWarning(`Failed to kill children for ${pid}`, ex);
        }
    }

    private sendToOutput(data: string) {
        if (this.outputChannel) {
            this.outputChannel.append(data);
        }
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

        this.connectionFile = await this.createConnectionFile();
        // Python kernels are special. Handle the extra arguments.
        if (this.isPythonKernel) {
            // Slice out -f and the connection file from the args
            this.launchKernelSpec.argv.splice(indexOfConnectionFile - 1, 2);

            // Add in our connection command line args
            this.launchKernelSpec.argv.push(...this.addPythonConnectionArgs());
        } else {
            await this.fileSystem.writeFile(Uri.file(this.connectionFile), JSON.stringify(this._connection));

            // Replace the connection file argument with this file
            // Remember, non-python kernels can have argv as `--connection-file={connection_file}`,
            // hence we should not replace the entire entry, but just replace the text `{connection_file}`
            // See https://github.com/microsoft/vscode-jupyter/issues/7203
            const connectionFile = this.connectionFile.includes(' ')
                ? `"${this.connectionFile}"` // Quoted for spaces in file paths.
                : this.connectionFile;
            if (this.launchKernelSpec.argv[indexOfConnectionFile].includes('--connection-file')) {
                this.launchKernelSpec.argv[indexOfConnectionFile] = this.launchKernelSpec.argv[
                    indexOfConnectionFile
                ].replace(connectionFilePlaceholder, connectionFile);
            } else {
                // Even though we don't have `--connection-file` don't assume it won't be `--config-file` for other kernels.
                // E.g. in Python the name of the argument is `-f` and in.
                this.launchKernelSpec.argv[indexOfConnectionFile] = this.launchKernelSpec.argv[
                    indexOfConnectionFile
                ].replace(connectionFilePlaceholder, connectionFile);
            }
        }
    }
    private async createConnectionFile() {
        const runtimeDir = await this.jupyterPaths.getRuntimeDir();
        const tempFile = await this.fileSystem.createTemporaryLocalFile({
            fileExtension: '.json',
            prefix: 'kernel-v2-'
        });
        // Note: We have to dispose the temp file and recreate it else the file
        // system will hold onto the file with an open handle. THis doesn't work so well when
        // a different process tries to open it.
        const connectionFile = runtimeDir
            ? path.join(runtimeDir.fsPath, path.basename(tempFile.filePath))
            : tempFile.filePath;
        // Ensure we dispose this, and don't maintain a handle on this file.
        await tempFile.dispose(); // Do not remove this line.
        return connectionFile;
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
        const connectionFile = this.connectionFile!.includes(' ')
            ? `"${this.connectionFile}"` // Quoted for spaces in file paths.
            : this.connectionFile;
        newConnectionArgs.push(`--f=${connectionFile}`);

        return newConnectionArgs;
    }

    @traceDecoratorVerbose('Launching kernel in kernelProcess.ts', TraceOptions.Arguments | TraceOptions.BeforeCall)
    private async launchAsObservable(workingDirectory: string, @ignoreLogging() cancelToken: CancellationToken) {
        let exeObs: ObservableExecutionResult<string>;

        if (
            this.isPythonKernel &&
            this.extensionChecker.isPythonExtensionInstalled &&
            this._kernelConnectionMetadata.interpreter
        ) {
            const executionServicePromise = this.pythonExecFactory.createActivatedEnvironment({
                resource: this.resource,
                interpreter: this._kernelConnectionMetadata.interpreter
            });

            let [executionService, wdExists, env] = await Promise.all([
                executionServicePromise,
                fs.pathExists(workingDirectory),
                this.kernelEnvVarsService.getEnvironmentVariables(
                    this.resource,
                    this._kernelConnectionMetadata.interpreter,
                    this._kernelConnectionMetadata.kernelSpec
                )
            ]);

            // On windows, in order to support interrupt, we have to set an environment variable pointing to a WIN32 event handle
            if (os.platform() === 'win32') {
                env = env || process.env;
                try {
                    const handle = await this.getWin32InterruptHandle();

                    // See the code ProcessPollingWindows inside of ipykernel for it listening to this event handle.
                    env.JPY_INTERRUPT_EVENT = `${handle}`;
                    traceInfoIfCI(
                        `Got interrupt handle kernel id ${handle} for interpreter ${this._kernelConnectionMetadata.interpreter.id}`
                    );
                } catch (ex) {
                    traceError(
                        `Failed to get interrupt handle kernel id ${this._kernelConnectionMetadata.id} for interpreter ${this._kernelConnectionMetadata.interpreter.id}`,
                        ex
                    );
                }
            }

            // The kernelspec argv could be something like [python, main.py, --something, --something-else, -f,{connection_file}]
            const args = this.launchKernelSpec.argv.slice(1);
            if (this.jupyterSettings.enablePythonKernelLogging) {
                args.push('--debug');
            }
            exeObs = executionService.execObservable(args, {
                cwd: wdExists ? workingDirectory : process.cwd(),
                env
            });
            Cancellation.throwIfCanceled(cancelToken);
        } else {
            // If we are not python just use the ProcessExecutionFactory
            // First part of argument is always the executable.
            const executable = this.launchKernelSpec.argv[0];
            traceInfo(`Launching Raw Kernel ${this.launchKernelSpec.display_name} # ${executable}`);
            const promiseCancellation = createPromiseFromCancellation({ token: cancelToken, cancelAction: 'reject' });
            const [executionService, env] = await Promise.all([
                Promise.race([
                    this.processExecutionFactory.create(this.resource),
                    promiseCancellation as Promise<IProcessService>
                ]),
                // Pass undefined for the interpreter here as we are not explicitly launching with a Python Environment
                // Note that there might still be python env vars to merge from the kernel spec in the case of something like
                // a Java kernel registered in a conda environment
                Promise.race([
                    this.kernelEnvVarsService.getEnvironmentVariables(this.resource, undefined, this.launchKernelSpec),
                    promiseCancellation as Promise<NodeJS.ProcessEnv | undefined>
                ])
            ]);
            // The first argument is sliced because it is the executable command.
            const args = this.launchKernelSpec.argv.slice(1);
            exeObs = executionService.execObservable(executable, args, {
                env,
                cwd: workingDirectory
            });
        }

        if (!exeObs.proc) {
            throw new Error('KernelProcess failed to launch');
        }
        this._process = exeObs.proc;
        this._pid = exeObs.proc.pid;
        return exeObs;
    }

    private async getWin32InterruptHandle(): Promise<number> {
        if (!this.interrupter) {
            this.interrupter = await this.pythonKernelInterruptDaemon.createInterrupter(
                this._kernelConnectionMetadata.interpreter!,
                this.resource
            );
        }
        return this.interrupter.handle;
    }
}
