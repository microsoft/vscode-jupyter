// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { IWorkspaceService } from '../../platform/common/application/types';
import { IConfigurationService } from '../../platform/common/types';
import { getInterpreterWorkspaceFolder } from '../helpers';
import { IServiceContainer } from '../../platform/ioc/types';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller.node';
import { isPoetryEnvironmentRelatedToFolder } from './poetry.node';
import { ModuleInstallerType } from './types';

export const poetryName = 'poetry';

/**
 * Installer for poetry environments.
 */
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
                interpreter.uri.fsPath,
                folder.fsPath,
                this.configurationService.getSettings(undefined).poetryPath
            );
        }

        return false;
    }

    protected async getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment
    ): Promise<ExecutionInstallArgs> {
        const execPath = this.configurationService.getSettings(undefined).poetryPath;
        const args = [execPath, 'add', '--dev', moduleName];
        const cwd = getInterpreterWorkspaceFolder(interpreter, this.workspaceService)?.fsPath;

        // TODO: We have to shell exec this because child_process.spawn will die
        // for poetry.
        // See issue:
        // https://github.com/microsoft/vscode-jupyter/issues/9265
        return {
            useShellExec: true,
            args,
            cwd
        };
    }
}
