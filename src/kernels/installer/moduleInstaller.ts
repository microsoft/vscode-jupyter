// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { CancellationToken, Progress, ProgressLocation, ProgressOptions } from 'vscode';
import { IApplicationShell } from '../../client/common/application/types';
import { wrapCancellationTokens } from '../../client/common/cancellation';
import { STANDARD_OUTPUT_CHANNEL } from '../../client/common/constants';
import { traceError, traceInfo } from '../../client/common/logger';
import { IPythonExecutionFactory } from '../../client/common/process/types';
import { IOutputChannel } from '../../client/common/types';
import { createDeferred } from '../../client/common/utils/async';
import { Products } from '../../client/common/utils/localize';
import { IServiceContainer } from '../../client/ioc/types';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { IModuleInstaller, ModuleInstallerType, ModuleInstallFlags, Product } from './types';

@injectable()
export abstract class ModuleInstaller implements IModuleInstaller {
    public abstract get priority(): number;
    public abstract get name(): string;
    public abstract get displayName(): string;
    public abstract get type(): ModuleInstallerType;

    constructor(protected serviceContainer: IServiceContainer) {}

    public async installModule(
        productOrModuleName: Product | string,
        interpreter: PythonEnvironment,
        cancel?: CancellationToken,
        flags?: ModuleInstallFlags
    ): Promise<void> {
        const name =
            typeof productOrModuleName == 'string'
                ? productOrModuleName
                : translateProductToModule(productOrModuleName);
        const args = await this.getExecutionArgs(name, interpreter, flags);
        const procFactory = this.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
        const install = async (
            progress?: Progress<{
                message?: string | undefined;
                increment?: number | undefined;
            }>,
            token?: CancellationToken
        ) => {
            const installArgs = await this.processInstallArgs(args, interpreter);
            const proc = await procFactory.createActivatedEnvironment({ interpreter });
            const deferred = createDeferred();
            const observable = proc.execObservable(installArgs, {
                encoding: 'utf-8',
                token,
                throwOnStdErr: true
            });
            if (observable) {
                observable.out.subscribe({
                    next: (output) => {
                        if (output.source === 'stdout') {
                            progress?.report({ message: output.out });
                        }
                    },
                    complete: () => {
                        deferred.resolve();
                    }
                });
            }
            return deferred.promise;
        };

        // Display progress indicator if we have ability to cancel this operation from calling code.
        // This is required as its possible the installation can take a long time.
        // (i.e. if installation takes a long time in terminal or like, a progress indicator is necessary to let user know what is being waited on).
        if (cancel) {
            const shell = this.serviceContainer.get<IApplicationShell>(IApplicationShell);
            const options: ProgressOptions = {
                location: ProgressLocation.Notification,
                cancellable: true,
                title: Products.installingModule().format(name)
            };
            await shell.withProgress(options, async (progress, token: CancellationToken) =>
                install(progress, wrapCancellationTokens(token, cancel))
            );
        } else {
            await install(undefined, cancel);
        }
    }
    public abstract isSupported(interpreter: PythonEnvironment): Promise<boolean>;

    // TODO: Figure out when to elevate
    protected elevatedInstall(execPath: string, args: string[]) {
        const options = {
            name: 'VS Code Python'
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
    ): Promise<string[]>;
    private processInstallArgs(args: string[], interpreter: PythonEnvironment): string[] {
        const indexOfPylint = args.findIndex((arg) => arg.toUpperCase() === 'PYLINT');
        if (indexOfPylint === -1) {
            return args;
        }
        // If installing pylint on python 2.x, then use pylint~=1.9.0
        if (interpreter && interpreter.version && interpreter.version.major === 2) {
            const newArgs = [...args];
            // This command could be sent to the terminal, hence '<' needs to be escaped for UNIX.
            newArgs[indexOfPylint] = '"pylint<2.0.0"';
            return newArgs;
        }
        return args;
    }
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
