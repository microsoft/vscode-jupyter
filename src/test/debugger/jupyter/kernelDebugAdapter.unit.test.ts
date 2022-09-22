// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { KernelDebugAdapterBase } from '../../../notebooks/debugger/kernelDebugAdapterBase';
import { IDumpCellResponse } from '../../../notebooks/debugger/debuggingTypes';

suite('Debugging - KernelDebugAdapterBase', () => {
    suite('extractDumpFilePathOnKernelSide', async () => {
        test('Kernel runs on Windows backend', () => {
            const mockResponseFromKernel = { sourcePath: 'c:\\tmp\\1.py' } as IDumpCellResponse;
            const path = KernelDebugAdapterBase.extractDumpFilePathOnKernelSide(mockResponseFromKernel);
            expect(path).to.equal('c:\\tmp\\1.py');
        });

        test('Kernel runs on Windows backend with ipykernel issue', () => {
            const mockResponseFromKernel = { sourcePath: 'c:\\tmp/1.py' } as IDumpCellResponse;
            const path = KernelDebugAdapterBase.extractDumpFilePathOnKernelSide(mockResponseFromKernel);
            expect(path).to.equal('c:\\tmp\\1.py');
        });

        test('Kernel runs on Unix backend', () => {
            const mockResponseFromKernel = { sourcePath: '/tmp/1.py' } as IDumpCellResponse;
            const path = KernelDebugAdapterBase.extractDumpFilePathOnKernelSide(mockResponseFromKernel);
            expect(path).to.equal('/tmp/1.py');
        });
    });
});
