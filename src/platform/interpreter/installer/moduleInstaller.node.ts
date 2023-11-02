// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CancellationTokenSource, Progress, ProgressLocation, ProgressOptions } from 'vscode';
import { IApplicationShell } from '../../common/application/types';
import { traceVerbose } from '../../logging';
import { IProcessServiceFactory, ObservableExecutionResult } from '../../common/process/types.node';
import { createDeferred } from '../../common/utils/async';
import { Products } from '../../common/utils/localize';
import { IEnvironmentVariablesService } from '../../common/variables/types';
import { IEnvironmentActivationService } from '../activation/types';
import { IServiceContainer } from '../../ioc/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { IModuleInstaller, ModuleInstallerType, ModuleInstallFlags, Product } from './types';
import { translateProductToModule } from './utils';
import { EOL } from 'os';
import { PackageNotInstalledWindowsLongPathNotEnabledError } from '../../errors/packageNotInstalledWindowsLongPathNotEnabledError';
import { splitLines } from '../../common/helpers';
import { IPythonExecutionFactory } from '../types.node';
import { Environment } from '@vscode/python-extension';
import { IDisposable } from '../../common/types';
import { dispose } from '../../common/helpers';

export type ExecutionInstallArgs = {
    args: string[];
    exe?: string;
    cwd?: string;
    useShellExec?: boolean;
};

/**
 * Base class for all module installers.
 */
export abstract class ModuleInstaller implements IModuleInstaller {
    public abstract get priority(): number;
    public abstract get name(): string;
    public abstract get displayName(): string;
    public abstract get type(): ModuleInstallerType;

    constructor(protected serviceContainer: IServiceContainer) {}

    public async installModule(
        productOrModuleName: Product | string,
        interpreter: PythonEnvironment | Environment,
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
        const activationHelper =
            this.serviceContainer.get<IEnvironmentActivationService>(IEnvironmentActivationService);
        const environmentService =
            this.serviceContainer.get<IEnvironmentVariablesService>(IEnvironmentVariablesService);
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
            const disposables: IDisposable[] = [];
            // When the progress is canceled notify caller
            token.onCancellationRequested(
                () => {
                    cancelTokenSource.cancel();
                    deferred.resolve();
                },
                this,
                disposables
            );

            let observable: ObservableExecutionResult<string> | undefined;

            // Some installers only work with shellexec
            if (args.useShellExec) {
                const proc = await procFactory.create(undefined);
                if (cancelTokenSource.token.isCancellationRequested) {
                    return;
                }
                try {
                    const results = await proc.shellExec(args.args.join(' '), { cwd: args.cwd });
                    traceVerbose(results.stdout);
                    deferred.resolve();
                } catch (ex) {
                    deferred.reject(ex);
                }
            } else if (args.exe) {
                // Args can be for a specific exe or for the interpreter. Both need to
                // use an activated environment though
                // For the exe, just figure out the environment variables.
                const envVars = await activationHelper.getActivatedEnvironmentVariables(undefined, interpreter);
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
            let couldNotInstallErr: string | undefined;
            const ticker = ['.', '..', '...'];
            let counter = 0;
            if (observable) {
                observable.out.onDidChange(
                    (output) => {
                        const suffix = ticker[counter % 3];
                        const trimmedOutput = output.out.trim();
                        counter += 1;
                        const message =
                            trimmedOutput.length > 28 ? `${trimmedOutput.substring(0, 28)}${suffix}` : trimmedOutput;
                        progress.report({ message });
                        traceVerbose(output.out);
                        if (output.source === 'stderr') {
                            // https://github.com/microsoft/vscode-jupyter/issues/12703
                            // Sometimes on windows we get an error that says "ERROR: Could not install packages due to an OSError: [Errno 2] No such file or directory:"
                            // Look for such errors so we can provide a better error message to the user.
                            if (couldNotInstallErr) {
                                couldNotInstallErr += output.out;
                            } else if (
                                !couldNotInstallErr &&
                                output.out.includes('ERROR: Could not install packages')
                            ) {
                                couldNotInstallErr = output.out.substring(
                                    output.out.indexOf('ERROR: Could not install packages')
                                );
                            }

                            lastStdErr = output.out;
                        }
                    },
                    this,
                    disposables
                );
                observable.out.done
                    .then(
                        () => {
                            if (observable?.proc?.exitCode !== 0) {
                                // https://github.com/microsoft/vscode-jupyter/issues/12703
                                // `ERROR: Could not install packages due to an OSError: [Errno 2] No such file or directory: 'C:\\Users\\donjayamanne\\AppData\\Local\\Packages\\PythonSoftwareFoundation.Python.3.10_qbz5n2kfra8p0\\LocalCache\\local-packages\\Python310\\site-packages\\jedi\\third_party\\typeshed\\third_party\\2and3\\requests\\packages\\urllib3\\packages\\ssl_match_hostname\\_implementation.pyi'
                                // HINT: This error might have occurred since this system does not have Windows Long Path support enabled. You can find information on how to enable this at https://pip.pypa.io/warnings/enable-long-paths`;
                                // Remove the `[notice]` lines from the error messages
                                if (
                                    couldNotInstallErr &&
                                    couldNotInstallErr.includes('https://pip.pypa.io/warnings/enable-long-paths')
                                ) {
                                    couldNotInstallErr = splitLines(couldNotInstallErr, {
                                        trim: true,
                                        removeEmptyEntries: true
                                    })
                                        .filter((line) => !line.startsWith('[notice]'))
                                        .join(EOL);
                                    deferred.reject(
                                        new PackageNotInstalledWindowsLongPathNotEnabledError(
                                            productOrModuleName,
                                            interpreter,
                                            couldNotInstallErr
                                        )
                                    );
                                } else {
                                    deferred.reject(lastStdErr || observable?.proc?.exitCode);
                                }
                            } else {
                                deferred.resolve();
                            }
                        },
                        (err: unknown) => {
                            deferred.reject(err);
                        }
                    )
                    .finally(() => dispose(disposables));
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
            title: Products.installingModule(name)
        };
        await shell.withProgress(options, async (progress, token: CancellationToken) => install(progress, token));
    }
    public abstract isSupported(interpreter: PythonEnvironment | Environment): Promise<boolean>;
    protected abstract getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment | Environment,
        flags?: ModuleInstallFlags
    ): Promise<ExecutionInstallArgs>;
}
