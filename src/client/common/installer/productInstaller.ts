/* eslint-disable max-classes-per-file */

import { inject, injectable, named } from 'inversify';
import { CancellationToken, CancellationTokenSource, Memento, OutputChannel, Uri } from 'vscode';
import { IPythonInstaller } from '../../api/types';
import '../../common/extensions';
import { InterpreterPackages } from '../../datascience/telemetry/interpreterPackages';
import { IServiceContainer } from '../../ioc/types';
import { logValue } from '../../logging/trace';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { getInterpreterHash } from '../../pythonEnvironments/info/interpreter';
import { IApplicationShell, IWorkspaceService } from '../application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../constants';
import { disposeAllDisposables } from '../helpers';
import { traceDecorators, traceError, traceInfo } from '../logger';
import { IPlatformService } from '../platform/types';
import { IProcessServiceFactory, IPythonExecutionFactory } from '../process/types';
import {
    IConfigurationService,
    IDisposable,
    IInstaller,
    InstallerResponse,
    IOutputChannel,
    ModuleNamePurpose,
    Product
} from '../types';
import { sleep } from '../utils/async';
import { isResource } from '../utils/misc';
import { BackupPipInstaller } from './backupPipInstaller';
import { ProductNames } from './productNames';
import { InterpreterUri, IProductPathService } from './types';

export { Product } from '../types';

/**
 * Keep track of the fact that we attempted to install a package into an interpreter.
 * (don't care whether it was successful or not).
 */
export async function trackPackageInstalledIntoInterpreter(
    memento: Memento,
    product: Product,
    interpreter: InterpreterUri
) {
    if (isResource(interpreter)) {
        return;
    }
    const key = `${getInterpreterHash(interpreter)}#${ProductNames.get(product)}`;
    await memento.update(key, true);
}
export async function clearInstalledIntoInterpreterMemento(
    memento: Memento,
    product: Product,
    interpreterPath: string
) {
    const key = `${getInterpreterHash({ path: interpreterPath })}#${ProductNames.get(product)}`;
    await memento.update(key, undefined);
}
export function isModulePresentInEnvironmentCache(memento: Memento, product: Product, interpreter: PythonEnvironment) {
    const key = `${getInterpreterHash(interpreter)}#${ProductNames.get(product)}`;
    return false && memento.get<boolean>(key, false);
}
export async function isModulePresentInEnvironment(memento: Memento, product: Product, interpreter: PythonEnvironment) {
    const key = `${getInterpreterHash(interpreter)}#${ProductNames.get(product)}`;
    if (memento.get(key, false)) {
        return true;
    }
    const packageName = translateProductToModule(product);
    const packageVersionPromise = InterpreterPackages.getPackageVersion(interpreter, packageName)
        .then((version) => (typeof version === 'string' ? 'found' : 'notfound'))
        .catch((ex) => traceError('Failed to get interpreter package version', ex));
    try {
        // Dont wait for too long we don't want to delay installation prompt.
        const version = await Promise.race([sleep(500), packageVersionPromise]);
        if (typeof version === 'string') {
            return version === 'found';
        }
    } catch (ex) {
        traceError(`Failed to check if package exists ${ProductNames.get(product)}`);
    }
}

export abstract class BaseInstaller {
    protected readonly appShell: IApplicationShell;
    protected readonly configService: IConfigurationService;

    constructor(protected serviceContainer: IServiceContainer, protected outputChannel: OutputChannel) {
        this.appShell = serviceContainer.get<IApplicationShell>(IApplicationShell);
        this.configService = serviceContainer.get<IConfigurationService>(IConfigurationService);
    }

    public async install(
        product: Product,
        resource?: InterpreterUri,
        cancel?: CancellationToken,
        reInstallAndUpdate?: boolean,
        installPipIfRequired?: boolean
    ): Promise<InstallerResponse> {
        return this.serviceContainer
            .get<IPythonInstaller>(IPythonInstaller)
            .install(product, resource, cancel, reInstallAndUpdate, installPipIfRequired);
    }
    @traceDecorators.verbose('Checking if product is installed')
    public async isInstalled(
        product: Product,
        @logValue('path') interpreter: PythonEnvironment
    ): Promise<boolean | undefined> {
        const executableName = this.getExecutableNameFromSettings(product, undefined);

        const isModule = this.isExecutableAModule(product, undefined);
        if (isModule) {
            const pythonProcess = await this.serviceContainer
                .get<IPythonExecutionFactory>(IPythonExecutionFactory)
                .createActivatedEnvironment({ resource: undefined, interpreter, allowEnvironmentFetchExceptions: true });
            return pythonProcess.isModuleInstalled(executableName);
        } else {
            const process = await this.serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory).create(undefined);
            return process
                .exec(executableName, ['--version'], { mergeStdOutErr: true })
                .then(() => true)
                .catch(() => false);
        }
    }

    protected getExecutableNameFromSettings(product: Product, resource?: Uri): string {
        const productPathService = this.serviceContainer.get<IProductPathService>(IProductPathService);
        return productPathService.getExecutableNameFromSettings(product, resource);
    }
    protected isExecutableAModule(product: Product, resource?: Uri): Boolean {
        const productPathService = this.serviceContainer.get<IProductPathService>(IProductPathService);
        return productPathService.isExecutableAModule(product, resource);
    }
}

export class DataScienceInstaller extends BaseInstaller {
    private readonly backupPipInstaller: BackupPipInstaller;
    private readonly workspaceService: IWorkspaceService;
    private readonly isWindows: boolean;
    constructor(serviceContainer: IServiceContainer, outputChannel: OutputChannel) {
        super(serviceContainer, outputChannel);
        this.workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        this.backupPipInstaller = new BackupPipInstaller(
            serviceContainer.get<IApplicationShell>(IApplicationShell),
            this.workspaceService,
            outputChannel,
            serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory),
            this.isInstalled.bind(this)
        );
        this.isWindows = serviceContainer.get<IPlatformService>(IPlatformService).isWindows;
    }
    // Override base installer to support a more DS-friendly streamlined installation.
    public async install(
        product: Product,
        interpreterUri?: InterpreterUri,
        cancel?: CancellationToken,
        reInstallAndUpdate?: boolean,
        installPipIfRequired?: boolean
    ): Promise<InstallerResponse> {
        // Precondition
        if (isResource(interpreterUri)) {
            throw new Error('All data science packages require an interpreter be passed in');
        }
        const installer = this.serviceContainer.get<IPythonInstaller>(IPythonInstaller);

        // At this point we know that `interpreterUri` is of type PythonInterpreter
        const interpreter = interpreterUri as PythonEnvironment;

        // If we're on windows and user is using a non default terminal profile, then Python installer will fail to install
        // the packages in the terminal (such terminals profiles are not supported by Python extension).
        // Hence if we can detect such cases we'll install this ourselves the terminal.
        let result = InstallerResponse.Ignore;
        let attemptedToInstallUsingOurInstaller = false;
        if (this.isWindows && !this.isUsingKnownDefaultTerminalProfileOnWindows) {
            attemptedToInstallUsingOurInstaller = true;
            const installedInternally = await this.installWithPipWithoutTerminal(
                product,
                interpreter,
                cancel,
                reInstallAndUpdate
            );
            if (installedInternally) {
                traceInfo(`Successfully installed with Jupyter extension`);
                result = InstallerResponse.Installed;
            }
        }
        traceInfo(`Got result from python installer for ${ProductNames.get(product)}, result = ${result}`);
        if (cancel?.isCancellationRequested) {
            return InstallerResponse.Ignore;
        }
        // If we weren't able to install ourselves, then fall back to the base installer (which uses the Python extension).
        // We'll try this option even if we know things might not work for non-default terminla profiles (possible it has been fixed or the like)
        // Basically try all options..
        if (result !== InstallerResponse.Installed) {
            result = await installer.install(product, interpreter, cancel, reInstallAndUpdate, installPipIfRequired);
            traceInfo(`Got result from python installer for ${ProductNames.get(product)}, result = ${result}`);
        }
        if (cancel?.isCancellationRequested) {
            return InstallerResponse.Ignore;
        }
        if (result === InstallerResponse.Disabled || result === InstallerResponse.Ignore) {
            // If we have failed to install with Python and haven't tried our installer, then try it.
            if (this.isWindows && !attemptedToInstallUsingOurInstaller) {
                const installedInternally = await this.installWithPipWithoutTerminal(
                    product,
                    interpreter,
                    cancel,
                    reInstallAndUpdate
                );
                if (installedInternally) {
                    traceInfo(`Successfully installed with Jupyter extension`);
                    result = InstallerResponse.Installed;
                }
            }

            return result;
        }

        return this.isInstalled(product, interpreter).then(async (isInstalled) => {
            return isInstalled ? InstallerResponse.Installed : InstallerResponse.Ignore;
        });
    }
    public get isUsingKnownDefaultTerminalProfileOnWindows() {
        const value = (
            this.workspaceService.getConfiguration('terminal').get<string>('integrated.defaultProfile.windows', '') ||
            ''
        ).toLowerCase();
        return value.length === 0 || value.includes('powershell') || value.includes('command');
    }

    private async installWithPipWithoutTerminal(
        product: Product,
        interpreter: PythonEnvironment,
        cancel?: CancellationToken,
        reInstallAndUpdate?: boolean
    ): Promise<boolean> {
        const disposables: IDisposable[] = [];
        if (!cancel) {
            const token = new CancellationTokenSource();
            disposables.push(token);
            cancel = token.token;
        }
        try {
            const result = await this.backupPipInstaller.install(
                product,
                interpreter,
                undefined,
                reInstallAndUpdate === true,
                cancel!
            );
            return result;
        } catch (ex) {
            traceError(`Failed to install Pip`);
            return false;
        } finally {
            disposeAllDisposables(disposables);
        }
    }
}

@injectable()
export class ProductInstaller implements IInstaller {
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private outputChannel: OutputChannel
    ) {}

    // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
    public dispose() {}
    public async install(
        product: Product,
        resource: InterpreterUri,
        cancel?: CancellationToken,
        reInstallAndUpdate?: boolean,
        installPipIfRequired?: boolean
    ): Promise<InstallerResponse> {
        return this.createInstaller().install(product, resource, cancel, reInstallAndUpdate, installPipIfRequired);
    }
    public async isInstalled(product: Product, interpreter: PythonEnvironment): Promise<boolean | undefined> {
        return this.createInstaller().isInstalled(product, interpreter);
    }
    public translateProductToModuleName(product: Product, _purpose: ModuleNamePurpose): string {
        return translateProductToModule(product);
    }
    private createInstaller(): BaseInstaller {
        return new DataScienceInstaller(this.serviceContainer, this.outputChannel);
    }
}

// eslint-disable-next-line complexity
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
        default: {
            throw new Error(`Product ${product} cannot be installed as a Python Module.`);
        }
    }
}
