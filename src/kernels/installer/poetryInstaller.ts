// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { IWorkspaceService } from '../../client/common/application/types';
import { IConfigurationService } from '../../client/common/types';
import { getInterpreterWorkspaceFolder } from '../../client/datascience/jupyter/kernels/helpers';
import { IServiceContainer } from '../../client/ioc/types';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller';
import { isPoetryEnvironmentRelatedToFolder } from './poetry';
import { ModuleInstallerType } from './types';

export const poetryName = 'poetry';

@injectable()
export class PoetryInstaller extends ModuleInstaller {
    // eslint-disable-next-line class-methods-use-this
    public get name(): string {
        return 'poetry';
    }

    // eslint-disable-next-line class-methods-use-this
    public get type(): ModuleInstallerType {
        return ModuleInstallerType.Poetry;
    }

    // eslint-disable-next-line class-methods-use-this
    public get displayName(): string {
        return poetryName;
    }

    // eslint-disable-next-line class-methods-use-this
    public get priority(): number {
        return 10;
    }

    constructor(
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IConfigurationService) private readonly configurationService: IConfigurationService
    ) {
        super(serviceContainer);
    }

    public async isSupported(interpreter: PythonEnvironment): Promise<boolean> {
        if (interpreter.envType !== EnvironmentType.Poetry) {
            return false;
        }

        const folder = getInterpreterWorkspaceFolder(interpreter, this.workspaceService);
        if (folder) {
            // Install using poetry CLI only if the active poetry environment is related to the current folder.
            return isPoetryEnvironmentRelatedToFolder(
                interpreter.path,
                folder,
                this.configurationService.getSettings(undefined).poetryPath
            );
        }

        return false;
    }

    protected async getExecutionArgs(
        moduleName: string,
        _interpreter: PythonEnvironment
    ): Promise<ExecutionInstallArgs> {
        const execPath = this.configurationService.getSettings(undefined).poetryPath;
        const args = ['add', '--dev', moduleName];
        if (moduleName === 'black') {
            args.push('--allow-prereleases');
        }
        return {
            exe: execPath,
            args
        };
    }
}
