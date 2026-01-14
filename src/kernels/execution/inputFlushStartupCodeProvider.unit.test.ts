// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { mock, instance, when } from 'ts-mockito';
import { InputFlushStartupCodeProvider } from './inputFlushStartupCodeProvider';
import { IKernel, IStartupCodeProviders, KernelConnectionMetadata } from '../types';

suite('InputFlushStartupCodeProvider', () => {
    let provider: InputFlushStartupCodeProvider;
    let mockRegistry: IStartupCodeProviders;
    let mockKernel: IKernel;

    setup(() => {
        mockRegistry = mock<IStartupCodeProviders>();
        mockKernel = mock<IKernel>();
        provider = new InputFlushStartupCodeProvider(instance(mockRegistry));
    });

    test('Should return startup code for Python kernels', async () => {
        // Arrange - Create a Python kernel connection metadata
        const pythonConnection: KernelConnectionMetadata = {
            kind: 'startUsingPythonInterpreter',
            id: 'test-python-kernel'
        } as any;
        when(mockKernel.kernelConnectionMetadata).thenReturn(pythonConnection);

        // Act
        const code = await provider.getCode(instance(mockKernel));

        // Assert
        expect(code).to.have.length(1);
        expect(code[0]).to.contain('builtins.input');
        expect(code[0]).to.contain('sys.stdout.flush()');
        expect(code[0]).to.contain('__vscode_input_with_flush');
    });

    test('Should return empty array for non-Python kernels', async () => {
        // Arrange - Create a non-Python kernel connection metadata
        const nonPythonConnection: KernelConnectionMetadata = {
            kind: 'startUsingLocalKernelSpec',
            id: 'test-non-python-kernel'
        } as any;
        when(mockKernel.kernelConnectionMetadata).thenReturn(nonPythonConnection);

        // Act
        const code = await provider.getCode(instance(mockKernel));

        // Assert
        expect(code).to.be.empty;
    });

    test('Startup code should monkey patch input correctly', async () => {
        // Arrange
        const pythonConnection: KernelConnectionMetadata = {
            kind: 'startUsingPythonInterpreter',
            id: 'test-python-kernel'
        } as any;
        when(mockKernel.kernelConnectionMetadata).thenReturn(pythonConnection);

        // Act
        const code = await provider.getCode(instance(mockKernel));

        // Assert
        const startupCode = code[0];

        // Should import required modules
        expect(startupCode).to.contain('import builtins');
        expect(startupCode).to.contain('import sys');

        // Should define wrapper function
        expect(startupCode).to.contain('def __vscode_input_with_flush');

        // Should flush stdout before calling original input
        expect(startupCode).to.contain('sys.stdout.flush()');
        expect(startupCode).to.contain('__vscode_original_input(*args, **kwargs)');

        // Should replace builtins.input with wrapper
        expect(startupCode).to.contain('__vscode_original_input = builtins.input');
        expect(startupCode).to.contain('builtins.input = __vscode_input_with_flush');

        // Should clean up temporary variables
        expect(startupCode).to.contain('del __vscode_input_with_flush');
    });
});
