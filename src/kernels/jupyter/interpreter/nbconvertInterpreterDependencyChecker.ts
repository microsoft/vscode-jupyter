// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { SemVer } from 'semver';
import { CancellationToken } from 'vscode';
import { parseSemVer } from '../../../platform/datascience/common';
import { INbConvertInterpreterDependencyChecker, IJupyterCommandFactory } from '../../../platform/datascience/types';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { JupyterCommands } from '../../../datascience-ui/common/constants';
import { IInstaller, Product } from '../../installer/types';

@injectable()
export class NbConvertInterpreterDependencyChecker implements INbConvertInterpreterDependencyChecker {
    // Track interpreters that nbconvert has been installed into
    private readonly nbconvertInstalledInInterpreter = new Set<string>();
    constructor(
        @inject(IInstaller) private readonly installer: IInstaller,
        @inject(IJupyterCommandFactory) private readonly commandFactory: IJupyterCommandFactory
    ) {}

    // Check to see if nbconvert is installed in the given interpreter, note that we also need jupyter since that supplies the needed
    // template files for conversion
    public async isNbConvertInstalled(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<boolean> {
        if (this.nbconvertInstalledInInterpreter.has(interpreter.path)) {
            return true;
        }
        const isInstalled: boolean =
            !!(await this.installer.isInstalled(Product.nbconvert, interpreter)) &&
            !!(await this.installer.isInstalled(Product.jupyter, interpreter));
        if (isInstalled === true) {
            this.nbconvertInstalledInInterpreter.add(interpreter.path);
        }
        return isInstalled;
    }

    // Get the specific version of nbconvert installed in the given interpreter
    public async getNbConvertVersion(
        interpreter: PythonEnvironment,
        _token?: CancellationToken
    ): Promise<SemVer | undefined> {
        const command = this.commandFactory.createInterpreterCommand(
            JupyterCommands.ConvertCommand,
            'jupyter',
            ['-m', 'jupyter', 'nbconvert'],
            interpreter,
            false
        );

        const result = await command.exec(['--version'], { throwOnStdErr: true });

        return parseSemVer(result.stdout);
    }
}
