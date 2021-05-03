// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ChildProcess } from 'child_process';
import * as fs from 'fs-extra';
import { inject, injectable } from 'inversify';
import { IDisposable } from 'monaco-editor';
import { BaseError } from '../../common/errors/types';
import { traceInfo } from '../../common/logger';
import { ObservableExecutionResult } from '../../common/process/types';
import { Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { traceDecorators } from '../../logging';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { IJupyterKernelSpec } from '../types';
import { KernelDaemonPool } from './kernelDaemonPool';
import { KernelEnvironmentVariablesService } from './kernelEnvVarsService';
import { IPythonKernelDaemon } from './types';

export class UnsupportedKernelSpec extends BaseError {
    constructor(args: string[]) {
        super(
            'unsupportedKernelSpec',
            `Unsupported KernelSpec file. args must be [<pythonPath>, '-m', <moduleName>, arg1, arg2, ..]. Provied ${args.join(
                ' '
            )}`
        );
    }
}

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
        traceInfo(`Launching kernel daemon for ${kernelSpec.display_name} # ${interpreter?.path}`);
        const [daemon, wdExists, env] = await Promise.all([
            this.daemonPool.get(resource, kernelSpec, interpreter),
            fs.pathExists(workingDirectory),
            this.kernelEnvVarsService.getEnvironmentVariables(resource, kernelSpec)
        ]);

        // Check to see if we have the type of kernelspec that we expect
        const args = kernelSpec.argv.slice();
        const modulePrefixIndex = args.findIndex((item) => item === '-m');
        if (modulePrefixIndex === -1) {
            throw new UnsupportedKernelSpec(args);
        }
        const moduleName = args[modulePrefixIndex + 1];
        const moduleArgs = args.slice(modulePrefixIndex + 2);

        // The daemon pool can return back a non-IPythonKernelDaemon if daemon service is not supported or for Python 2.
        // Use a check for the daemon.start function here before we call it.
        if (!('start' in daemon)) {
            // If we don't have a KernelDaemon here then we have an execution service and should use that to launch
            const observableOutput = daemon.execModuleObservable(moduleName, moduleArgs, {
                env,
                cwd: wdExists ? workingDirectory : process.cwd()
            });

            return { observableOutput, daemon: undefined };
        } else {
            // In the case that we do have a kernel deamon, just return it
            const observableOutput = await daemon.start(moduleName, moduleArgs, { env, cwd: workingDirectory });
            if (observableOutput.proc) {
                this.processesToDispose.push(observableOutput.proc);
            }
            return { observableOutput, daemon };
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
