// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess } from 'child_process';
import { kill } from 'process';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
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
import { Cancellation, isCancellationError, raceCancellationError } from '../../../platform/common/cancellation';
import {
    getTelemetrySafeErrorMessageFromPythonTraceback,
    getErrorMessageFromPythonTraceback
} from '../../../platform/errors/errorUtils';
import { BaseError } from '../../../platform/errors/types';
import { logger, ignoreLogging } from '../../../platform/logging';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IProcessServiceFactory, ObservableExecutionResult } from '../../../platform/common/process/types.node';
import {
    Resource,
    IOutputChannel,
    IJupyterSettings,
    IExperimentService,
    Experiments,
    type ReadWrite
} from '../../../platform/common/types';
import { createDeferred, raceTimeout } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { KernelDiedError } from '../../errors/kernelDiedError';
import { KernelPortNotUsedTimeoutError } from '../../errors/kernelPortNotUsedTimeoutError';
import { KernelProcessExitedError } from '../../errors/kernelProcessExitedError';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { Interrupter, PythonKernelInterruptDaemon } from '../finder/pythonKernelInterruptDaemon.node';
import { JupyterPaths } from '../finder/jupyterPaths.node';
import { ProcessService } from '../../../platform/common/process/proc.node';
import { IPlatformService } from '../../../platform/common/platform/types';
import pidtree from 'pidtree';
import { isKernelLaunchedViaLocalPythonIPyKernel } from '../../helpers.node';
import { splitLines } from '../../../platform/common/helpers';
import { IPythonExecutionFactory } from '../../../platform/interpreter/types.node';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import { ServiceContainer } from '../../../platform/ioc/container';
import { ObservableDisposable } from '../../../platform/common/utils/lifecycle';
import { getNotebookTelemetryTracker } from '../../telemetry/notebookTelemetry';

const kernelOutputWithConnectionFile = 'To connect another client to this kernel, use:';
// Exclude these warning messages, as users get confused about these when sharing logs.
// I.e. they assume that issues in Jupyter ext are due to these warnings messages from ipykernel.
export const kernelOutputToNotLog = [
    'NOTE: When using the `ipython kernel` entry point, Ctrl-C will not work.',
    'To exit, you will have to explicitly quit this process, by either sending',
    '"quit" from a client, or using Ctrl-\\ in UNIX-like environments.',
    'To read more about this, see https://github.com/ipython/ipython/issues/2049',
    'It seems that frozen modules are being used, which may',
    'make the debugger miss breakpoints. Please pass -Xfrozen_modules=off',
    'to python to disable frozen modules',
    'Debugging will proceed. Set PYDEVD_DISABLE_FILE_VALIDATION'
];

export class TcpPortUsage {
    public static async waitUntilFree(port: number, retryTimeMs: number, timeOutMs: number): Promise<void> {
        const tcpPortUsed = (await import('tcp-port-used')).default;
        await tcpPortUsed.waitUntilFree(port, retryTimeMs, timeOutMs);
    }
    public static async waitUntilUsed(port: number, retryTimeMs: number, timeOutMs: number): Promise<void> {
        const tcpPortUsed = (await import('tcp-port-used')).default;
        await tcpPortUsed.waitUntilUsed(port, retryTimeMs, timeOutMs);
    }
}
// Launches and disposes a kernel process given a kernelspec and a resource or python interpreter.
// Exposes connection information and the process itself.
export class KernelProcess extends ObservableDisposable implements IKernelProcess {
    private _pid?: number;
    private _disposingPromise?: Promise<void>;
    public get pid() {
        return this._pid;
    }
    public get exited(): Event<{ exitCode?: number; reason?: string; stderr: string }> {
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
        return (
            isPythonKernelConnection(this.kernelConnectionMetadata) &&
            isKernelLaunchedViaLocalPythonIPyKernel(this.kernelConnectionMetadata)
        );
    }
    public get canInterrupt() {
        if (this._kernelConnectionMetadata.kernelSpec.interrupt_mode === 'message') {
            return false;
        }
        return true;
    }
    private _process?: ChildProcess;
    private exitEvent = new EventEmitter<{ exitCode?: number; reason?: string; stderr: string }>();
    private launchedOnce?: boolean;
    private connectionFile?: Uri;
    private _launchKernelSpec?: ReadWrite<IJupyterKernelSpec>;
    private interrupter?: Interrupter;
    private exitEventFired = false;
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
        super();
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
            logger.info('Interrupting kernel via SIGINT');
            if (this._process.pid) {
                kill(this._process.pid, 'SIGINT');
            }
        } else if (
            this._kernelConnectionMetadata.kernelSpec.interrupt_mode !== 'message' &&
            this._process &&
            this.interrupter &&
            isPythonKernelConnection(this._kernelConnectionMetadata)
        ) {
            logger.info('Interrupting kernel via custom event (Win32)');
            return this.interrupter.interrupt();
        } else {
            logger.error('No process to interrupt in KernleProcess.ts');
        }
    }

    @capturePerfTelemetry(Telemetry.RawKernelProcessLaunch)
    public async launch(workingDirectory: string, timeout: number, cancelToken: CancellationToken): Promise<void> {
        if (this.launchedOnce) {
            throw new Error('Kernel has already been launched.');
        }
        this.launchedOnce = true;
        const tracker = getNotebookTelemetryTracker(this.resource);
        const connectionTracker = tracker?.updateConnection();
        // Update our connection arguments in the kernel spec
        await this.updateConnectionArgs();
        connectionTracker?.stop();
        Cancellation.throwIfCanceled(cancelToken);
        const spawnTracker = tracker?.spawn();
        const exeObs = await this.launchAsObservable(workingDirectory, cancelToken);
        spawnTracker?.stop();
        const proc = exeObs.proc;
        if (cancelToken.isCancellationRequested) {
            throw new CancellationError();
        }
        logger.debug(`Kernel process ${proc?.pid}.`);
        let stderr = '';
        let providedExitCode: number | null;
        const deferred = createDeferred();
        deferred.promise.catch(noop);

        if (proc) {
            const pid = proc.pid;
            proc.on('exit', (exitCode) => {
                exitCode = exitCode || providedExitCode;
                if (this.isDisposed) {
                    logger.debug(`KernelProcess Exited ${pid}, Exit Code - ${exitCode}`);
                    return;
                }
                logger.debug(`KernelProcess Exited ${pid}, Exit Code - ${exitCode}`, stderr);
                if (!this.exitEventFired) {
                    this.exitEvent.fire({
                        exitCode: exitCode || undefined,
                        reason: getTelemetrySafeErrorMessageFromPythonTraceback(stderr) || stderr,
                        stderr
                    });
                    this.exitEventFired = true;
                }
                if (!cancelToken.isCancellationRequested) {
                    logger.ci(`KernelProcessExitedError raised`, stderr);
                    deferred.reject(
                        new KernelProcessExitedError(exitCode || -1, stderr, this.kernelConnectionMetadata)
                    );
                }
            });
            let sawKernelConnectionFile = false;
            proc.stdout?.on('data', (data: Buffer | string) => {
                let output = (data || '').toString();
                // Strip unwanted stuff from the output, else it just chews up unnecessary space.
                if (isPythonKernelConnection(this.kernelConnectionMetadata) && !sawKernelConnectionFile) {
                    output = stripUnwantedMessages(output);
                    if (output.includes(kernelOutputWithConnectionFile)) {
                        output = output.trimStart();
                    }
                }
                if (output.includes(kernelOutputWithConnectionFile)) {
                    sawKernelConnectionFile = true;
                }

                logger.debug(`Kernel output ${pid}: ${output}`);
                this.sendToOutput(output);
            });

            proc.stderr?.on('data', (data: Buffer | string) => {
                // We get these from execObs.out.subscribe.
                // Hence log only using traceLevel = verbose.
                // But only useful if daemon doesn't start for any reason.
                const output = stripUnwantedMessages((data || '').toString());
                stderr += output;
                if (
                    output.trim().length &&
                    // Exclude these warning messages, as users get confused about these when sharing logs.
                    // I.e. they assume that issues in Jupyter ext are due to these warnings messages from ipykernel.
                    !output.includes('It seems that frozen modules are being used, which may') &&
                    !output.includes('make the debugger miss breakpoints. Please pass -Xfrozen_modules=off') &&
                    !output.includes('to python to disable frozen modules') &&
                    !output.includes('Debugging will proceed. Set PYDEVD_DISABLE_FILE_VALIDATION')
                ) {
                    logger.debug(`KernelProcess error ${pid}: ${output}`);
                    this.sendToOutput(output);
                }
            });
        }

        exeObs.out.done.catch((error) => {
            if (this.isDisposed) {
                logger.warn('Kernel died', error, stderr);
                return;
            }
            logger.error('Kernel died', error, stderr);
            deferred.reject(error);
        });

        // Don't return until our heartbeat channel is open for connections or the kernel died or we timed out
        const portUsageTracker = getNotebookTelemetryTracker(this.resource)?.portUsage();
        try {
            if (deferred.rejected) {
                await deferred.promise;
            }
            const doNotWaitForZmqPortsToGetUsed = ServiceContainer.instance
                .get<IExperimentService>(IExperimentService)
                .inExperiment(Experiments.DoNotWaitForZmqPortsToBeUsed);

            const stopwatch = new StopWatch();

            // Wait on shell port as this is used for communications (hence shell port is guaranteed to be used, where as heart beat isn't).
            // Wait for shell & iopub to be used (iopub is where we get a response & this is similar to what Jupyter does today).
            // Kernel must be connected to bo Shell & IoPub channels for kernel communication to work.

            // Do not wait for ports to get used in the experiment
            // Zmq does not use a client server architecture, even if
            // a peer is not up and running the messages are queued till the peer is ready to recieve.
            // No point waiting for ports to get used, see
            // https://github.com/microsoft/vscode-jupyter/issues/14835
            const portsUsed = doNotWaitForZmqPortsToGetUsed
                ? Promise.resolve()
                : Promise.all([
                      TcpPortUsage.waitUntilUsed(this.connection.shell_port, 200, timeout),
                      TcpPortUsage.waitUntilUsed(this.connection.iopub_port, 200, timeout)
                  ]).catch((ex) => {
                      if (cancelToken.isCancellationRequested || deferred.rejected) {
                          return;
                      }
                      // Do not throw an error, ignore this.
                      // In the case of VPNs the port does not seem to get used.
                      // Possible we're blocking it.
                      logger.warn(`Waited ${stopwatch.elapsedTime}ms for kernel to start`, ex);

                      // For the new experiment, we don't want to throw an error if the kernel doesn't start.
                      if (!doNotWaitForZmqPortsToGetUsed) {
                          // Throw an error we recognize.
                          return Promise.reject(new KernelPortNotUsedTimeoutError(this.kernelConnectionMetadata));
                      }
                  });
            await raceCancellationError(cancelToken, portsUsed, deferred.promise);
        } catch (e) {
            const stdErrToLog = (stderr || '').trim();
            if (!cancelToken?.isCancellationRequested && !isCancellationError(e)) {
                logger.error('Disposing kernel process due to an error', e);
                if (e && e instanceof Error && stdErrToLog.length && e.message.includes(stdErrToLog)) {
                    // No need to log the stderr as it's already part of the error message.
                } else {
                    logger.error(stdErrToLog);
                }
            }
            // Make sure to dispose if we never connect.
            await this.dispose();

            if (!cancelToken?.isCancellationRequested && e instanceof BaseError) {
                throw e;
            } else {
                // Possible this isn't an error we recognize, hence wrap it in a user friendly message.
                if (cancelToken?.isCancellationRequested) {
                    logger.debug('User cancelled the kernel launch');
                }
                // If we have the python error message in std outputs, display that.
                const errorMessage = getErrorMessageFromPythonTraceback(stdErrToLog) || stdErrToLog.substring(0, 100);
                logger.ci(`KernelDiedError raised`, errorMessage, stderr + '\n' + stderr + '\n');
                throw new KernelDiedError(
                    DataScience.kernelDied(errorMessage),
                    // Include what ever we have as the stderr.
                    stderr + '\n' + stderr + '\n',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    e as any,
                    this.kernelConnectionMetadata
                );
            }
        } finally {
            portUsageTracker?.stop();
        }
    }

    public override dispose() {
        if (this._disposingPromise) {
            return;
        }
        if (this.isDisposed) {
            return;
        }
        const pid = this._process?.pid;
        logger.debug(`Dispose Kernel process ${pid}.`);
        this._disposingPromise = (async () => {
            await raceTimeout(
                1_000, // Wait for a max of 1s, we don't want to delay killing the kernel process.
                this.killChildProcesses(this._process?.pid).catch(noop)
            );
            try {
                this.interrupter?.dispose();
                this._process?.kill(); // NOSONAR
                if (!this.exitEventFired) {
                    this.exitEvent.fire({ stderr: '' });
                }
            } catch (ex) {
                logger.error(`Error disposing kernel process ${pid}`, ex);
            }
            if (this.connectionFile) {
                await this.fileSystem
                    .delete(this.connectionFile)
                    .catch((ex) =>
                        logger.warn(`Failed to delete connection file ${this.connectionFile} for pid ${pid}`, ex)
                    );
            }
            logger.debug(`Disposed Kernel process ${pid}.`);
        })();
        void this._disposingPromise.finally(() => super.dispose()).catch(noop);
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
                            logger.warn(`Failed to kill children for ${pid}`, ex);
                        } else {
                            pids.forEach((procId) => ProcessService.kill(procId));
                        }
                        resolve();
                    });
                });
            }
        } catch (ex) {
            logger.warn(`Failed to kill children for ${pid}`, ex);
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
            logger.error('KernelSpec.argv in KernelProcess is undefined');
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

        const runtimeDir = await this.jupyterPaths.getRuntimeDir();
        const connectionFileName = `kernel-v3${crypto.randomBytes(20).toString('hex')}.json`;
        this.connectionFile = Uri.joinPath(runtimeDir, connectionFileName);

        // Python kernels are special. Handle the extra arguments.
        if (this.isPythonKernel) {
            // Slice out -f and the connection file from the args
            this.launchKernelSpec.argv.splice(indexOfConnectionFile - 1, 2);

            // Add in our connection command line args
            this.launchKernelSpec.argv.push(...this.addPythonConnectionArgs(this.connectionFile));
            await this.fileSystem.writeFile(this.connectionFile, JSON.stringify(this._connection));
        } else {
            await this.fileSystem.writeFile(this.connectionFile, JSON.stringify(this._connection));

            // Replace the connection file argument with this file
            // Remember, non-python kernels can have argv as `--connection-file={connection_file}`,
            // hence we should not replace the entire entry, but just replace the text `{connection_file}`
            // See https://github.com/microsoft/vscode-jupyter/issues/7203
            const quotedConnectionFile = this.connectionFile.fsPath.includes(' ')
                ? `"${this.connectionFile.fsPath}"` // Quoted for spaces in file paths.
                : this.connectionFile.fsPath;
            if (this.launchKernelSpec.argv[indexOfConnectionFile].includes('--connection-file')) {
                this.launchKernelSpec.argv[indexOfConnectionFile] = this.launchKernelSpec.argv[
                    indexOfConnectionFile
                ].replace(connectionFilePlaceholder, quotedConnectionFile);
            } else if (
                this.launchKernelSpec.argv[indexOfConnectionFile].includes(`=${connectionFilePlaceholder}`) &&
                !this.launchKernelSpec.argv[indexOfConnectionFile].trim().startsWith('=')
            ) {
                this.launchKernelSpec.argv[indexOfConnectionFile] = this.launchKernelSpec.argv[
                    indexOfConnectionFile
                ].replace(connectionFilePlaceholder, quotedConnectionFile);
            } else {
                // Even though we don't have `--connection-file=${connection_file}` don't assume it won't be `--config-file=${connection_file}` for other kernels.
                // E.g. in Python the name of the argument is `-f` instead of `--connection-file`.
                this.launchKernelSpec.argv[indexOfConnectionFile] = this.launchKernelSpec.argv[
                    indexOfConnectionFile
                ].replace(connectionFilePlaceholder, this.connectionFile.fsPath);
            }
        }
    }
    // Add the command line arguments
    private addPythonConnectionArgs(connectionFile: Uri): string[] {
        const newConnectionArgs: string[] = [];

        // Turn this on if you get desparate. It can cause crashes though as the
        // logging code isn't that robust.
        // if (isTestExecution()) {
        //     // Extra logging for tests
        //     newConnectionArgs.push(`--log-level=10`);
        // }

        // We still put in the tmp name to make sure the kernel picks a valid connection file name. It won't read it as
        // we passed in the arguments, but it will use it as the file name so it doesn't clash with other kernels.
        const connectionFileValue = connectionFile.fsPath.includes(' ')
            ? `"${connectionFile.fsPath}"` // Quoted for spaces in file paths.
            : connectionFile.fsPath;
        newConnectionArgs.push(`--f=${connectionFileValue}`);

        return newConnectionArgs;
    }

    private async launchAsObservable(workingDirectory: string, @ignoreLogging() cancelToken: CancellationToken) {
        let exeObs: ObservableExecutionResult<string>;
        logger.debug(
            `Launching kernel ${this.kernelConnectionMetadata.id} for ${getDisplayPath(
                this.resource
            )} in ${getDisplayPath(workingDirectory)} with ports ${this.connection.control_port}, ${
                this.connection.hb_port
            }, ${this.connection.iopub_port}, ${this.connection.shell_port}, ${this.connection.stdin_port}`
        );
        if (
            this.isPythonKernel &&
            this.extensionChecker.isPythonExtensionInstalled &&
            this._kernelConnectionMetadata.interpreter
        ) {
            const tracker = getNotebookTelemetryTracker(this.resource);
            const [pythonEnvVars, envVars, win32InterruptHandle] = [
                tracker?.pythonEnvVars(),
                tracker?.envVars(),
                os.platform() === 'win32' ? tracker?.interruptHandle() : undefined
            ];
            const executionServicePromise = this.pythonExecFactory.createActivatedEnvironment({
                resource: this.resource,
                interpreter: this._kernelConnectionMetadata.interpreter
            });
            const handlePromise =
                os.platform() === 'win32'
                    ? this.getWin32InterruptHandle().finally(() => win32InterruptHandle?.stop())
                    : win32InterruptHandle?.stop();

            let [executionService, wdExists, env] = await Promise.all([
                executionServicePromise.finally(() => pythonEnvVars?.stop()),
                fs.pathExists(workingDirectory),
                this.kernelEnvVarsService
                    .getEnvironmentVariables(
                        this.resource,
                        this._kernelConnectionMetadata.interpreter,
                        this._kernelConnectionMetadata.kernelSpec,
                        cancelToken
                    )
                    .finally(() => envVars?.stop())
            ]);

            Cancellation.throwIfCanceled(cancelToken);

            // On windows, in order to support interrupt, we have to set an environment variable pointing to a WIN32 event handle
            if (os.platform() === 'win32' && handlePromise) {
                env = env || process.env;
                try {
                    const handle = await handlePromise;

                    // See the code ProcessPollingWindows inside of ipykernel for it listening to this event handle.
                    env.JPY_INTERRUPT_EVENT = `${handle}`;
                    logger.ci(
                        `Got interrupt handle kernel id ${handle} for interpreter ${this._kernelConnectionMetadata.interpreter.id}`
                    );
                } catch (ex) {
                    logger.error(
                        `Failed to get interrupt handle kernel id ${this._kernelConnectionMetadata.id} for interpreter ${this._kernelConnectionMetadata.interpreter.id}`,
                        ex
                    );
                }
            }
            Cancellation.throwIfCanceled(cancelToken);

            // The kernelspec argv could be something like [python, main.py, --something, --something-else, -f,{connection_file}]
            const args = this.launchKernelSpec.argv.slice(1); // Remove the python part of the command
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
            logger.info(`Launching Raw Kernel ${this.launchKernelSpec.display_name} # ${executable}`);
            const [executionService, env] = await Promise.all([
                this.processExecutionFactory.create(this.resource, cancelToken),
                // If we have an interpreter always use that, its possible we are launching a kernel that is associated with a Python environment
                // E.g. we could be dealing with a Java/R kernel registered in a conda environment.
                // Note that there might still be python env vars to merge from the kernel spec in the case of something like
                // a Java kernel registered in a conda environment
                this.kernelEnvVarsService.getEnvironmentVariables(
                    this.resource,
                    this._kernelConnectionMetadata.interpreter,
                    this.launchKernelSpec,
                    cancelToken
                )
            ]);
            Cancellation.throwIfCanceled(cancelToken);
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

function stripUnwantedMessages(output: string) {
    // We would like to remove the unnecessary warning from ipykernel that ends up confusing users when things go wrong.
    // The message we want to remove is:
    //          '..../site-packages/traitlets/traitlets.py:2202: FutureWarning: Supporting extra quotes around strings is deprecated in traitlets 5.0. You can use 'hmac-sha256' instead of '"hmac-sha256"' if you require traitlets >=5.
    //          warn(
    ///         .../site-packages/traitlets/traitlets.py:2157: FutureWarning: Supporting extra quotes around Bytes is deprecated in traitlets 5.0. Use '841dde17-f6aa-4ea7-9c02-b3bb414b28b3' instead of 'b"841dde17-f6aa-4ea7-9c02-b3bb414b28b3"'.
    //          warn(
    let lines = splitLines(output, { trim: true, removeEmptyEntries: true });
    if (
        (lines.some((line) =>
            line.includes(`FutureWarning: Supporting extra quotes around strings is deprecated in traitlets 5.0.`)
        ) &&
            lines.some((line) => line.trim() === 'warn(') &&
            lines.some((line) =>
                line.includes(`FutureWarning: Supporting extra quotes around Bytes is deprecated in traitlets 5.0.`)
            )) ||
        lines.some((line) => kernelOutputToNotLog.some((item) => line.includes(item)))
    ) {
        // No point displaying false positives.
        // The message `.../site-packages/traitlets/traitlets.py:2548: FutureWarning: Supporting extra quotes around strings is deprecated in traitlets 5.0. You can use 'hmac-sha256' instead of '"hmac-sha256"' if you require traitlets >=5.`
        // always confuses users, and leads them to the assumption that this is the reason for the kernel not starting or the like.
        return lines
            .filter((line) => {
                return (
                    !line.endsWith(
                        `FutureWarning: Supporting extra quotes around strings is deprecated in traitlets 5.0. You can use 'hmac-sha256' instead of '"hmac-sha256"' if you require traitlets >=5.`
                    ) &&
                    line.trim() !== 'warn(' &&
                    !line.includes(
                        `FutureWarning: Supporting extra quotes around Bytes is deprecated in traitlets 5.0. Use`
                    ) &&
                    kernelOutputToNotLog.every((item) => !line.includes(item))
                );
            })
            .join(os.EOL)
            .trimStart();
    }
    return output;
}
