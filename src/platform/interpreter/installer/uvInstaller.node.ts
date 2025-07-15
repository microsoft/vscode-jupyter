// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller.node';
import { ModuleInstallerType, ModuleInstallFlags, Product } from './types';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { IServiceContainer } from '../../ioc/types';
import { translateProductToModule } from './utils';
import { Environment } from '@vscode/python-extension';
import { getEnvironmentType, getCachedEnvironment } from '../helpers';
import { getEnvExtApi } from '../../api/python-envs/pythonEnvsApi';
import { logger } from '../../logging';
import { CancellationTokenSource } from 'vscode';
import { IPythonExecutionFactory } from '../types.node';

/**
 * Installer for UV environments (created with `uv venv`).
 * This installer uses the Python Environment Extension API to manage packages via `uv pip install`.
 */
@injectable()
export class UvInstaller extends ModuleInstaller {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }

    public get name(): string {
        return 'UV';
    }

    public get type(): ModuleInstallerType {
        return ModuleInstallerType.Uv;
    }

    public get displayName() {
        return 'UV';
    }

    public get priority(): number {
        // Low priority as requested - used as fallback when no other installers are available
        return 100;
    }

    public async isSupported(interpreter: PythonEnvironment | Environment): Promise<boolean> {
        // Only support if this appears to be a UV-managed environment AND
        // other installers (particularly pip) are not available
        return this.isUvEnvironment(interpreter);
    }

    /**
     * Override the installModule method to use Python Environment Extension API
     */
    public async installModule(
        productOrModuleName: Product | string,
        interpreter: PythonEnvironment | Environment,
        cancelTokenSource: CancellationTokenSource,
        flags?: ModuleInstallFlags,
        silent?: boolean
    ): Promise<void> {
        const moduleName =
            typeof productOrModuleName === 'string'
                ? productOrModuleName
                : translateProductToModule(productOrModuleName);

        try {
            const envApi = await getEnvExtApi();
            if (!envApi) {
                logger.warn('Python Environment Extension API not available, falling back to base installer');
                return super.installModule(productOrModuleName, interpreter, cancelTokenSource, flags, silent);
            }

            // Convert the interpreter to the format expected by the Python Environment Extension API
            const pythonEnv = this.convertToPythonEnvironment(interpreter);
            if (!pythonEnv) {
                logger.warn('Could not convert interpreter to Python Environment format');
                return super.installModule(productOrModuleName, interpreter, cancelTokenSource, flags, silent);
            }

            // Use the package manager to install using UV
            const installOptions = {
                install: [moduleName],
                upgrade: Boolean(flags && flags & ModuleInstallFlags.upgrade)
            };

            await envApi.managePackages(pythonEnv, installOptions);
            logger.info(`Successfully installed ${moduleName} using UV package manager`);
        } catch (error) {
            logger.error(`Failed to install ${moduleName} using UV package manager: ${error}`);
            // Fall back to base installer if UV package management fails
            return super.installModule(productOrModuleName, interpreter, cancelTokenSource, flags, silent);
        }
    }

    protected async getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment | Environment,
        flags: ModuleInstallFlags = 0
    ): Promise<ExecutionInstallArgs> {
        // This method is used by the base installer as a fallback
        // Use UV's pip install command
        const args: string[] = [];
        args.push(...['pip', 'install', '-U']);
        
        if (flags & ModuleInstallFlags.reInstall) {
            args.push('--force-reinstall');
        }
        
        return {
            exe: 'uv',
            args: [...args, moduleName]
        };
    }

    /**
     * Check if the interpreter is in a UV-managed environment
     */
    private async isUvEnvironment(interpreter: PythonEnvironment | Environment): Promise<boolean> {
        try {
            // Check if the environment was created by UV
            const env = getCachedEnvironment(interpreter);
            if (!env) {
                return false;
            }

            // UV environments are typically detected as Venv type
            const envType = getEnvironmentType(interpreter);
            if (envType !== EnvironmentType.Venv && envType !== EnvironmentType.VirtualEnv) {
                return false;
            }

            // Check if UV tool is explicitly in the environment tools
            if (env.tools.includes('UV' as any)) {
                logger.debug('Environment has UV tool explicitly listed');
                return true;
            }

            // Check if the environment path contains UV-specific indicators
            const envPath = env.environment?.folderUri?.fsPath || env.path;
            if (envPath) {
                // UV typically creates environments in .venv directories
                const isLikelyUvEnv = this.checkUvEnvironmentPath(envPath);
                if (isLikelyUvEnv) {
                    logger.debug(`Detected likely UV environment at ${envPath}`);
                    // Additional check: see if pip is available
                    // UV environments often don't have pip installed by default
                    const hasPip = await this.checkPipAvailability(interpreter);
                    if (!hasPip) {
                        logger.debug('Pip not available, confirming UV environment detection');
                        return true;
                    }
                }
            }

            return false;
        } catch (error) {
            logger.debug(`Error checking if environment is UV-managed: ${error}`);
            return false;
        }
    }

    /**
     * Check if pip is available in the environment
     */
    private async checkPipAvailability(interpreter: PythonEnvironment | Environment): Promise<boolean> {
        try {
            const pythonExecutionFactory = this.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
            const proc = await pythonExecutionFactory.create({ resource: undefined, interpreter });
            return proc.isModuleInstalled('pip');
        } catch (error) {
            logger.debug(`Error checking pip availability: ${error}`);
            return false;
        }
    }

    /**
     * Check if the environment path indicates it's a UV environment
     */
    private checkUvEnvironmentPath(envPath: string): boolean {
        try {
            // UV environments often have specific characteristics:
            // 1. They're typically in .venv directories
            // 2. Based on the logs, pip is not available which is typical for UV environments
            
            // For now, we'll use a simple heuristic: if it's a .venv directory
            // This is a reasonable heuristic since UV typically creates .venv environments
            // and from the error logs we can see this is the pattern
            if (envPath.includes('.venv')) {
                logger.debug(`Environment path ${envPath} contains .venv, might be UV environment`);
                return true;
            }

            // Also check for any path that might indicate UV usage
            // UV can create environments in various locations but .venv is most common
            return false;
        } catch (error) {
            logger.debug(`Error checking UV environment path: ${error}`);
            return false;
        }
    }

    /**
     * Convert interpreter to Python Environment format for the API
     */
    private convertToPythonEnvironment(interpreter: PythonEnvironment | Environment): any {
        if ('envId' in interpreter) {
            // It's already a PythonEnvironment from the API
            return interpreter;
        }

        // Try to get the cached environment and convert it
        const env = getCachedEnvironment(interpreter);
        if (env) {
            return env;
        }

        return null;
    }
}