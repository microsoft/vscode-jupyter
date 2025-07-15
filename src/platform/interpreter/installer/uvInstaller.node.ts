// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller.node';
import { ModuleInstallerType, ModuleInstallFlags } from './types';
import { IServiceContainer } from '../../ioc/types';
import { Environment } from '@vscode/python-extension';
import { getEnvironmentType } from '../helpers';
import { workspace } from 'vscode';

/**
 * Installer for UV environments.
 */
@injectable()
export class UvInstaller extends ModuleInstaller {
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }

    public get name(): string {
        return 'UV';
    }

    public get type(): ModuleInstallerType {
        return ModuleInstallerType.UV;
    }

    public get displayName() {
        return 'UV';
    }

    public get priority(): number {
        return 10;
    }

    public async isSupported(interpreter: PythonEnvironment | Environment): Promise<boolean> {
        // Check if this is a UV environment
        const envType = getEnvironmentType(interpreter);
        if (envType === EnvironmentType.UV) {
            return true;
        }

        // For now, we'll be conservative and only support explicitly detected UV environments
        // In the future, we could add more sophisticated detection like:
        // - Checking for pyproject.toml with [tool.uv] configuration
        // - Checking if 'uv' command is available in PATH
        // - Checking if the interpreter path suggests UV management
        return false;
    }

    protected async getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment | Environment,
        flags: ModuleInstallFlags = 0
    ): Promise<ExecutionInstallArgs> {
        const args: string[] = [];
        const proxy = workspace.getConfiguration('http').get('proxy', '');
        if (proxy.length > 0) {
            args.push('--proxy');
            args.push(proxy);
        }

        // Use UV pip install syntax
        args.push('pip', 'install');

        if (flags & ModuleInstallFlags.upgrade) {
            args.push('--upgrade');
        }
        if (flags & ModuleInstallFlags.reInstall) {
            args.push('--force-reinstall');
        }
        if (flags & ModuleInstallFlags.updateDependencies) {
            args.push('--upgrade-strategy', 'eager');
        }

        args.push(moduleName);

        return {
            exe: 'uv',
            args
        };
    }
}
