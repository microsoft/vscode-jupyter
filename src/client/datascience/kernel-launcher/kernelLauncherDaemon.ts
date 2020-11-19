// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ChildProcess } from 'child_process';
import * as fs from 'fs-extra';
import { inject, injectable } from 'inversify';
import { IDisposable } from 'monaco-editor';
import { traceError } from '../../common/logger';
import { IPlatformService } from '../../common/platform/types';
import { ObservableExecutionResult } from '../../common/process/types';
import { Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { IEnvironmentVariablesService } from '../../common/variables/types';
import { IEnvironmentActivationService } from '../../interpreter/activation/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { IJupyterKernelSpec } from '../types';
import { KernelDaemonPool } from './kernelDaemonPool';
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
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IEnvironmentActivationService) private readonly envActivation: IEnvironmentActivationService,
        @inject(IEnvironmentVariablesService) private readonly envVarsService: IEnvironmentVariablesService,
        @inject(IPlatformService) private readonly platformService: IPlatformService
    ) {}
    public async launch(
        resource: Resource,
        workingDirectory: string,
        kernelSpec: IJupyterKernelSpec,
        interpreter?: PythonEnvironment
    ): Promise<{ observableOutput: ObservableExecutionResult<string>; daemon: IPythonKernelDaemon | undefined }> {
        const [daemon, wdExists, env] = await Promise.all([
            this.daemonPool.get(resource, kernelSpec, interpreter),
            fs.pathExists(workingDirectory),
            this.getEnvironmentVariables(resource, kernelSpec)
        ]);

        // Check to see if we have the type of kernelspec that we expect
        const args = kernelSpec.argv.slice();
        const modulePrefixIndex = args.findIndex((item) => item === '-m');
        if (modulePrefixIndex === -1) {
            throw new Error(
                `Unsupported KernelSpec file. args must be [<pythonPath>, '-m', <moduleName>, arg1, arg2, ..]. Provied ${args.join(
                    ' '
                )}`
            );
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
    /**
     * If the kernel belongs to a conda environment, then use the env variables of the conda environment and merge that with the env variables of the kernel spec.
     * In the case of some kernels such as java, the kernel spec contains the cli as such `argv = ['java', 'xyz']`.
     * The first argument is an executable, and it is not in the current path.
     * However, when activating the conda env, the path variables are updated to set path to the location where the java executable is located.
     */
    private async getEnvironmentVariables(resource: Resource, kernelSpec: IJupyterKernelSpec) {
        let kernelEnv = kernelSpec.env && Object.keys(kernelSpec.env).length > 0 ? kernelSpec.env : undefined;
        if (!kernelSpec.interpreterPath) {
            return kernelEnv;
        }
        const interpreter = await this.interpreterService
            .getInterpreterDetails(kernelSpec.interpreterPath)
            .catch((ex) => {
                traceError('Failed to fetch interpreter information for interpreter that owns a kernel', ex);
                return undefined;
            });

        if (interpreter?.envType !== EnvironmentType.Conda) {
            return kernelEnv;
        }
        const interpreterEnv = await this.envActivation.getActivatedEnvironmentVariables(resource, interpreter, true);
        if (!interpreterEnv) {
            return kernelEnv;
        }

        // Merge the env variables with that of the kernel env.
        const mergedVars = { ...process.env };
        kernelEnv = kernelEnv || {};
        this.envVarsService.mergeVariables(interpreterEnv, mergedVars);
        this.envVarsService.mergeVariables(kernelEnv, mergedVars);
        if (kernelEnv[this.platformService.pathVariableName]) {
            this.envVarsService.appendPath(mergedVars, kernelEnv[this.platformService.pathVariableName]!);
        }
        if (process.env[this.platformService.pathVariableName]) {
            this.envVarsService.appendPath(mergedVars, process.env[this.platformService.pathVariableName]!);
        }
        if (kernelEnv.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars, kernelEnv.PYTHONPATH);
        }
        if (process.env.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars, process.env.PYTHONPATH);
        }
        return mergedVars;
    }
}
