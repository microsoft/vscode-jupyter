// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from '../../../../platform/vscode-path/path';
import * as sinon from 'sinon';
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
import { PythonExtension } from '@vscode/python-extension';
import { resolvableInstance } from '../../../../test/datascience/helpers';
import { dispose } from '../../../../platform/common/utils/lifecycle';

[false, true].forEach((isWeb) => {
    const localNonPythonKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: '',
        kernelSpec: mock<IJupyterKernelSpec>()
    });
    const localPythonKernelSpec = PythonKernelConnectionMetadata.create({
        id: 'localPythonKernelSpec',
        kernelSpec: mock<IJupyterKernelSpec>(),
        interpreter: {
            id: 'interpreterId',
            sysPrefix: __dirname
        } as any
    });
    const serverProviderHandle = { handle: 'handle', id: 'id', extensionId: '' };
    const remoteKernelSpec = RemoteKernelSpecConnectionMetadata.create({
        id: '',
        baseUrl: 'http://bogus.com',
        kernelSpec: instance(mock<IJupyterKernelSpec>()),
        serverProviderHandle
    });
    const remoteLiveKernel = LiveRemoteKernelConnectionMetadata.create({
        id: '',
        baseUrl: 'http://bogus.com',
        kernelModel: instance(mock<LiveKernelModel>()),
        serverProviderHandle
    });
    suite(`NBExtension Path Provider for ${isWeb ? 'Web' : 'Node'}`, () => {
        let provider: INbExtensionsPathProvider;
        let kernel: IKernel;
        let disposables: { dispose(): void }[] = [];
        setup(() => {
            kernel = mock<IKernel>();
            provider = isWeb ? new WebNbExtensionsPathProvider() : new NbExtensionsPathProvider();
            const mockedApi = mock<PythonExtension>();
            sinon.stub(PythonExtension, 'api').resolves(resolvableInstance(mockedApi));
            disposables.push({ dispose: () => sinon.restore() });
            const environments = mock<PythonExtension['environments']>();
            when(mockedApi.environments).thenReturn(instance(environments));
            when(environments.resolveEnvironment(localPythonKernelSpec.interpreter.id)).thenResolve({
                executable: { sysPrefix: __dirname }
            } as any);
        });
        teardown(() => {
            disposables = dispose(disposables);
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
                assert.strictEqual(baseUrl?.toString(), Uri.file(path.join(__dirname, 'share', 'jupyter')).toString());
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
