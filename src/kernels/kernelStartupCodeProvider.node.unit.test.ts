// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { KernelWorkingFolder } from './kernelWorkingFolder.node';
import { IKernel } from './types';
import { KernelStartupCodeProvider } from './kernelStartupCodeProvider.node';

suite('Kernel Startup Code Provider', function () {
    let kernelWorkingFolder: KernelWorkingFolder;
    let startupCodeProvider: KernelStartupCodeProvider;
    let kernel: IKernel;
    setup(() => {
        kernel = mock<IKernel>();

        kernelWorkingFolder = mock<KernelWorkingFolder>();
        startupCodeProvider = new KernelStartupCodeProvider(instance(kernelWorkingFolder));
    });
    test('Has startup code when we do not have a working directory', async () => {
        when(kernelWorkingFolder.getWorkingDirectory(anything())).thenResolve(undefined);

        assert.isEmpty(await startupCodeProvider.getCode(instance(kernel)));
    });
    test('Has startup code when we have a working directory', async () => {
        when(kernelWorkingFolder.getWorkingDirectory(anything())).thenResolve(Uri.file(__dirname));

        assert.isNotEmpty(await startupCodeProvider.getCode(instance(kernel)));
    });
});
