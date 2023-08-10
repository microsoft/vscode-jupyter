// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { CondaService } from '../condaService.node';
import { IServiceContainer } from '../../ioc/types';
import { ExecutionInstallArgs, ModuleInstaller } from './moduleInstaller.node';
import { ModuleInstallerType, ModuleInstallFlags, Product } from './types';
import * as path from '../../vscode-path/path';
import { translateProductToModule } from './utils';
import { fileToCommandArgument, toCommandArgument } from '../../common/helpers';
import { getPinnedPackages } from './pinnedPackages';
import { CancellationTokenSource, Uri } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { IInterpreterService } from '../contracts';
import { Environment } from '../../api/pythonApiTypes';
import { getEnvironmentType, isCondaEnvironmentWithoutPython } from '../helpers';

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
    public async isSupported(interpreter: PythonEnvironment | Environment): Promise<boolean> {
        if (this._isCondaAvailable === false) {
            return false;
        }
        const condaLocator = this.serviceContainer.get<CondaService>(CondaService);
        this._isCondaAvailable = await condaLocator.isCondaAvailable();
        if (!this._isCondaAvailable) {
            return false;
        }
        // Now we need to check if the current environment is a conda environment or not.
        return (
            ('executable' in interpreter ? getEnvironmentType(interpreter) : interpreter.envType) ===
            EnvironmentType.Conda
        );
    }

    public override async installModule(
        productOrModuleName: Product | string,
        interpreter: PythonEnvironment | Environment,
        cancelTokenSource: CancellationTokenSource,
        flags?: ModuleInstallFlags
    ): Promise<void> {
        await super.installModule(productOrModuleName, interpreter, cancelTokenSource, flags);

        // If we just installed a package into a conda env without python init, then Python may have gotten installed
        // We now need to ensure the conda env gets updated as a result of this.
        if (
            ('executable' in interpreter
                ? getEnvironmentType(interpreter)
                : interpreter.envType === EnvironmentType.Conda) &&
            ('executable' in interpreter
                ? isCondaEnvironmentWithoutPython(interpreter)
                : interpreter.isCondaEnvWithoutPython)
        ) {
            const pythonExt = this.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
            if (!pythonExt.isPythonExtensionActive) {
                return;
            }
            const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
            const updatedCondaEnv = await interpreterService.getInterpreterDetails(interpreter.id);
            if (updatedCondaEnv && !updatedCondaEnv.isCondaEnvWithoutPython) {
                Object.assign(interpreter, updatedCondaEnv);
            }
        }
    }

    /**
     * Return the commandline args needed to install the module.
     */
    protected async getExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment | Environment,
        flags: ModuleInstallFlags = ModuleInstallFlags.None
    ): Promise<ExecutionInstallArgs> {
        const condaService = this.serviceContainer.get<CondaService>(CondaService);
        const condaFile = await condaService.getCondaFile();
        const name = 'executable' in interpreter ? interpreter.environment?.name : interpreter.envName;
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
        args.push(...getPinnedPackages('conda', moduleName));
        args.push('-y');
        return {
            exe: condaFile,
            args
        };
    }

    private getEnvironmentPath(interpreter: PythonEnvironment | Environment) {
        let exeuctablePath: Uri;
        if ('executable' in interpreter) {
            if (interpreter.environment?.folderUri) {
                return interpreter.environment.folderUri.fsPath;
            }
            exeuctablePath = interpreter.executable.uri || Uri.file(interpreter.path);
        } else {
            exeuctablePath = interpreter.uri;
        }
        const dir = path.dirname(exeuctablePath.fsPath);

        // If interpreter is in bin or Scripts, then go up one level
        const subDirName = path.basename(dir);
        const goUpOnLevel = ['BIN', 'SCRIPTS'].indexOf(subDirName.toUpperCase()) !== -1;
        return goUpOnLevel ? path.join(dir, '..') : dir;
    }
}
