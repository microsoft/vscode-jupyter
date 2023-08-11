// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { instance, mock, verify, when } from 'ts-mockito';
import { CancellationTokenSource, Memento, Uri } from 'vscode';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IDisposable } from '../../../platform/common/types';
import { uriEquals } from '../../../test/datascience/helpers';
import { IJupyterKernelSpec } from '../../types';
import { JupyterPaths } from './jupyterPaths.node';
import { KernelSpecLoader } from './localKernelSpecFinderBase.node';

suite('Local Kernel Spec Finder', () => {
    let finder: KernelSpecLoader;
    const disposables: IDisposable[] = [];
    let fs: IFileSystemNode;
    let globalState: Memento;
    let cancellation: CancellationTokenSource;
    setup(() => {
        fs = mock<IFileSystemNode>();
        globalState = mock<Memento>();
        cancellation = new CancellationTokenSource();
        disposables.push(cancellation);
        const jupyterPaths = mock<JupyterPaths>();
        when(jupyterPaths.getKernelSpecRootPath()).thenResolve();
        finder = new KernelSpecLoader(instance(fs), instance(globalState), instance(jupyterPaths));
        disposables.push(finder);
    });
    teardown(() => disposeAllDisposables(disposables));

    test('Load a kernel spec file', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            display_name: 'Python 3',
            executable: 'python',
            name: 'python3',
            env: { CUSTOM: 'ENVVAR', HELOO: 'WORLD' },
            interrupt_mode: 'message',
            language: 'python'
        };
        const uri = Uri.file('path/to/kernel.json');
        when(fs.readFile(uriEquals(uri))).thenResolve(JSON.stringify(kernelSpec));
        when(fs.readFile(uriEquals(uri))).thenResolve(JSON.stringify(kernelSpec));
        when(fs.readFile(uriEquals(uri))).thenResolve(JSON.stringify(kernelSpec));

        const loadedSpec = await finder.loadKernelSpec(uri, cancellation.token);

        const keys = Object.keys(kernelSpec);
        Object.keys(loadedSpec!)
            .filter((key) => !keys.includes(key))
            .forEach((key) => delete (loadedSpec as any)[key]);
        assert.deepEqual(loadedSpec, kernelSpec);

        verify(fs.readFile(uriEquals(uri))).once();
    });
    test('Load a kernel spec file again if cache is cleared', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            display_name: 'Python 3',
            executable: 'python',
            name: 'python3',
            env: { CUSTOM: 'ENVVAR', HELOO: 'WORLD' },
            interrupt_mode: 'message',
            language: 'python'
        };
        const uri = Uri.file('path/to/kernel.json');
        when(fs.readFile(uriEquals(uri))).thenResolve(JSON.stringify(kernelSpec));

        await finder.loadKernelSpec(uri, cancellation.token);
        await finder.loadKernelSpec(uri, cancellation.token);
        await finder.loadKernelSpec(uri, cancellation.token);

        verify(fs.readFile(uriEquals(uri))).once();

        finder.clearCache();

        await finder.loadKernelSpec(uri, cancellation.token);
        await finder.loadKernelSpec(uri, cancellation.token);

        verify(fs.readFile(uriEquals(uri))).twice();
    });
});
