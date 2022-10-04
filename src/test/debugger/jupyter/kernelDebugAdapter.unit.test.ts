// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { KernelDebugAdapterBase } from '../../../notebooks/debugger/kernelDebugAdapterBase';

suite('Debugging - KernelDebugAdapterBase', () => {
    suite('extractDumpFilePathOnKernelSide', async () => {
        test('Kernel runs on Windows backend', () => {
            const pathFromKernel = 'c:\\tmp\\1.py';
            const path = KernelDebugAdapterBase.normalizeFsAware(pathFromKernel);
            expect(path).to.equal('c:\\tmp\\1.py');
        });

        test('Kernel runs on Windows backend with ipykernel issue', () => {
            const pathFromKernel = 'c:\\tmp/1.py';
            const path = KernelDebugAdapterBase.normalizeFsAware(pathFromKernel);
            expect(path).to.equal('c:\\tmp\\1.py');
        });

        test('Kernel runs on Unix backend', () => {
            const pathFromKernel = '/tmp/1.py';
            const path = KernelDebugAdapterBase.normalizeFsAware(pathFromKernel);
            expect(path).to.equal('/tmp/1.py');
        });
    });
});
