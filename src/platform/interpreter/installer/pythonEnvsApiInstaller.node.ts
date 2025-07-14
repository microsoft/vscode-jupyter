// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationTokenSource, Progress, ProgressLocation, ProgressOptions, window, Uri } from 'vscode';
import { ModuleInstaller } from './moduleInstaller.node';
import { ModuleInstallerType, ModuleInstallFlags, Product } from './types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { IServiceContainer } from '../../ioc/types';
import { translateProductToModule } from './utils';
import { Environment } from '@vscode/python-extension';
import { getEnvExtApi } from '../../api/python-envs/pythonEnvsApi';
import {
    PythonEnvironmentApi,
    PythonEnvironment as ApiPythonEnvironment,
    PackageManagementOptions
} from '../../api/python-envs/api';
import { logger } from '../../logging';
import { Products } from '../../common/utils/localize';
import { createDeferred } from '../../common/utils/async';

/**
 * Installer that uses the Python Environment Extension API to manage packages.
 * This installer automatically uses the correct package manager (uv, pip, conda, etc.)
 * for each environment type by delegating to the Python Environment Extension API.
 */
@injectable()
export class PythonEnvsApiInstaller extends ModuleInstaller {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }

    public get name(): string {
        return 'PythonEnvsApi';
    }

    public get type(): ModuleInstallerType {
        return ModuleInstallerType.UV;
    }

    public get displayName() {
        return 'Python Environment API';
    }

    public get priority(): number {
        return 100;
    }

    public async isSupported(interpreter: PythonEnvironment | Environment): Promise<boolean> {
        try {
            // Check if Python Environment Extension API is available
            const api = await getEnvExtApi();
            if (!api) {
                return false;
            }

            // Try to resolve the environment to ensure the API can handle it
            const resolvedEnv = await this.resolveEnvironment(interpreter, api);
            return resolvedEnv !== undefined;
        } catch (error) {
            logger.error(`PythonEnvsApiInstaller.isSupported failed`, error);
            return false;
        }
    }

    public override async installModule(
        productOrModuleName: Product | string,
        interpreter: PythonEnvironment | Environment,
        _cancelTokenSource: CancellationTokenSource,
        flags?: ModuleInstallFlags,
        _silent?: boolean
    ): Promise<void> {
        const moduleName =
            typeof productOrModuleName === 'string'
                ? productOrModuleName
                : translateProductToModule(productOrModuleName);

        try {
            const api = await getEnvExtApi();
            if (!api) {
                throw new Error('Python Environment Extension API not available');
            }

            const resolvedEnv = await this.resolveEnvironment(interpreter, api);
            if (!resolvedEnv) {
                throw new Error('Unable to resolve Python environment with API');
            }

            const installOptions: PackageManagementOptions = {
                install: [moduleName],
                upgrade: Boolean(flags && flags & ModuleInstallFlags.upgrade),
                showSkipOption: false
            };

            // Use the Python Environment API to manage packages
            await api.managePackages(resolvedEnv, installOptions);
        } catch (error) {
            logger.error(`PythonEnvsApiInstaller failed to install ${moduleName}:`, error);
            throw error;
        }
    }

    protected async getExecutionArgs(): Promise<never> {
        // This method is not used since we override installModule
        throw new Error('getExecutionArgs should not be called for PythonEnvsApiInstaller');
    }

    /**
     * Resolves the interpreter to a Python Environment API environment.
     */
    private async resolveEnvironment(
        interpreter: PythonEnvironment | Environment,
        api: PythonEnvironmentApi
    ): Promise<ApiPythonEnvironment | undefined> {
        try {
            // Check if it's a Python extension Environment (has 'path' property)
            if ('path' in interpreter) {
                // Use the id property for resolution
                return (
                    (await api.resolveEnvironment(Uri.file(interpreter.id))) ||
                    (await api.resolveEnvironment(Uri.file(interpreter.path)))
                );
            }

            // If it's a Jupyter PythonEnvironment (has 'uri' property), resolve using the URI
            if ('uri' in interpreter) {
                return await api.resolveEnvironment(interpreter.uri);
            }

            return undefined;
        } catch (error) {
            logger.debug(`Failed to resolve environment: ${error}`);
            return undefined;
        }
    }
}
