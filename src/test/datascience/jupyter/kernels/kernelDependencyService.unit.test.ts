// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { Memento } from 'vscode';
import { IInstaller, InstallerResponse, Product } from '../../../../client/common/types';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { createPythonInterpreter } from '../../../utils/interpreters';

/* eslint-disable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line
suite('DataScience - Kernel Dependency Service', () => {
    let dependencyService: KernelDependencyService;
    let installer: IInstaller;
    let memento: Memento;
    const interpreter = createPythonInterpreter();
    setup(() => {
        installer = mock<IInstaller>();
        memento = mock<Memento>();
        when(memento.get(anything(), anything())).thenReturn(false);
        when(installer.install(anything(), anything(), anything(), anything())).thenResolve(
            InstallerResponse.Installed
        );
        dependencyService = new KernelDependencyService(instance(installer), instance(memento), false);
    });
    test('Check if ipykernel is installed', async () => {
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(true);

        await dependencyService.installMissingDependencies(interpreter);

        verify(installer.isInstalled(Product.ipykernel, interpreter)).once();
        verify(installer.isInstalled(anything(), anything())).once();
    });
    test('Do not prompt if if ipykernel is installed', async () => {
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(true);

        await dependencyService.installMissingDependencies(interpreter);

        verify(installer.install(Product.ipykernel, anything(), anything(), anything())).never();
    });
    test('Prompt if ipykernel is not installed', async () => {
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
        when(installer.install(anything(), anything(), anything(), anything())).thenResolve(InstallerResponse.Ignore);

        await assert.isRejected(
            dependencyService.installMissingDependencies(interpreter),
            'IPyKernel not installed into interpreter'
        );

        verify(installer.install(Product.ipykernel, anything(), anything(), anything())).once();
    });
    test('Install ipykernel', async () => {
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);

        await dependencyService.installMissingDependencies(interpreter);

        verify(
            installer.install(
                Product.ipykernel,
                interpreter,
                anything(),
                deepEqual({
                    modal: true,
                    message: anything(),
                    reInstallAndUpdate: false
                })
            )
        ).once();
    });
    test('Install ipykernel second time should result in a re-install', async () => {
        when(memento.get(anything(), anything())).thenReturn(true);
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
        when(installer.install(Product.ipykernel, interpreter, anything(), anything())).thenResolve(
            InstallerResponse.Installed
        );

        await dependencyService.installMissingDependencies(interpreter);
        when(
            installer.install(
                Product.ipykernel,
                interpreter,
                anything(),
                deepEqual({
                    modal: true,
                    message: anything(),
                    reInstallAndUpdate: false
                })
            )
        ).thenResolve(InstallerResponse.Installed);
    });
    test('Bubble installation errors', async () => {
        when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
        when(installer.install(Product.ipykernel, interpreter, anything(), anything())).thenReject(
            new Error('Install failed - kaboom')
        );

        const promise = dependencyService.installMissingDependencies(interpreter);

        await assert.isRejected(promise, 'Install failed - kaboom');
    });
});
