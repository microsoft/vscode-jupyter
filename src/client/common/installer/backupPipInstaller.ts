// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Disposable, OutputChannel, Progress, ProgressLocation, ProgressOptions } from 'vscode';
import { Telemetry } from '../../datascience/constants';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { IApplicationShell, IWorkspaceService } from '../application/types';
import { wrapCancellationTokens } from '../cancellation';
import { STANDARD_OUTPUT_CHANNEL } from '../constants';
import { disposeAllDisposables } from '../helpers';
import { traceError, traceVerbose } from '../logger';
import { getDisplayPath } from '../platform/fs-paths';
import { IPythonExecutionFactory } from '../process/types';
import { IDisposable, IOutputChannel, Product, Resource } from '../types';
import { DataScience } from '../utils/localize';
import { translateProductToModule } from './productInstaller';
import { ProductNames } from './productNames';

function isGlobalEnvironment(interpreter: PythonEnvironment): boolean {
    return (
        interpreter.envType === EnvironmentType.Global ||
        interpreter.envType === EnvironmentType.System ||
        interpreter.envType === EnvironmentType.WindowsStore
    );
}
function isVirtualEnv(interpreter: PythonEnvironment): boolean {
    return (
        interpreter.envType === EnvironmentType.Venv ||
        interpreter.envType === EnvironmentType.VirtualEnv ||
        interpreter.envType === EnvironmentType.VirtualEnvWrapper
    );
}
/**
 * Class used to install IPyKernel into global environments if Python extension fails to install it for what ever reason.
 * We know ipykernel can be easily installed with `python -m pip install ipykernel` for Global Python Environments.
 * Similarly for Jupyter & other python packages.
 *
 * Note: This is only a fallback, we know that sometimes Python fails to install these & Python installs them via the terminal.
 * We don't really know why it fails to install these packages.
 */

@injectable()
export class BackupPipInstaller {
    constructor(
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly outputChannel: OutputChannel,
        @inject(IPythonExecutionFactory) private readonly pythonExecFactory: IPythonExecutionFactory,
        private readonly isInstalled: (product: Product, interpreter: PythonEnvironment) => Promise<boolean | undefined>
    ) {}
    public async install(
        product: Product,
        interpreter: PythonEnvironment,
        resource: Resource,
        reInstallAndUpdate: boolean,
        token: CancellationToken
    ): Promise<boolean> {
        if (product === Product.pip) {
            traceVerbose(`We cannot pip install pip.`);
            return false;
        }
        // We can only run this installer against global & windows store enviorments.
        if (!isGlobalEnvironment(interpreter) && !isVirtualEnv(interpreter)) {
            traceVerbose(
                `We cannot pip install packages into non-Global or non-Virtual Python environments '${interpreter.envType}'.`
            );
            return false;
        }
        // Check if pip is installed.
        const isPipInstalled = await this.isInstalled(Product.pip, interpreter);
        if (isPipInstalled === undefined || isPipInstalled === false) {
            traceVerbose(`We cannot pip install packages if Pip is unavailable.`);
            return false;
        }
        try {
            // Display progress indicator if we have ability to cancel this operation from calling code.
            // This is required as its possible the installation can take a long time.
            const productName = ProductNames.get(product)!;
            const options: ProgressOptions = {
                location: ProgressLocation.Notification,
                cancellable: true,
                title: DataScience.installingModule().format(productName)
            };

            let installationResult = false;
            await this.appShell.withProgress(options, async (progress, progressToken: CancellationToken) => {
                installationResult = await this.installImplementation(
                    progress,
                    product,
                    interpreter,
                    resource,
                    reInstallAndUpdate,
                    wrapCancellationTokens(token, progressToken)
                );
            });

            if (!installationResult) {
                return false;
            }

            // Check if the package is installed.
            const isInstalled = await this.isInstalled(product, interpreter);
            traceVerbose(
                `After successfully running pip install product is ${
                    isInstalled ? '' : 'still not'
                } installed (when checking via IInstaller.isInstalled).`
            );

            sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                action: isInstalled === true ? 'installedInJupyter' : 'failedToInstallInJupyter',
                moduleName: productName,
                pythonEnvType: interpreter.envType
            });
            return isInstalled === true;
        } catch (ex) {
            const productName = ProductNames.get(product)!;
            traceError(`Failed to Pip install ${productName} into ${getDisplayPath(interpreter.path)}`, ex);
            return false;
        }
    }
    private async installImplementation(
        progress: Progress<{ message?: string; increment?: number }>,
        product: Product,
        interpreter: PythonEnvironment,
        resource: Resource,
        reInstallAndUpdate: boolean,
        token: CancellationToken
    ) {
        const service = await this.pythonExecFactory.createActivatedEnvironment({
            allowEnvironmentFetchExceptions: true,
            interpreter,
            resource
        });
        if (token.isCancellationRequested) {
            return false;
        }
        const productName = ProductNames.get(product)!;
        const isGlobalPython = isGlobalEnvironment(interpreter);
        const args = this.getInstallerArgs({ product, reinstall: reInstallAndUpdate, isGlobalPython });
        const cwd = resource ? this.workspaceService.getWorkspaceFolder(resource)?.uri.fsPath : undefined;
        this.outputChannel.appendLine(`Pip Installing ${productName} into ${getDisplayPath(interpreter.path)}`);
        this.outputChannel.appendLine('>>>>>>>>>>>>>');
        const disposables: IDisposable[] = [];
        try {
            // Ensure user sees the output.
            this.outputChannel.show(true);
            const result = await service.execModuleObservable('pip', args, { cwd });
            token.onCancellationRequested(() => result.proc?.kill(), this, disposables);
            const subscription = result.out.subscribe((output) => {
                if (token.isCancellationRequested) {
                    return;
                }
                const lines = output.out.splitLines({ removeEmptyEntries: true, trim: true });
                progress.report({ message: lines.length ? lines[lines.length - 1] : '' });
                this.outputChannel.append(output.out);
            });
            disposables.push(new Disposable(() => subscription.unsubscribe()));
            if (result.proc) {
                await new Promise<void>((resolve) => {
                    result.proc?.on('close', () => resolve());
                    result.proc?.on('exit', () => resolve());
                });
            }
            // Assume we ran this successfully (we don't check errors, just dump to output).
            traceVerbose(`Successfully ran pip installer for ${productName}`);
            return true;
        } finally {
            disposeAllDisposables(disposables);
            this.outputChannel.appendLine('\n<<<<<<<<<<<<<<');
        }
    }
    private getInstallerArgs(options: { reinstall: boolean; product: Product; isGlobalPython: boolean }): string[] {
        const args: string[] = [];
        const proxy = this.workspaceService.getConfiguration('http').get('proxy', '');
        if (proxy.length > 0) {
            args.push('--proxy');
            args.push(proxy);
        }
        args.push(...['install', '-U']);
        if (options.reinstall) {
            args.push('--force-reinstall');
        }
        if (options.isGlobalPython) {
            args.push('--user');
        }
        const moduleName = translateProductToModule(options.product);
        return [...args, moduleName];
    }
}
