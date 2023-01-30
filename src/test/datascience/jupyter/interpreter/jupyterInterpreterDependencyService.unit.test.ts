// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { ApplicationShell } from '../../../../platform/common/application/applicationShell';
import { IApplicationShell } from '../../../../platform/common/application/types';
import { DataScience } from '../../../../platform/common/utils/localize';
import { PythonEnvironment } from '../../../../platform/pythonEnvironments/info';
import { ProductInstaller } from '../../../../kernels/installer/productInstaller.node';
import { IInstaller, Product, InstallerResponse } from '../../../../kernels/installer/types';
import {
    JupyterCommandFactory,
    InterpreterJupyterKernelSpecCommand
} from '../../../../kernels/jupyter/interpreter/jupyterCommand.node';
import { JupyterInterpreterDependencyService } from '../../../../kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node';
import { JupyterInterpreterDependencyResponse } from '../../../../kernels/jupyter/types';
import { IJupyterCommand, IJupyterCommandFactory } from '../../../../kernels/jupyter/types.node';
import { Uri } from 'vscode';

/* eslint-disable , @typescript-eslint/no-explicit-any */

suite('Jupyter Interpreter Configuration', () => {
    let configuration: JupyterInterpreterDependencyService;
    let appShell: IApplicationShell;
    let installer: IInstaller;
    let commandFactory: IJupyterCommandFactory;
    let command: IJupyterCommand;
    const pythonInterpreter: PythonEnvironment = {
        uri: Uri.file(''),
        id: Uri.file('').fsPath,
        sysPrefix: '',
        sysVersion: ''
    };
    setup(() => {
        appShell = mock(ApplicationShell);
        installer = mock(ProductInstaller);
        commandFactory = mock(JupyterCommandFactory);
        command = mock(InterpreterJupyterKernelSpecCommand);
        instance(commandFactory as any).then = undefined;
        instance(command as any).then = undefined;
        when(
            commandFactory.createInterpreterCommand(anything(), anything(), anything(), anything(), anything())
        ).thenReturn(instance(command));
        when(command.exec(anything(), anything())).thenResolve({ stdout: '' });

        configuration = new JupyterInterpreterDependencyService(
            instance(appShell),
            instance(installer),
            instance(commandFactory)
        );
    });
    test('Return ok if all dependencies are installed', async () => {
        when(installer.isInstalled(Product.jupyter, pythonInterpreter)).thenResolve(true);
        when(installer.isInstalled(Product.notebook, pythonInterpreter)).thenResolve(true);

        const response = await configuration.installMissingDependencies(pythonInterpreter);

        assert.equal(response, JupyterInterpreterDependencyResponse.ok);
    });
    async function testPromptIfModuleNotInstalled(
        jupyterInstalled: boolean,
        notebookInstalled: boolean
    ): Promise<void> {
        when(installer.isInstalled(Product.jupyter, pythonInterpreter)).thenResolve(jupyterInstalled);
        when(installer.isInstalled(Product.notebook, pythonInterpreter)).thenResolve(notebookInstalled);
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve();

        const response = await configuration.installMissingDependencies(pythonInterpreter);

        verify(
            appShell.showErrorMessage(
                anything(),
                deepEqual({ modal: true }),
                DataScience.jupyterInstall,
                DataScience.selectDifferentJupyterInterpreter
            )
        ).once();
        assert.equal(response, JupyterInterpreterDependencyResponse.cancel);
    }
    test('Prompt to install if Jupyter is not installed', async () => testPromptIfModuleNotInstalled(false, true));
    test('Prompt to install if notebook is not installed', async () => testPromptIfModuleNotInstalled(true, false));
    test('Prompt to install if jupyter & notebook is not installed', async () =>
        testPromptIfModuleNotInstalled(false, false));
    test('Reinstall Jupyter if jupyter and notebook are installed but kernelspec is not found', async () => {
        when(installer.isInstalled(Product.jupyter, pythonInterpreter)).thenResolve(true);
        when(installer.isInstalled(Product.notebook, pythonInterpreter)).thenResolve(true);
        when(installer.isInstalled(Product.pip, pythonInterpreter)).thenResolve(true);
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            DataScience.jupyterInstall as any
        );
        when(command.exec(anything(), anything())).thenReject(new Error('Not found'));
        when(installer.install(anything(), anything(), anything(), anything())).thenResolve(
            InstallerResponse.Installed
        );
        const response = await configuration.installMissingDependencies(pythonInterpreter);

        // Jupyter must be installed & not kernelspec or anything else.
        verify(installer.install(Product.jupyter, anything(), anything(), anything(), anything())).once();
        verify(installer.install(anything(), anything(), anything(), anything(), anything())).once();
        verify(
            appShell.showErrorMessage(
                anything(),
                deepEqual({ modal: true }),
                DataScience.jupyterInstall,
                DataScience.selectDifferentJupyterInterpreter
            )
        ).once();
        assert.equal(response, JupyterInterpreterDependencyResponse.cancel);
    });

    async function testInstallationOfJupyter(
        installerResponse: InstallerResponse,
        expectedConfigurationReponse: JupyterInterpreterDependencyResponse
    ): Promise<void> {
        when(installer.isInstalled(Product.jupyter, pythonInterpreter)).thenResolve(false);
        when(installer.isInstalled(Product.notebook, pythonInterpreter)).thenResolve(true);
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            DataScience.jupyterInstall as any
        );
        when(installer.install(anything(), anything(), anything(), anything(), anything())).thenResolve(
            installerResponse
        );

        const response = await configuration.installMissingDependencies(pythonInterpreter);

        verify(installer.install(Product.jupyter, pythonInterpreter, anything(), anything(), anything())).once();
        assert.equal(response, expectedConfigurationReponse);
    }
    async function testInstallationOfJupyterAndNotebook(
        jupyterInstallerResponse: InstallerResponse,
        notebookInstallationResponse: InstallerResponse,
        expectedConfigurationReponse: JupyterInterpreterDependencyResponse
    ): Promise<void> {
        when(installer.isInstalled(Product.jupyter, pythonInterpreter)).thenResolve(false);
        when(installer.isInstalled(Product.notebook, pythonInterpreter)).thenResolve(false);
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            DataScience.jupyterInstall as any
        );
        when(installer.install(Product.jupyter, anything(), anything(), anything(), anything())).thenResolve(
            jupyterInstallerResponse
        );
        when(installer.install(Product.notebook, anything(), anything(), anything(), anything())).thenResolve(
            notebookInstallationResponse
        );

        const response = await configuration.installMissingDependencies(pythonInterpreter);

        verify(installer.install(Product.jupyter, pythonInterpreter, anything(), anything(), anything())).once();
        verify(installer.install(Product.notebook, pythonInterpreter, anything(), anything(), anything())).once();
        assert.equal(response, expectedConfigurationReponse);
    }
    test('Install Jupyter and return ok if installed successfully', async () =>
        testInstallationOfJupyter(InstallerResponse.Installed, JupyterInterpreterDependencyResponse.ok));
    test('Install Jupyter & notebook and return ok if both are installed successfully', async () =>
        testInstallationOfJupyterAndNotebook(
            InstallerResponse.Installed,
            InstallerResponse.Installed,
            JupyterInterpreterDependencyResponse.ok
        ));
    test('Install Jupyter & notebook and return cancel if notebook is not installed', async () =>
        testInstallationOfJupyterAndNotebook(
            InstallerResponse.Installed,
            InstallerResponse.Ignore,
            JupyterInterpreterDependencyResponse.cancel
        ));
    test('Install Jupyter and return cancel if installation is disabled', async () =>
        testInstallationOfJupyter(InstallerResponse.Disabled, JupyterInterpreterDependencyResponse.cancel));
    test('Install Jupyter and return cancel if installation is ignored', async () =>
        testInstallationOfJupyter(InstallerResponse.Ignore, JupyterInterpreterDependencyResponse.cancel));
});
