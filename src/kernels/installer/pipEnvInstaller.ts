// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { IWorkspaceService } from '../../client/common/application/types';
import { isPipenvEnvironmentRelatedToFolder } from '../../client/common/process/pipenv';
import { InterpreterUri } from '../../client/common/types';
import { isResource } from '../../client/common/utils/misc';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller';
import { ModuleInstallerType, ModuleInstallFlags } from './types';

export const pipenvName = 'pipenv';

@injectable()
export class PipEnvInstaller extends ModuleInstaller {
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
            return isPipenvEnvironmentRelatedToFolder(interpreter.path, workspaceFolder.uri.fsPath);
        } else {
            return resource.envType === EnvironmentType.Pipenv;
        }
    }
    protected async getExecutionArgs(
        moduleName: string,
        _interpreter: PythonEnvironment,
        flags: ModuleInstallFlags = 0
    ): Promise<ExecutionInstallArgs> {
        // In pipenv the only way to update/upgrade or re-install is update (apart from a complete uninstall and re-install).
        const update =
            flags & ModuleInstallFlags.reInstall ||
            flags & ModuleInstallFlags.updateDependencies ||
            flags & ModuleInstallFlags.upgrade;
        const args = [update ? 'update' : 'install', moduleName, '--dev'];
        if (moduleName === 'black') {
            args.push('--pre');
        }
        return {
            exe: pipenvName,
            args
        };
    }
}
