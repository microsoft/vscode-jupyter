// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ChildProcess } from 'child_process';
import * as fs from 'fs-extra';
import { inject, injectable } from 'inversify';
import { traceInfo } from '../../common/logger';
import { getDisplayPath } from '../../common/platform/fs-paths';
import { IPythonExecutionFactory, ObservableExecutionResult } from '../../common/process/types';
import { IDisposable, Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { traceDecorators } from '../../logging';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { IJupyterKernelSpec } from '../types';
import { KernelDaemonPool } from './kernelDaemonPool';
import { KernelEnvironmentVariablesService } from './kernelEnvVarsService';
import { IPythonKernelDaemon } from './types';

/**
 * Launches a Python kernel in a daemon.
 * We need a daemon for the sole purposes of being able to interrupt kernels in Windows.
 * (Else we don't need a kernel).
 */
@injectable()
export class PythonKernelLauncherDaemon implements IDisposable {
    private readonly processesToDispose: ChildProcess[] = [];
    constructor(
        @inject(KernelDaemonPool) private readonly daemonPool: KernelDaemonPool,
        @inject(IPythonExecutionFactory) private readonly pythonExecFactory: IPythonExecutionFactory,
        @inject(KernelEnvironmentVariablesService)
        private readonly kernelEnvVarsService: KernelEnvironmentVariablesService
    ) {}
    @traceDecorators.verbose('Launching kernel daemon')
    public async launch(
        resource: Resource,
        workingDirectory: string,
        kernelSpec: IJupyterKernelSpec,
        interpreter?: PythonEnvironment
    ): Promise<{ observableOutput: ObservableExecutionResult<string>; daemon: IPythonKernelDaemon | undefined }> {
        // Check to see if we this is a python kernel that we can start using our daemon.
        const args = kernelSpec.argv.slice();
        const modulePrefixIndex = args.findIndex((item) => item === '-m');
        const moduleName = modulePrefixIndex === -1 ? undefined : args[modulePrefixIndex + 1];

        // Launch using the daemon only if its a regular Python kernel (ipykernel or ipykernel_launcher)
        // Such kernels are launched using `python -m ipykernel` & our code will handle them.
        // If its not a regular kernel, then just launch this kenel using regular python executable.
        const isRegularIPyKernel =
            moduleName && ['ipykernel', 'ipykernel_launcher'].includes((moduleName || '').toLowerCase());

        if (!isRegularIPyKernel || !moduleName) {
            // If we don't have a module in kernelspec argv such as `[python, -m, ipykernel]`
            // Then just launch the python kernel as a regular python executable without the daemon.
            // Possible we're running regular code such as `python xyz.py` or `python -m abc` (ansible, or other kernels)
            const executionServicePromise = this.pythonExecFactory.createActivatedEnvironment({
                resource,
                interpreter,
                bypassCondaExecution: true
            });

            traceInfo(`Launching kernel daemon for ${kernelSpec.display_name} # ${getDisplayPath(interpreter?.path)}`);
            const [executionService, wdExists, env] = await Promise.all([
                executionServicePromise,
                fs.pathExists(workingDirectory),
                this.kernelEnvVarsService.getEnvironmentVariables(resource, interpreter, kernelSpec)
            ]);

            // If we don't have a KernelDaemon here & we're not running a Python module either.
            // The kernelspec argv could be something like [python, main.py, --something, --something-else, -f,{connection_file}]
            const observableOutput = executionService.execObservable(args.slice(1), {
                cwd: wdExists ? workingDirectory : process.cwd(),
                env
            });
            return { observableOutput, daemon: undefined };
        }

        const executionServicePromise = this.daemonPool.get(resource, kernelSpec, interpreter);
        traceInfo(`Launching kernel daemon for ${kernelSpec.display_name} # ${getDisplayPath(interpreter?.path)}`);
        const [executionService, wdExists, env] = await Promise.all([
            executionServicePromise,
            fs.pathExists(workingDirectory),
            this.kernelEnvVarsService.getEnvironmentVariables(resource, interpreter, kernelSpec)
        ]);

        const moduleArgs = args.slice(modulePrefixIndex + 2);

        // The daemon pool can return back a non-IPythonKernelDaemon if daemon service is not supported or for Python 2.
        // Use a check for the daemon.start function here before we call it.
        if (!('start' in executionService)) {
            // If we don't have a KernelDaemon here then we have an execution service and should use that to launch
            const observableOutput = executionService.execModuleObservable(moduleName, moduleArgs, {
                env,
                cwd: wdExists ? workingDirectory : process.cwd()
            });

            return { observableOutput, daemon: undefined };
        } else {
            // In the case that we do have a kernel deamon, just return it
            const observableOutput = await executionService.start(moduleName, moduleArgs, {
                env,
                cwd: workingDirectory
            });
            if (observableOutput.proc) {
                this.processesToDispose.push(observableOutput.proc);
            }
            return { observableOutput, daemon: executionService };
        }
    }
    public dispose() {
        while (this.processesToDispose.length) {
            try {
                this.processesToDispose.shift()!.kill();
            } catch {
                noop();
            }
        }
    }
}
