// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { CondaService } from '../../platform/common/process/condaService.node';
import { IServiceContainer } from '../../platform/ioc/types';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller.node';
import { ModuleInstallerType, ModuleInstallFlags, Product } from './types';
import * as path from '../../platform/vscode-path/path';
import { translateProductToModule } from './utils';
import { fileToCommandArgument, toCommandArgument } from '../../platform/common/helpers';

/**
 * A Python module installer for a conda environment.
 */
@injectable()
export class CondaInstaller extends ModuleInstaller {
    public _isCondaAvailable: boolean | undefined;

    // Unfortunately inversify requires the number of args in constructor to be explictly
    // specified as more than its base class. So we need the constructor.
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }

    public get name(): string {
        return 'Conda';
    }

    public get displayName(): string {
        return 'Conda';
    }

    public get type(): ModuleInstallerType {
        return ModuleInstallerType.Conda;
    }

    public get priority(): number {
        return 0;
    }

    /**
     * Checks whether we can use Conda as module installer for a given resource.
     * We need to perform two checks:
     * 1. Ensure we have conda.
     * 2. Check if the current environment is a conda environment.
     * @param {InterpreterUri} [resource=] Resource used to identify the workspace.
     * @returns {Promise<boolean>} Whether conda is supported as a module installer or not.
     */
    public async isSupported(interpreter: PythonEnvironment): Promise<boolean> {
        if (this._isCondaAvailable === false) {
            return false;
        }
        const condaLocator = this.serviceContainer.get<CondaService>(CondaService);
        this._isCondaAvailable = await condaLocator.isCondaAvailable();
        if (!this._isCondaAvailable) {
            return false;
        }
        // Now we need to check if the current environment is a conda environment or not.
        return interpreter.envType === EnvironmentType.Conda;
    }

    /**
     * Return the commandline args needed to install the module.
     */
    protected async getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment,
        flags: ModuleInstallFlags = 0
    ): Promise<ExecutionInstallArgs> {
        const condaService = this.serviceContainer.get<CondaService>(CondaService);
        const condaFile = await condaService.getCondaFile();
        const name = interpreter.envName;
        const envPath = this.getEnvironmentPath(interpreter);
        const args = [flags & ModuleInstallFlags.upgrade ? 'update' : 'install'];

        // Found that using conda-forge is best at packages like tensorboard & ipykernel which seem to get updated first on conda-forge
        // https://github.com/microsoft/vscode-jupyter/issues/7787 & https://github.com/microsoft/vscode-python/issues/17628
        // Do this just for the datascience packages.
        if (
            [Product.ipykernel, Product.pandas, Product.nbconvert, Product.jupyter, Product.notebook]
                .map(translateProductToModule)
                .includes(moduleName)
        ) {
            args.push('-c', 'conda-forge');
        }
        if (name) {
            // If we have the name of the conda environment, then use that.
            args.push('--name');
            args.push(toCommandArgument(name));
        } else if (envPath) {
            // Else provide the full path to the environment path.
            args.push('--prefix');
            args.push(fileToCommandArgument(envPath));
        }
        if (flags & ModuleInstallFlags.updateDependencies) {
            args.push('--update-deps');
        }
        if (flags & ModuleInstallFlags.reInstall) {
            args.push('--force-reinstall');
        }
        args.push(moduleName);
        args.push('-y');
        return {
            exe: condaFile,
            args
        };
    }

    private getEnvironmentPath(interpreter: PythonEnvironment) {
        const dir = path.dirname(interpreter.uri.fsPath);

        // If interpreter is in bin or Scripts, then go up one level
        const subDirName = path.basename(dir);
        const goUpOnLevel = ['BIN', 'SCRIPTS'].indexOf(subDirName.toUpperCase()) !== -1;
        return goUpOnLevel ? path.join(dir, '..') : dir;
    }
}
