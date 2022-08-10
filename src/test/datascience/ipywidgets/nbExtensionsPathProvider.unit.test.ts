// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from '../../../platform/vscode-path/path';
import { assert } from 'chai';
import { when, mock, instance } from 'ts-mockito';
import { Uri } from 'vscode';
import { NbExtensionsPathProvider } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/nbExtensionsPathProvider.node';
import { NbExtensionsPathProvider as WebNbExtensionsPathProvider } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/nbExtensionsPathProvider.web';
import { INbExtensionsPathProvider } from '../../../notebooks/controllers/ipywidgets/types';
import {
    IJupyterKernelSpec,
    IKernel,
    LiveKernelModel,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata,
    RemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../../kernels/types';

[false, true].forEach((isWeb) => {
    const localNonPythonKernelSpec: LocalKernelSpecConnectionMetadata = {
        id: '',
        kernelSpec: mock<IJupyterKernelSpec>(),
        kind: 'startUsingLocalKernelSpec'
    };
    const localPythonKernelSpec: PythonKernelConnectionMetadata = {
        id: '',
        kernelSpec: mock<IJupyterKernelSpec>(),
        kind: 'startUsingPythonInterpreter',
        interpreter: {
            sysPrefix: __dirname
        } as any
    };
    const remoteKernelSpec: RemoteKernelSpecConnectionMetadata = {
        id: '',
        serverId: '',
        baseUrl: 'http://bogus.com',
        kernelSpec: instance(mock<IJupyterKernelSpec>()),
        kind: 'startUsingRemoteKernelSpec'
    };
    const remoteLiveKernel: RemoteKernelConnectionMetadata = {
        id: '',
        serverId: '',
        baseUrl: 'http://bogus.com',
        kernelModel: instance(mock<LiveKernelModel>()),
        kind: 'connectToLiveRemoteKernel'
    };
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
