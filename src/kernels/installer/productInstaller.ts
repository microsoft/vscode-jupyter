/* eslint-disable max-classes-per-file */

import { inject, injectable, named } from 'inversify';
import * as semver from 'semver';
import { CancellationTokenSource, Event, EventEmitter, Memento, Uri } from 'vscode';
import { translateProductToModule } from './moduleInstaller';
import { ProductNames } from './productNames';
import {
    IInstallationChannelManager,
    IInstaller,
    InstallerResponse,
    IProductPathService,
    IProductService,
    ModuleInstallFlags,
    Product,
    ProductInstallStatus,
    ProductType
} from './types';
import { traceDecorators } from '../../client/logging';
import { logValue } from '../../client/logging/trace';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { IApplicationShell, IWorkspaceService } from '../../client/common/application/types';
import { traceError } from '../../client/common/logger';
import { IPythonExecutionFactory, IProcessServiceFactory } from '../../client/common/process/types';
import {
    IConfigurationService,
    IPersistentStateFactory,
    GLOBAL_MEMENTO,
    IMemento,
    IOutputChannel,
    InterpreterUri
} from '../../client/common/types';
import { isResource } from '../../client/common/utils/misc';
import { IServiceContainer } from '../../client/ioc/types';
import { sendTelemetryEvent } from '../../client/telemetry';
import { InterpreterPackages } from '../../client/datascience/telemetry/interpreterPackages';
import { getInterpreterHash } from '../../client/pythonEnvironments/info/interpreter';
import { noop, sleep } from '../../test/core';
import { Telemetry } from '../../datascience-ui/common/constants';
import { STANDARD_OUTPUT_CHANNEL } from '../../client/common/constants';

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
    return memento.get<boolean>(key, false);
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

abstract class BaseInstaller {
    protected readonly appShell: IApplicationShell;

    protected readonly configService: IConfigurationService;

    protected readonly workspaceService: IWorkspaceService;

    private readonly productService: IProductService;

    protected readonly persistentStateFactory: IPersistentStateFactory;

    constructor(protected serviceContainer: IServiceContainer, _outputChannel: IOutputChannel) {
        this.appShell = serviceContainer.get<IApplicationShell>(IApplicationShell);
        this.configService = serviceContainer.get<IConfigurationService>(IConfigurationService);
        this.workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        this.productService = serviceContainer.get<IProductService>(IProductService);
        this.persistentStateFactory = serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
    }

    public async install(
        product: Product,
        interpreter: PythonEnvironment,
        cancelTokenSource: CancellationTokenSource,
        reInstallAndUpdate?: boolean,
        installPipIfRequired?: boolean
    ): Promise<InstallerResponse> {
        const channels = this.serviceContainer.get<IInstallationChannelManager>(IInstallationChannelManager);
        const installer = await channels.getInstallationChannel(product, interpreter);
        if (!installer) {
            return InstallerResponse.Ignore;
        }
        if (cancelTokenSource.token.isCancellationRequested) {
            return InstallerResponse.Cancelled;
        }
        let flags =
            reInstallAndUpdate === true
                ? ModuleInstallFlags.updateDependencies | ModuleInstallFlags.reInstall
                : undefined;
        if (installPipIfRequired === true) {
            flags = flags ? flags | ModuleInstallFlags.installPipIfRequired : ModuleInstallFlags.installPipIfRequired;
        }
        await installer.installModule(product, interpreter, cancelTokenSource, flags);
        if (cancelTokenSource.token.isCancellationRequested) {
            return InstallerResponse.Cancelled;
        }
        return this.isInstalled(product, interpreter).then((isInstalled) => {
            return isInstalled ? InstallerResponse.Installed : InstallerResponse.Ignore;
        });
    }

    /**
     *
     * @param product A product which supports SemVer versioning.
     * @param semVerRequirement A SemVer version requirement.
     * @param resource A URI or a PythonEnvironment.
     */
    public async isProductVersionCompatible(
        product: Product,
        semVerRequirement: string,
        interpreter: PythonEnvironment
    ): Promise<ProductInstallStatus> {
        const version = await this.getProductSemVer(product, interpreter);
        if (!version) {
            return ProductInstallStatus.NotInstalled;
        }
        if (semver.satisfies(version, semVerRequirement)) {
            return ProductInstallStatus.Installed;
        }
        return ProductInstallStatus.NeedsUpgrade;
    }

    /**
     *
     * @param product A product which supports SemVer versioning.
     * @param resource A URI or a PythonEnvironment.
     */
    private async getProductSemVer(product: Product, interpreter: PythonEnvironment): Promise<semver.SemVer | null> {
        const executableName = this.getExecutableNameFromSettings(product, undefined);
        const isModule = this.isExecutableAModule(product, undefined);

        let version;
        if (isModule) {
            const pythonProcess = await this.serviceContainer
                .get<IPythonExecutionFactory>(IPythonExecutionFactory)
                .createActivatedEnvironment({ interpreter, allowEnvironmentFetchExceptions: true });
            const args = ['-c', `import ${executableName}; print(${executableName}.__version__)`];
            const result = await pythonProcess.exec(args, { mergeStdOutErr: true });
            version = result.stdout.trim();
        } else {
            const process = await this.serviceContainer
                .get<IProcessServiceFactory>(IProcessServiceFactory)
                .create(undefined);
            const result = await process.exec(executableName, ['--version'], { mergeStdOutErr: true });
            version = result.stdout.trim();
        }
        if (!version) {
            return null;
        }
        try {
            return semver.coerce(version);
        } catch (e) {
            traceError(`Unable to parse version ${version} for product ${product}: `, e);
            return null;
        }
    }

    @traceDecorators.verbose('Checking if product is installed')
    public async isInstalled(product: Product, @logValue('path') interpreter: PythonEnvironment): Promise<boolean> {
        const executableName = this.getExecutableNameFromSettings(product, undefined);
        const isModule = this.isExecutableAModule(product, undefined);
        if (isModule) {
            const pythonProcess = await this.serviceContainer
                .get<IPythonExecutionFactory>(IPythonExecutionFactory)
                .createActivatedEnvironment({
                    resource: undefined,
                    interpreter,
                    allowEnvironmentFetchExceptions: true
                });
            return pythonProcess.isModuleInstalled(executableName);
        } else {
            const process = await this.serviceContainer
                .get<IProcessServiceFactory>(IProcessServiceFactory)
                .create(undefined);
            return process
                .exec(executableName, ['--version'], { mergeStdOutErr: true })
                .then(() => true)
                .catch(() => false);
        }
    }

    protected getExecutableNameFromSettings(product: Product, resource?: Uri): string {
        const productType = this.productService.getProductType(product);
        const productPathService = this.serviceContainer.get<IProductPathService>(IProductPathService, productType);
        return productPathService.getExecutableNameFromSettings(product, resource);
    }

    protected isExecutableAModule(product: Product, resource?: Uri): boolean {
        const productType = this.productService.getProductType(product);
        const productPathService = this.serviceContainer.get<IProductPathService>(IProductPathService, productType);
        return productPathService.isExecutableAModule(product, resource);
    }
}

export class DataScienceInstaller extends BaseInstaller {}

@injectable()
export class ProductInstaller implements IInstaller {
    private readonly productService: IProductService;
    private readonly _onInstalled = new EventEmitter<{ product: Product; resource?: InterpreterUri }>();
    public get onInstalled(): Event<{ product: Product; resource?: InterpreterUri }> {
        return this._onInstalled.event;
    }

    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(InterpreterPackages) private readonly interpreterPackages: InterpreterPackages,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly output: IOutputChannel
    ) {
        this.productService = serviceContainer.get<IProductService>(IProductService);
    }

    public dispose(): void {
        /** Do nothing. */
    }

    public async install(
        product: Product,
        interpreter: PythonEnvironment,
        cancelTokenSource: CancellationTokenSource,
        reInstallAndUpdate?: boolean,
        installPipIfRequired?: boolean
    ): Promise<InstallerResponse> {
        if (interpreter) {
            this.interpreterPackages.trackPackages(interpreter);
        }
        let action: 'installed' | 'failed' | 'disabled' | 'ignored' | 'cancelled' = 'installed';
        try {
            const result = await this.createInstaller(product).install(
                product,
                interpreter,
                cancelTokenSource,
                reInstallAndUpdate,
                installPipIfRequired
            );
            trackPackageInstalledIntoInterpreter(this.memento, product, interpreter).catch(noop);
            if (result === InstallerResponse.Installed) {
                this._onInstalled.fire({ product, resource: interpreter });
            }
            switch (result) {
                case InstallerResponse.Cancelled:
                    action = 'cancelled';
                    break;
                case InstallerResponse.Installed:
                    action = 'installed';
                    break;
                case InstallerResponse.Ignore:
                    action = 'ignored';
                    break;
                case InstallerResponse.Disabled:
                    action = 'disabled';
                    break;
                default:
                    break;
            }
            return result;
        } catch (ex) {
            action = 'failed';
            throw ex;
        } finally {
            sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                action,
                moduleName: ProductNames.get(product)!
            });
        }
    }

    public async isInstalled(product: Product, interpreter: PythonEnvironment): Promise<boolean> {
        return this.createInstaller(product).isInstalled(product, interpreter);
    }

    // eslint-disable-next-line class-methods-use-this
    public translateProductToModuleName(product: Product): string {
        return translateProductToModule(product);
    }

    private createInstaller(product: Product): BaseInstaller {
        const productType = this.productService.getProductType(product);
        switch (productType) {
            case ProductType.DataScience:
                return new DataScienceInstaller(this.serviceContainer, this.output);
            default:
                break;
        }
        throw new Error(`Unknown product ${product}`);
    }
}
