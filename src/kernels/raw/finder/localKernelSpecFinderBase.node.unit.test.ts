// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { instance, mock, verify, when } from 'ts-mockito';
import { CancellationTokenSource, Memento, Uri } from 'vscode';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IDisposable } from '../../../platform/common/types';
import { uriEquals } from '../../../test/datascience/helpers';
import { getInterpreterKernelSpecName } from '../../helpers';
import { crateMockedPythonApi } from '../../helpers.unit.test';
import { IJupyterKernelSpec } from '../../types';
import { JupyterPaths } from './jupyterPaths.node';
import { LocalKernelSpecFinder } from './localKernelSpecFinderBase.node';

suite('Local Kernel Spec Finder', () => {
    let finder: LocalKernelSpecFinder;
    let disposables: IDisposable[] = [];
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
        finder = new LocalKernelSpecFinder(instance(fs), instance(globalState), instance(jupyterPaths));
        disposables.push(finder);
    });
    teardown(() => (disposables = dispose(disposables)));

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
    const registeredName = 'pixi-kernel-python3';
    for (const { name, expectedName } of [
        { name: undefined, expectedName: registeredName },
        { name: registeredName, expectedName: `${registeredName}.run#python` },
        { name: 'undefined', expectedName: 'undefined.run#python' }
    ]) {
        test(`Load a global Pixi kernel spec ${
            name ? 'with' : 'without'
        } an explicit name as ${expectedName}`, async () => {
            const uri = Uri.joinPath(Uri.file('kernels'), registeredName, 'kernel.json');
            const kernelSpec = {
                name,
                argv: ['pixi', 'run', 'python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
                display_name: 'Python (Pixi)',
                language: 'python'
            };
            when(fs.readFile(uriEquals(uri))).thenResolve(JSON.stringify(kernelSpec));

            const loadedSpec = await finder.loadKernelSpec(uri, cancellation.token);

            assert.strictEqual(loadedSpec?.name, expectedName);
        });
    }
    test('Disambiguate a custom interpreter kernel spec by its launch arguments', async () => {
        crateMockedPythonApi(disposables);
        const interpreter = { id: 'venv', uri: Uri.file('venv/bin/python') };
        when(fs.exists(uriEquals(interpreter.uri))).thenResolve(true);
        const uri = Uri.file('venv/share/jupyter/kernels/custom/kernel.json');
        const kernelSpec = {
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}', '--profile=custom'],
            display_name: 'Custom Python',
            language: 'python'
        };
        when(fs.readFile(uriEquals(uri))).thenResolve(JSON.stringify(kernelSpec));

        const loadedSpec = await finder.loadKernelSpec(uri, cancellation.token, interpreter);

        assert.strictEqual(loadedSpec?.name, `${await getInterpreterKernelSpecName(interpreter)}.--profile=custom`);
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
