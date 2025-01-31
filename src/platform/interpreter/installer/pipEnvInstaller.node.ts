// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { InterpreterUri } from '../../common/types';
import { isResource } from '../../common/utils/misc';
import { IInterpreterService } from '../contracts';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller.node';
import { ModuleInstallerType, ModuleInstallFlags } from './types';
import { isPipenvEnvironmentRelatedToFolder } from './pipenv.node';
import { IServiceContainer } from '../../ioc/types';
import { getFilePath } from '../../common/platform/fs-paths';
import { getInterpreterWorkspaceFolder } from './helpers';
import { Environment } from '@vscode/python-extension';
import { getEnvironmentType } from '../helpers';
import { workspace } from 'vscode';

export const pipenvName = 'pipenv';

/**
 * Installer for pipenv (not the same as pip)
 */
@injectable()
export class PipEnvInstaller extends ModuleInstaller {
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }
    public get name(): string {
        return 'pipenv';
    }

    public get type(): ModuleInstallerType {
        return ModuleInstallerType.Pipenv;
    }

    public get displayName() {
        return pipenvName;
    }
    public get priority(): number {
        return 10;
    }

    public async isSupported(resource?: InterpreterUri | Environment): Promise<boolean> {
        if (isResource(resource)) {
            const interpreter = await this.serviceContainer
                .get<IInterpreterService>(IInterpreterService)
                .getActiveInterpreter(resource);
            const workspaceFolder = resource ? workspace.getWorkspaceFolder(resource) : undefined;
            if (!interpreter || !workspaceFolder || getEnvironmentType(interpreter) !== EnvironmentType.Pipenv) {
                return false;
            }
            // Install using `pipenv install` only if the active environment is related to the current folder.
            return isPipenvEnvironmentRelatedToFolder(interpreter.uri, workspaceFolder.uri);
        } else {
            return getEnvironmentType(resource) === EnvironmentType.Pipenv;
        }
    }
    protected async getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment | Environment,
        flags: ModuleInstallFlags = 0
    ): Promise<ExecutionInstallArgs> {
        // In pipenv the only way to update/upgrade or re-install is update (apart from a complete uninstall and re-install).
        const update =
            flags & ModuleInstallFlags.reInstall ||
            flags & ModuleInstallFlags.updateDependencies ||
            flags & ModuleInstallFlags.upgrade;
        const args = [update ? 'update' : 'install', moduleName, '--dev'];
        const workspaceFolder = getInterpreterWorkspaceFolder(interpreter);
        return {
            args,
            exe: pipenvName,
            cwd: workspaceFolder ? getFilePath(workspaceFolder) : undefined
        };
    }
}
