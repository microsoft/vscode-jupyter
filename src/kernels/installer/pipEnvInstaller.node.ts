// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { IWorkspaceService } from '../../platform/common/application/types';
import { InterpreterUri } from '../../platform/common/types';
import { isResource } from '../../platform/common/utils/misc';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller.node';
import { ModuleInstallerType, ModuleInstallFlags } from './types';
import { isPipenvEnvironmentRelatedToFolder } from './pipenv.node';
import { getInterpreterWorkspaceFolder } from '../helpers';
import { IServiceContainer } from '../../platform/ioc/types';
import { getFilePath } from '../../platform/common/platform/fs-paths';

export const pipenvName = 'pipenv';

/**
 * Installer for pipenv (not the same as pip)
 */
@injectable()
export class PipEnvInstaller extends ModuleInstaller {
    constructor(
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService
    ) {
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

    public async isSupported(resource?: InterpreterUri): Promise<boolean> {
        if (isResource(resource)) {
            const interpreter = await this.serviceContainer
                .get<IInterpreterService>(IInterpreterService)
                .getActiveInterpreter(resource);
            const workspaceFolder = resource
                ? this.serviceContainer.get<IWorkspaceService>(IWorkspaceService).getWorkspaceFolder(resource)
                : undefined;
            if (!interpreter || !workspaceFolder || interpreter.envType !== EnvironmentType.Pipenv) {
                return false;
            }
            // Install using `pipenv install` only if the active environment is related to the current folder.
            return isPipenvEnvironmentRelatedToFolder(interpreter.uri, workspaceFolder.uri);
        } else {
            return resource.envType === EnvironmentType.Pipenv;
        }
    }
    protected async getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment,
        flags: ModuleInstallFlags = 0
    ): Promise<ExecutionInstallArgs> {
        // In pipenv the only way to update/upgrade or re-install is update (apart from a complete uninstall and re-install).
        const update =
            flags & ModuleInstallFlags.reInstall ||
            flags & ModuleInstallFlags.updateDependencies ||
            flags & ModuleInstallFlags.upgrade;
        const args = [update ? 'update' : 'install', moduleName, '--dev'];
        const workspaceFolder = getInterpreterWorkspaceFolder(interpreter, this.workspaceService);
        return {
            args,
            exe: pipenvName,
            cwd: workspaceFolder ? getFilePath(workspaceFolder) : undefined
        };
    }
}
