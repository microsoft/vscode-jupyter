// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from '../../../../platform/vscode-path/path';
import { assert } from 'chai';
import { when, mock, instance } from 'ts-mockito';
import { Uri } from 'vscode';
import {
    LocalKernelSpecConnectionMetadata,
    IJupyterKernelSpec,
    PythonKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    LiveKernelModel,
    IKernel
} from '../../../../kernels/types';
import { INbExtensionsPathProvider } from '../types';
import { NbExtensionsPathProvider } from './nbExtensionsPathProvider.node';
import { NbExtensionsPathProvider as WebNbExtensionsPathProvider } from './nbExtensionsPathProvider.web';

[false, true].forEach(async (isWeb) => {
    const localNonPythonKernelSpec = LocalKernelSpecConnectionMetadata.create({
        kernelSpec: mock<IJupyterKernelSpec>()
    });
    const localPythonKernelSpec = PythonKernelConnectionMetadata.create({
        kernelSpec: mock<IJupyterKernelSpec>(),
        interpreter: {
            sysPrefix: __dirname
        } as any
    });
    const remoteKernelSpec = await RemoteKernelSpecConnectionMetadata.create({
        serverHandle: {
            extensionId: '1',
            handle: '1',
            id: '1'
        },
        baseUrl: 'http://bogus.com',
        kernelSpec: instance(mock<IJupyterKernelSpec>())
    });
    const remoteLiveKernel = LiveRemoteKernelConnectionMetadata.create({
        serverHandle: {
            extensionId: '1',
            handle: '1',
            id: '1'
        },
        baseUrl: 'http://bogus.com',
        kernelModel: instance(mock<LiveKernelModel>())
    });
    suite(`NBExtension Path Provider for ${isWeb ? 'Web' : 'Node'}`, () => {
        let provider: INbExtensionsPathProvider;
        let kernel: IKernel;
        setup(() => {
            kernel = mock<IKernel>();
            provider = isWeb ? new WebNbExtensionsPathProvider() : new NbExtensionsPathProvider();
        });
        test('Returns base url for local non-python kernelspec', async () => {
            when(kernel.kernelConnectionMetadata).thenReturn(localNonPythonKernelSpec);
            assert.isUndefined(await provider.getNbExtensionsParentPath(instance(kernel)));
        });
        test('Returns base url for local python kernelspec', async () => {
            when(kernel.kernelConnectionMetadata).thenReturn(localPythonKernelSpec);
            const baseUrl = await provider.getNbExtensionsParentPath(instance(kernel));
            if (isWeb) {
                assert.isUndefined(baseUrl);
            } else {
                assert.strictEqual(
                    baseUrl?.toString(),
                    Uri.file(path.join(localPythonKernelSpec.interpreter.sysPrefix, 'share', 'jupyter')).toString()
                );
            }
        });
        test('Returns base url for remote kernelspec', async () => {
            when(kernel.kernelConnectionMetadata).thenReturn(remoteKernelSpec);
            const baseUrl = await provider.getNbExtensionsParentPath(instance(kernel));
            assert.strictEqual(baseUrl?.toString(), Uri.parse(remoteKernelSpec.baseUrl).toString());
        });
        test('Returns base url for remote live kernel', async () => {
            when(kernel.kernelConnectionMetadata).thenReturn(remoteLiveKernel);
            const baseUrl = await provider.getNbExtensionsParentPath(instance(kernel));
            assert.strictEqual(baseUrl?.toString(), Uri.parse(remoteLiveKernel.baseUrl).toString());
        });
    });
});
