// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Memento, Uri } from 'vscode';
import { IApplicationShell, ICommandManager } from '../../../../client/common/application/types';
import { IInstaller, InstallerResponse, Product } from '../../../../client/common/types';
import { Common, DataScience } from '../../../../client/common/utils/localize';
import { Commands } from '../../../../client/datascience/constants';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { EnvironmentType } from '../../../../client/pythonEnvironments/info';
import { createPythonInterpreter } from '../../../utils/interpreters';

/* eslint-disable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line
suite('DataScience - Kernel Dependency Service', () => {
    let dependencyService: KernelDependencyService;
    let appShell: IApplicationShell;
    let cmdManager: ICommandManager;
    let installer: IInstaller;
    let memento: Memento;
    const interpreter = createPythonInterpreter({ displayName: 'name', envType: EnvironmentType.Conda, path: 'abc' });
    setup(() => {
        appShell = mock<IApplicationShell>();
        installer = mock<IInstaller>();
        cmdManager = mock<ICommandManager>();
        memento = mock<Memento>();
        when(memento.get(anything(), anything())).thenReturn(false);
        dependencyService = new KernelDependencyService(
            instance(appShell),
            instance(installer),
            instance(memento),
            false,
            instance(cmdManager),
            true
        );
    });
    test('Check if ipykernel is installed', async () => {
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(true);

        await dependencyService.installMissingDependencies(undefined, interpreter);

        verify(installer.isInstalled(Product.ipykernel, interpreter)).once();
        verify(installer.isInstalled(anything(), anything())).once();
    });
    test('Do not prompt if if ipykernel is installed', async () => {
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(true);

        await dependencyService.installMissingDependencies(undefined, interpreter);

        verify(appShell.showErrorMessage(anything(), anything(), anything())).never();
    });
    test('Prompt if if ipykernel is not installed', async () => {
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
        when(appShell.showErrorMessage(anything(), anything())).thenResolve(Common.install() as any);

        await assert.isRejected(
            dependencyService.installMissingDependencies(undefined, interpreter),
            'IPyKernel not installed into interpreter'
        );

        verify(appShell.showErrorMessage(anything(), anything(), anything())).never();
    });
    test('Install ipykernel', async () => {
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
        when(installer.install(Product.ipykernel, interpreter, anything(), anything())).thenResolve(
            InstallerResponse.Installed
        );
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(
            Common.install() as any
        );

        await dependencyService.installMissingDependencies(undefined, interpreter);
    });
    test('Install ipykernel second time should result in a re-install', async () => {
        when(memento.get(anything(), anything())).thenReturn(true);
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
        when(installer.install(Product.ipykernel, interpreter, anything(), true)).thenResolve(
            InstallerResponse.Installed
        );
        when(appShell.showErrorMessage(anything(), anything(), Common.reInstall(), anything())).thenResolve(
            Common.reInstall() as any
        );

        await dependencyService.installMissingDependencies(undefined, interpreter);
    });
    test('Select kernel instead of installing (interactive window)', async () => {
        when(cmdManager.executeCommand(anything())).thenResolve();
        when(memento.get(anything(), anything())).thenReturn(false);
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
        when(installer.install(Product.ipykernel, interpreter, anything(), true)).thenResolve(
            InstallerResponse.Installed
        );
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(
            DataScience.selectKernel() as any
        );

        const promise = dependencyService.installMissingDependencies(Uri.file('test.py'), interpreter);

        await assert.isRejected(promise, 'IPyKernel not installed into interpreter name:abc');
        verify(cmdManager.executeCommand(Commands.SwitchJupyterKernel)).once();
    });
    test('Select kernel instead of installing (notebook)', async () => {
        when(cmdManager.executeCommand(anything())).thenResolve();
        when(memento.get(anything(), anything())).thenReturn(false);
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
        when(installer.install(Product.ipykernel, interpreter, anything(), true)).thenResolve(
            InstallerResponse.Installed
        );
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(
            DataScience.selectKernel() as any
        );

        const promise = dependencyService.installMissingDependencies(Uri.file('test.ipynb'), interpreter);

        await assert.isRejected(promise, 'IPyKernel not installed into interpreter name:abc');
        verify(cmdManager.executeCommand('notebook.selectKernel')).once();
    });
    test('Bubble installation errors', async () => {
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
        when(installer.install(Product.ipykernel, interpreter, anything(), anything())).thenReject(
            new Error('Install failed - kaboom')
        );
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(
            Common.install() as any
        );

        const promise = dependencyService.installMissingDependencies(undefined, interpreter);

        await assert.isRejected(promise, 'Install failed - kaboom');
    });
});
