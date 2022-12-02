// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as path from '../../../platform/vscode-path/path';
import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationTokenSource, Uri } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { InterpreterKernelSpecFinderHelper } from './interpreterKernelSpecFinderHelper.node';
import { baseKernelPath, JupyterPaths } from './jupyterPaths.node';
import { LocalKernelSpecFinder } from './localKernelSpecFinderBase.node';
import { ITrustedKernelPaths } from './types';
import { uriEquals } from '../../../test/datascience/helpers';
import { IJupyterKernelSpec } from '../../types';
import { noop } from '../../../test/core';

suite('Interpreter Kernel Spec Finder Helper', () => {
    let helper: InterpreterKernelSpecFinderHelper;
    const disposables: IDisposable[] = [];
    let jupyterPaths: JupyterPaths;
    let kernelSpecFinder: LocalKernelSpecFinder;
    let interpreterService: IInterpreterService;
    let extensionChecker: IPythonExtensionChecker;
    let trustedKernels: ITrustedKernelPaths;
    let venvInterpreter: PythonEnvironment;
    setup(() => {
        jupyterPaths = mock<JupyterPaths>();
        when(jupyterPaths.getKernelSpecRootPath()).thenResolve();
        when(jupyterPaths.getKernelSpecRootPaths(anything())).thenResolve([]);
        kernelSpecFinder = mock<LocalKernelSpecFinder>();
        interpreterService = mock<IInterpreterService>();
        extensionChecker = mock<IPythonExtensionChecker>();
        trustedKernels = mock<ITrustedKernelPaths>();

        helper = new InterpreterKernelSpecFinderHelper(
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            instance(interpreterService),
            instance(extensionChecker),
            instance(trustedKernels)
        );

        venvInterpreter = {
            id: 'venvPython',
            sysPrefix: 'home/venvPython',
            uri: Uri.file('home/venvPython/bin/python'),
            version: { major: 3, minor: 10, patch: 0, raw: '3.10.0' }
        };
        disposables.push(helper);
    });
    teardown(() => disposeAllDisposables(disposables));

    test('No kernel specs in venv', async () => {
        const cancelToken = new CancellationTokenSource();
        disposables.push(cancelToken);
        const searchPath = Uri.file(path.join(venvInterpreter.sysPrefix, baseKernelPath));

        when(kernelSpecFinder.findKernelSpecsInPaths(uriEquals(searchPath), anything())).thenResolve([]);
        const kernelSpecs = await helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token);

        assert.strictEqual(kernelSpecs.length, 0);
    });
    test('Finds a kernel spec in venv', async () => {
        const cancelToken = new CancellationTokenSource();
        disposables.push(cancelToken);
        const searchPath = Uri.file(path.join(venvInterpreter.sysPrefix, baseKernelPath));
        const kernelSpecUri = Uri.file('.venvKernelSpec.json');
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['python', '-m', 'venvKernelSpec'],
            display_name: 'venvKernelSpec',
            language: 'python',
            name: 'venvKernelSpec',
            executable: 'python'
        };

        when(kernelSpecFinder.findKernelSpecsInPaths(uriEquals(searchPath), anything())).thenResolve([kernelSpecUri]);
        when(kernelSpecFinder.loadKernelSpec(uriEquals(kernelSpecUri), anything(), venvInterpreter)).thenResolve(
            kernelSpec
        );
        const kernelSpecs = await helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token);

        assert.deepEqual(kernelSpecs, [kernelSpec]);
    });
    test('Finds kernel specs in venv', async () => {
        const cancelToken = new CancellationTokenSource();
        disposables.push(cancelToken);
        const searchPath = Uri.file(path.join(venvInterpreter.sysPrefix, baseKernelPath));
        const kernelSpecUri1 = Uri.file('.venvKernelSpec1.json');
        const kernelSpecUri2 = Uri.file('.venvKernelSpec2.json');
        const kernelSpec1: IJupyterKernelSpec = {
            argv: ['python', '-m', 'venvKernelSpec'],
            display_name: 'venvKernelSpec1',
            language: 'python',
            name: 'venvKernelSpec1',
            executable: 'python'
        };
        const kernelSpec2: IJupyterKernelSpec = {
            argv: ['python', '-m', 'venvKernelSpec'],
            display_name: 'venvKernelSpec2',
            language: 'python',
            name: 'venvKernelSpec2',
            executable: 'python'
        };

        when(kernelSpecFinder.findKernelSpecsInPaths(uriEquals(searchPath), anything())).thenResolve([
            kernelSpecUri1,
            kernelSpecUri2
        ]);
        when(kernelSpecFinder.loadKernelSpec(uriEquals(kernelSpecUri1), anything(), venvInterpreter)).thenResolve(
            kernelSpec1
        );
        when(kernelSpecFinder.loadKernelSpec(uriEquals(kernelSpecUri2), anything(), venvInterpreter)).thenResolve(
            kernelSpec2
        );
        const kernelSpecs = await helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token);

        assert.strictEqual(kernelSpecs.length, 2);
        assert.deepEqual(kernelSpecs, [kernelSpec1, kernelSpec2]);
    });
    test('Finds a kernel spec in venv even after cancelling previous find', async () => {
        const cancelToken = new CancellationTokenSource();
        disposables.push(cancelToken);
        const cancelToken2 = new CancellationTokenSource();
        disposables.push(cancelToken2);
        const searchPath = Uri.file(path.join(venvInterpreter.sysPrefix, baseKernelPath));
        const kernelSpecUri = Uri.file('.venvKernelSpec.json');
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['python', '-m', 'venvKernelSpec'],
            display_name: 'venvKernelSpec',
            language: 'python',
            name: 'venvKernelSpec',
            executable: 'python'
        };

        when(kernelSpecFinder.findKernelSpecsInPaths(uriEquals(searchPath), anything())).thenResolve([kernelSpecUri]);
        when(kernelSpecFinder.loadKernelSpec(uriEquals(kernelSpecUri), anything(), venvInterpreter)).thenResolve(
            kernelSpec
        );

        // Run a couple of times, and cancel.
        helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token).catch(noop);
        helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token).catch(noop);
        helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token).catch(noop);
        helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token).catch(noop);
        helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token).catch(noop);
        helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token).catch(noop);
        helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token).catch(noop);
        helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken.token).catch(noop);
        cancelToken.cancel();
        const kernelSpecs = await helper.findKernelSpecsInInterpreter(venvInterpreter, cancelToken2.token);

        assert.deepEqual(kernelSpecs, [kernelSpec]);
    });
});
