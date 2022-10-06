// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { KernelWorkingFolder } from './kernelWorkingFolder.node';
import { IJupyterKernelSpec, IKernel, KernelConnectionMetadata, LocalKernelSpecConnectionMetadata } from './types';
import { KernelStartupCodeProvider } from './kernelStartupCodeProvider.node';
import { PYTHON_LANGUAGE } from '../platform/common/constants';

suite('Kernel Startup Code Provider', function () {
    let kernelWorkingFolder: KernelWorkingFolder;
    let startupCodeProvider: KernelStartupCodeProvider;
    let kernel: IKernel;
    let connectionMetadata: KernelConnectionMetadata;
    let kernelSpec: IJupyterKernelSpec;
    setup(() => {
        kernel = mock<IKernel>();
        kernelSpec = mock<IJupyterKernelSpec>();
        connectionMetadata = mock<KernelConnectionMetadata>();
        when(kernel.kernelConnectionMetadata).thenReturn(instance(connectionMetadata));

        kernelWorkingFolder = mock<KernelWorkingFolder>();
        when(kernelWorkingFolder.getWorkingDirectory(anything())).thenResolve(Uri.file(__dirname));
        startupCodeProvider = new KernelStartupCodeProvider(instance(kernelWorkingFolder));
    });
    test('No startup code for Remote Live Kernel', async () => {
        when(connectionMetadata.kind).thenReturn('connectToLiveRemoteKernel');

        assert.isEmpty(await startupCodeProvider.getCode(instance(kernel)));
    });
    test('No startup code for Remote Kernel Specs', async () => {
        when(connectionMetadata.kind).thenReturn('startUsingRemoteKernelSpec');

        assert.isEmpty(await startupCodeProvider.getCode(instance(kernel)));
    });
    test('No startup code for non-Python local kernelspecs', async () => {
        let localKernelSpec = connectionMetadata as LocalKernelSpecConnectionMetadata;
        when(localKernelSpec.kind).thenReturn('startUsingLocalKernelSpec');
        when(localKernelSpec.kernelSpec).thenReturn(instance(kernelSpec));
        when(kernelSpec.language).thenReturn('Java');

        assert.isEmpty(await startupCodeProvider.getCode(instance(kernel)));
    });
    test('Has startup code for Local Python Kernelspecs', async () => {
        let localKernelSpec = connectionMetadata as LocalKernelSpecConnectionMetadata;
        when(localKernelSpec.kind).thenReturn('startUsingLocalKernelSpec');
        when(localKernelSpec.kernelSpec).thenReturn(instance(kernelSpec));
        when(kernelSpec.language).thenReturn(PYTHON_LANGUAGE);

        assert.isNotEmpty(await startupCodeProvider.getCode(instance(kernel)));
    });
    test('Has startup code for Local Python Interpreter', async () => {
        when(connectionMetadata.kind).thenReturn('startUsingPythonInterpreter');

        assert.isNotEmpty(await startupCodeProvider.getCode(instance(kernel)));
    });
});
