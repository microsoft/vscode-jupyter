// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { CancellationTokenSource, Event, EventEmitter, Memento, Uri } from 'vscode';
import { ProductNames } from './productNames';
import {
    IInstallationChannelManager,
    IInstaller,
    InstallerResponse,
    IProductPathService,
    IProductService,
    ModuleInstallFlags,
    Product,
    ProductType
} from './types';
import { logValue, traceDecoratorVerbose } from '../../logging';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { IApplicationShell, IWorkspaceService } from '../../common/application/types';
import { traceError } from '../../logging';
import { IProcessServiceFactory } from '../../common/process/types.node';
import {
    IConfigurationService,
    IPersistentStateFactory,
    GLOBAL_MEMENTO,
    IMemento,
    IOutputChannel,
    InterpreterUri
} from '../../common/types';
import { noop } from '../../common/utils/misc';
import { IServiceContainer } from '../../ioc/types';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { InterpreterPackages } from '../interpreterPackages.node';
import { getInterpreterHash } from '../../pythonEnvironments/info/interpreter';
import { STANDARD_OUTPUT_CHANNEL } from '../../common/constants';
import { raceTimeout } from '../../common/utils/async';
import { trackPackageInstalledIntoInterpreter } from './productInstaller';
import { translateProductToModule } from './utils';
import { IInterpreterPackages } from '../types';
import { IPythonExecutionFactory } from '../types.node';

export async function isModulePresentInEnvironment(memento: Memento, product: Product, interpreter: PythonEnvironment) {
    const key = `${await getInterpreterHash(interpreter)}#${ProductNames.get(product)}`;
    if (memento.get(key, false)) {
        return true;
    }
    const packageName = translateProductToModule(product);
    const packageVersionPromise = InterpreterPackages.instance
        ? InterpreterPackages.instance
              .getPackageVersion(interpreter, packageName)
              .then((version) => (typeof version === 'string' ? 'found' : 'notfound'))
              .catch((ex) => {
                  traceError('Failed to get interpreter package version', ex);
                  return undefined;
              })
        : Promise.resolve(undefined);
    try {
        // Dont wait for too long we don't want to delay installation prompt.
        const version = await raceTimeout(500, packageVersionPromise);
        if (typeof version === 'string') {
            return version === 'found';
        }
    } catch (ex) {
        traceError(`Failed to check if package exists ${ProductNames.get(product)}`);
    }
}

/**
 * Installer for this extension. Finds the installer for a module and then runs it.
 */
export class DataScienceInstaller {
    protected readonly appShell: IApplicationShell;

    protected readonly configService: IConfigurationService;

    protected readonly workspaceService: IWorkspaceService;

    private readonly productService: IProductService;

    protected readonly persistentStateFactory: IPersistentStateFactory;

    constructor(
        protected serviceContainer: IServiceContainer,
        _outputChannel: IOutputChannel
    ) {
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
        if (interpreter.isCondaEnvWithoutPython) {
            interpreter.isCondaEnvWithoutPython = false;
        }
        return this.isInstalled(product, interpreter).then((isInstalled) => {
            return isInstalled ? InstallerResponse.Installed : InstallerResponse.Ignore;
        });
    }

    @traceDecoratorVerbose('Checking if product is installed')
    public async isInstalled(product: Product, @logValue('path') interpreter: PythonEnvironment): Promise<boolean> {
        const executableName = this.getExecutableNameFromSettings(product, undefined);
        const isModule = this.isExecutableAModule(product, undefined);
        if (isModule) {
            const pythonProcess = await this.serviceContainer
                .get<IPythonExecutionFactory>(IPythonExecutionFactory)
                .createActivatedEnvironment({
                    resource: undefined,
                    interpreter
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

/**
 * Main interface to installing.
 */
@injectable()
export class ProductInstaller implements IInstaller {
    private readonly productService: IProductService;
    private readonly _onInstalled = new EventEmitter<{ product: Product; resource?: InterpreterUri }>();
    public get onInstalled(): Event<{ product: Product; resource?: InterpreterUri }> {
        return this._onInstalled.event;
    }

    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IInterpreterPackages) private readonly interpreterPackages: IInterpreterPackages,
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

    private createInstaller(product: Product): DataScienceInstaller {
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
