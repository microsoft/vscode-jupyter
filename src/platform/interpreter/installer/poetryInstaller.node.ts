// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { IConfigurationService } from '../../common/types';
import { getInterpreterWorkspaceFolder } from './helpers';
import { IServiceContainer } from '../../ioc/types';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller.node';
import { isPoetryEnvironmentRelatedToFolder } from './poetry.node';
import { ModuleInstallerType } from './types';
import { Environment } from '@vscode/python-extension';
import { Uri } from 'vscode';
import { getEnvironmentType } from '../helpers';

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
        @inject(IConfigurationService) private readonly configurationService: IConfigurationService
    ) {
        super(serviceContainer);
    }

    public async isSupported(interpreter: PythonEnvironment | Environment): Promise<boolean> {
        if (
            ('executable' in interpreter ? getEnvironmentType(interpreter) : interpreter.envType) !==
            EnvironmentType.Poetry
        ) {
            return false;
        }

        const folder = getInterpreterWorkspaceFolder(interpreter);
        if (folder) {
            const executable =
                'executable' in interpreter
                    ? interpreter.executable.uri || Uri.file(interpreter.path)
                    : interpreter.uri;
            // Install using poetry CLI only if the active poetry environment is related to the current folder.
            return isPoetryEnvironmentRelatedToFolder(
                executable.fsPath,
                folder.fsPath,
                this.configurationService.getSettings(undefined).poetryPath
            );
        }

        return false;
    }

    protected async getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment | Environment
    ): Promise<ExecutionInstallArgs> {
        const execPath = this.configurationService.getSettings(undefined).poetryPath;
        const args = [execPath, 'add', '--dev', moduleName];
        const cwd = getInterpreterWorkspaceFolder(interpreter)?.fsPath;

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
