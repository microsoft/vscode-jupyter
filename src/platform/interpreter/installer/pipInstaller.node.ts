// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller.node';
import * as path from '../../vscode-path/path';
import { IWorkspaceService } from '../../common/application/types';
import { _SCRIPTS_DIR } from '../internal/scripts/index.node';
import { ModuleInstallerType, ModuleInstallFlags, Product, IInstaller } from './types';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { IServiceContainer } from '../../ioc/types';
import { translateProductToModule } from './utils';
import { IPythonExecutionFactory } from '../types.node';
import { getPinnedPackages } from './pinnedPackages';
import { Environment } from '../../api/pythonApiTypes';
import { getEnvironmentType } from '../helpers';

/**
 * Installer for pip. Default installer for most everything.
 */
@injectable()
export class PipInstaller extends ModuleInstaller {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }

    public get name(): string {
        return 'Pip';
    }

    public get type(): ModuleInstallerType {
        return ModuleInstallerType.Pip;
    }

    public get displayName() {
        return 'Pip';
    }
    public get priority(): number {
        return 0;
    }
    public async isSupported(interpreter: PythonEnvironment | Environment): Promise<boolean> {
        const envType = 'executable' in interpreter ? getEnvironmentType(interpreter) : interpreter.envType;
        // Skip this on conda, poetry, and pipenv environments
        switch (envType) {
            case EnvironmentType.Conda:
            case EnvironmentType.Pipenv:
            case EnvironmentType.Poetry:
                return false;
        }

        // Otherwise pip has to be there.
        return this.isPipAvailable(interpreter);
    }
    protected async getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment | Environment,
        flags: ModuleInstallFlags = 0
    ): Promise<ExecutionInstallArgs> {
        if (moduleName === translateProductToModule(Product.pip)) {
            // If `ensurepip` is available, if not, then install pip using the script file.
            const installer = this.serviceContainer.get<IInstaller>(IInstaller);
            if (await installer.isInstalled(Product.ensurepip, interpreter)) {
                return {
                    args: ['-m', 'ensurepip']
                };
            }

            // Return script to install pip.
            return {
                args: [path.join(_SCRIPTS_DIR, 'get-pip.py')]
            };
        }

        const args: string[] = [];
        const workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        const proxy = workspaceService.getConfiguration('http').get('proxy', '');
        if (proxy.length > 0) {
            args.push('--proxy');
            args.push(proxy);
        }
        args.push(...['install', '-U']);
        if (flags & ModuleInstallFlags.reInstall) {
            args.push('--force-reinstall');
        }
        if (
            ('executable' in interpreter ? getEnvironmentType(interpreter) : interpreter.envType) ===
            EnvironmentType.Unknown
        ) {
            args.push('--user');
        }
        return {
            args: ['-m', 'pip', ...args, moduleName].concat(getPinnedPackages('pip', moduleName))
        };
    }
    private isPipAvailable(interpreter: PythonEnvironment | Environment): Promise<boolean> {
        const pythonExecutionFactory = this.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
        return pythonExecutionFactory
            .create({ resource: undefined, interpreter })
            .then((proc) => proc.isModuleInstalled('pip'))
            .catch(() => false);
    }
}
