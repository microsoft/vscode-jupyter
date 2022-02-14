// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { ModuleInstaller, translateProductToModule } from './moduleInstaller';
import * as path from 'path';
import { IWorkspaceService } from '../../client/common/application/types';
import { _SCRIPTS_DIR } from '../../client/common/process/internal/scripts';
import { IPythonExecutionFactory } from '../../client/common/process/types';
import { ModuleInstallerType, ModuleInstallFlags, Product, IInstaller } from './types';
import { PythonEnvironment } from '../../client/api/extension';

@injectable()
export class PipInstaller extends ModuleInstaller {
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
    public isSupported(interpreter: PythonEnvironment): Promise<boolean> {
        return this.isPipAvailable(interpreter);
    }
    protected async getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment,
        flags: ModuleInstallFlags = 0
    ): Promise<string[]> {
        if (moduleName === translateProductToModule(Product.pip)) {
            // If `ensurepip` is available, if not, then install pip using the script file.
            const installer = this.serviceContainer.get<IInstaller>(IInstaller);
            if (await installer.isInstalled(Product.ensurepip, interpreter)) {
                return [interpreter.path, '-m', 'ensurepip'];
            }

            // Return script to install pip.
            return [interpreter.path, path.join(_SCRIPTS_DIR, 'get-pip.py')];
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
        return [interpreter.path, '-m', 'pip', ...args];
    }
    private isPipAvailable(interpreter: PythonEnvironment): Promise<boolean> {
        const pythonExecutionFactory = this.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
        return pythonExecutionFactory
            .create({ resource: undefined, interpreter })
            .then((proc) => proc.isModuleInstalled('pip'))
            .catch(() => false);
    }
}
