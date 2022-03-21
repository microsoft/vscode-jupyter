// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, CancellationTokenSource, Progress, ProgressLocation, ProgressOptions } from 'vscode';
import { IApplicationShell } from '../../client/common/application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../client/common/constants';
import { traceError, traceInfo } from '../../client/common/logger';
import {
    IProcessServiceFactory,
    IPythonExecutionFactory,
    ObservableExecutionResult
} from '../../client/common/process/types';
import { IOutputChannel } from '../../client/common/types';
import { createDeferred } from '../../client/common/utils/async';
import { Products } from '../../client/common/utils/localize';
import { IEnvironmentVariablesService } from '../../client/common/variables/types';
import { IEnvironmentActivationService } from '../../client/interpreter/activation/types';
import { IServiceContainer } from '../../client/ioc/types';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { IModuleInstaller, ModuleInstallerType, ModuleInstallFlags, Product } from './types';

export type ExecutionInstallArgs = {
    args: string[];
    exe?: string;
    cwd?: string;
    useShellExec?: boolean;
};

@injectable()
export abstract class ModuleInstaller implements IModuleInstaller {
    public abstract get priority(): number;
    public abstract get name(): string;
    public abstract get displayName(): string;
    public abstract get type(): ModuleInstallerType;

    constructor(@inject(IServiceContainer) protected serviceContainer: IServiceContainer) {}

    public async installModule(
        productOrModuleName: Product | string,
        interpreter: PythonEnvironment,
        cancelTokenSource: CancellationTokenSource,
        flags?: ModuleInstallFlags
    ): Promise<void> {
        const name =
            typeof productOrModuleName == 'string'
                ? productOrModuleName
                : translateProductToModule(productOrModuleName);
        const args = await this.getExecutionArgs(name, interpreter, flags);
        const pythonFactory = this.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
        const procFactory = this.serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory);
        const activationHelper = this.serviceContainer.get<IEnvironmentActivationService>(
            IEnvironmentActivationService
        );
        const environmentService = this.serviceContainer.get<IEnvironmentVariablesService>(
            IEnvironmentVariablesService
        );
        if (cancelTokenSource.token.isCancellationRequested) {
            return;
        }
        const install = async (
            progress: Progress<{
                message?: string | undefined;
                increment?: number | undefined;
            }>,
            token: CancellationToken
        ) => {
            const deferred = createDeferred();
            // When the progress is canceled notify caller
            token.onCancellationRequested(() => {
                cancelTokenSource.cancel();
                deferred.resolve();
            });

            let observable: ObservableExecutionResult<string> | undefined;

            // Some installers only work with shellexec
            if (args.useShellExec) {
                const proc = await procFactory.create(undefined);
                if (cancelTokenSource.token.isCancellationRequested) {
                    return;
                }
                try {
                    const results = await proc.shellExec(args.args.join(' '), { cwd: args.cwd });
                    traceInfo(results.stdout);
                    deferred.resolve();
                } catch (ex) {
                    deferred.reject(ex);
                }
            } else if (args.exe) {
                // Args can be for a specific exe or for the interpreter. Both need to
                // use an activated environment though
                // For the exe, just figure out the environment variables.
                const envVars = await activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, false);
                if (cancelTokenSource.token.isCancellationRequested) {
                    return;
                }
                const env = { ...process.env };
                environmentService.mergeVariables(envVars || {}, env);
                environmentService.mergePaths(envVars || {}, env);
                const proc = await procFactory.create(undefined);
                if (cancelTokenSource.token.isCancellationRequested) {
                    return;
                }
                observable = proc.execObservable(args.exe, args.args, { encoding: 'utf-8', token, env, cwd: args.cwd });
            } else {
                const proc = await pythonFactory.createActivatedEnvironment({ interpreter });
                if (cancelTokenSource.token.isCancellationRequested) {
                    return;
                }
                observable = proc.execObservable(args.args, {
                    encoding: 'utf-8',
                    token,
                    cwd: args.cwd
                });
            }
            let lastStdErr: string | undefined;
            if (observable) {
                observable.out.subscribe({
                    next: (output) => {
                        progress?.report({ message: output.out });
                        traceInfo(output.out);
                        if (output.source === 'stderr') {
                            lastStdErr = output.out;
                        }
                    },
                    complete: () => {
                        if (observable?.proc?.exitCode !== 0) {
                            deferred.reject(lastStdErr || observable?.proc?.exitCode);
                        } else {
                            deferred.resolve();
                        }
                    },
                    error: (err: unknown) => {
                        deferred.reject(err);
                    }
                });
            }
            return deferred.promise;
        };

        // Display progress indicator if we have ability to cancel this operation from calling code.
        // This is required as its possible the installation can take a long time.
        // (i.e. if installation takes a long time in terminal or like, a progress indicator is necessary to let user know what is being waited on).
        const shell = this.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const options: ProgressOptions = {
            location: ProgressLocation.Notification,
            cancellable: true,
            title: Products.installingModule().format(name)
        };
        await shell.withProgress(options, async (progress, token: CancellationToken) => install(progress, token));
    }
    public abstract isSupported(interpreter: PythonEnvironment): Promise<boolean>;

    // TODO: Figure out when to elevate
    protected elevatedInstall(execPath: string, args: string[]) {
        const options = {
            name: 'VS Code Jupyter'
        };
        const outputChannel = this.serviceContainer.get<IOutputChannel>(IOutputChannel, STANDARD_OUTPUT_CHANNEL);
        const command = `"${execPath.replace(/\\/g, '/')}" ${args.join(' ')}`;

        traceInfo(`[Elevated] ${command}`);

        const sudo = require('sudo-prompt');

        sudo.exec(command, options, async (error: string, stdout: string, stderr: string) => {
            if (error) {
                const shell = this.serviceContainer.get<IApplicationShell>(IApplicationShell);
                await shell.showErrorMessage(error);
            } else {
                outputChannel.show();
                if (stdout) {
                    traceInfo(stdout);
                }
                if (stderr) {
                    traceError(`Warning: ${stderr}`);
                }
            }
        });
    }
    protected abstract getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment,
        flags?: ModuleInstallFlags
    ): Promise<ExecutionInstallArgs>;
}

export function translateProductToModule(product: Product): string {
    switch (product) {
        case Product.jupyter:
            return 'jupyter';
        case Product.notebook:
            return 'notebook';
        case Product.pandas:
            return 'pandas';
        case Product.ipykernel:
            return 'ipykernel';
        case Product.nbconvert:
            return 'nbconvert';
        case Product.kernelspec:
            return 'kernelspec';
        case Product.pip:
            return 'pip';
        case Product.ensurepip:
            return 'ensurepip';
        default: {
            throw new Error(`Product ${product} cannot be installed as a Python Module.`);
        }
    }
}
