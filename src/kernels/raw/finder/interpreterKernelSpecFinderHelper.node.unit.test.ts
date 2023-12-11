// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as path from '../../../platform/vscode-path/path';
import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationTokenSource, EventEmitter, Uri } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IDisposable } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { GlobalPythonKernelSpecFinder, findKernelSpecsInInterpreter } from './interpreterKernelSpecFinderHelper.node';
import { baseKernelPath, JupyterPaths } from './jupyterPaths.node';
import { LocalKernelSpecFinder } from './localKernelSpecFinderBase.node';
import { ITrustedKernelPaths } from './types';
import { uriEquals } from '../../../test/datascience/helpers';
import { IJupyterKernelSpec } from '../../types';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';

suite('Interpreter Kernel Spec Finder Helper', () => {
    let helper: GlobalPythonKernelSpecFinder;
    let disposables: IDisposable[] = [];
    let jupyterPaths: JupyterPaths;
    let kernelSpecFinder: LocalKernelSpecFinder;
    let interpreterService: IInterpreterService;
    let extensionChecker: IPythonExtensionChecker;
    let trustedKernels: ITrustedKernelPaths;
    let venvInterpreter: PythonEnvironment;
    const condaInterpreter: PythonEnvironment = {
        id: 'conda',
        sysPrefix: 'home/conda',
        uri: Uri.file('conda')
    };
    const globalInterpreter: PythonEnvironment = {
        id: 'globalInterpreter',
        sysPrefix: 'home/global',
        uri: Uri.joinPath(Uri.file('globalSys'), 'bin', 'python')
    };
    setup(() => {
        jupyterPaths = mock<JupyterPaths>();
        when(jupyterPaths.getKernelSpecRootPath()).thenResolve();
        when(jupyterPaths.getKernelSpecRootPaths(anything())).thenResolve([]);
        kernelSpecFinder = mock<LocalKernelSpecFinder>();
        interpreterService = mock<IInterpreterService>();
        extensionChecker = mock<IPythonExtensionChecker>();
        trustedKernels = mock<ITrustedKernelPaths>();
        when(mockedVSCodeNamespaces.workspace.workspaceFolders).thenReturn([]);
        const knownPathKernelSpecFinder = mock<LocalKnownPathKernelSpecFinder>();
        helper = new GlobalPythonKernelSpecFinder(
            instance(interpreterService),
            instance(knownPathKernelSpecFinder),
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
    teardown(() => (disposables = dispose(disposables)));

    test('No kernel specs in venv', async () => {
        const cancelToken = new CancellationTokenSource();
        disposables.push(cancelToken);
        const searchPath = Uri.file(path.join(venvInterpreter.sysPrefix, baseKernelPath));

        when(kernelSpecFinder.findKernelSpecsInPaths(uriEquals(searchPath), anything())).thenResolve([]);
        const kernelSpecs: IJupyterKernelSpec[] = [];
        const eventEmitter = new EventEmitter<IJupyterKernelSpec>();
        eventEmitter.event((item) => kernelSpecs.push(item), undefined, disposables);
        disposables.push(eventEmitter);

        await findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );

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
        const kernelSpecs: IJupyterKernelSpec[] = [];
        const eventEmitter = new EventEmitter<IJupyterKernelSpec>();
        eventEmitter.event((item) => kernelSpecs.push(item), undefined, disposables);
        disposables.push(eventEmitter);
        await findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );

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
        const kernelSpecs: IJupyterKernelSpec[] = [];
        const eventEmitter = new EventEmitter<IJupyterKernelSpec>();
        eventEmitter.event((item) => kernelSpecs.push(item), undefined, disposables);
        disposables.push(eventEmitter);
        await findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );

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
        let eventEmitter = new EventEmitter<IJupyterKernelSpec>();
        disposables.push(eventEmitter);
        void findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );
        void findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );
        void findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );
        void findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );
        void findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );
        void findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );
        void findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );
        void findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );
        cancelToken.cancel();
        const kernelSpecs: IJupyterKernelSpec[] = [];
        eventEmitter = new EventEmitter<IJupyterKernelSpec>();
        eventEmitter.event((item) => kernelSpecs.push(item), undefined, disposables);
        disposables.push(eventEmitter);
        await findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken2.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );

        assert.deepEqual(kernelSpecs, [kernelSpec]);
    });
    test('Find interpreter information for python defined in argv of Kernelspec.json', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: [venvInterpreter.uri.fsPath, '-m', 'venvKernelSpec'],
            display_name: 'venvKernelSpec',
            language: 'python',
            name: 'venvKernelSpec',
            executable: 'python'
        };

        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(interpreterService.resolvedEnvironments).thenReturn([
            venvInterpreter,
            condaInterpreter,
            globalInterpreter
        ]);
        const interpreter = await helper.findMatchingInterpreter(kernelSpec, 'startUsingPythonInterpreter');

        assert.strictEqual(interpreter, venvInterpreter);
    });
    test('Find interpreter information for python defined in metadata of Kernelspec.json', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['python', '-m', 'venvKernelSpec'],
            display_name: 'venvKernelSpec',
            language: 'python',
            name: 'venvKernelSpec',
            executable: 'python',
            metadata: {
                interpreter: {
                    path: venvInterpreter.uri.fsPath
                }
            }
        };

        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(interpreterService.resolvedEnvironments).thenReturn([
            venvInterpreter,
            condaInterpreter,
            globalInterpreter
        ]);
        const interpreter = await helper.findMatchingInterpreter(kernelSpec, 'startUsingPythonInterpreter');

        assert.strictEqual(interpreter, venvInterpreter);
    });
    test('Find interpreter information for python defined in argv of Kernelspec.json (when python env is not yet discovered)', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: [venvInterpreter.uri.fsPath, '-m', 'venvKernelSpec'],
            display_name: 'venvKernelSpec',
            language: 'python',
            name: 'venvKernelSpec',
            executable: 'python',
            metadata: {
                interpreter: {
                    path: venvInterpreter.uri.fsPath
                }
            }
        };

        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(interpreterService.resolvedEnvironments).thenReturn([condaInterpreter, globalInterpreter]);
        when(interpreterService.getInterpreterDetails(uriEquals(venvInterpreter.uri))).thenResolve(venvInterpreter);
        when(trustedKernels.isTrusted(uriEquals(venvInterpreter.uri))).thenReturn(true);

        const interpreter = await helper.findMatchingInterpreter(kernelSpec, 'startUsingPythonInterpreter');

        assert.strictEqual(interpreter, venvInterpreter);
    });
    test('Does not Find interpreter information for python defined in argv of Kernelspec.json (when python env is not yet discovered & kernelspec is not trusted)', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: [venvInterpreter.uri.fsPath, '-m', 'venvKernelSpec'],
            display_name: 'venvKernelSpec',
            language: 'python',
            name: 'venvKernelSpec',
            executable: 'python',
            specFile: Uri.file('somefile.json').fsPath,
            metadata: {
                interpreter: {
                    path: venvInterpreter.uri.fsPath
                }
            }
        };

        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(interpreterService.resolvedEnvironments).thenReturn([condaInterpreter, globalInterpreter]);
        when(interpreterService.getInterpreterDetails(uriEquals(venvInterpreter.uri))).thenResolve(venvInterpreter);
        when(trustedKernels.isTrusted(uriEquals(venvInterpreter.uri))).thenReturn(false);

        const interpreter = await helper.findMatchingInterpreter(kernelSpec, 'startUsingPythonInterpreter');

        assert.isUndefined(interpreter);
    });
    test('Does not Find interpreter information for python defined in argv of Kernelspec.json (when python env is not yet discovered & interpreter is not found)', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: [venvInterpreter.uri.fsPath, '-m', 'venvKernelSpec'],
            display_name: 'venvKernelSpec',
            language: 'python',
            name: 'venvKernelSpec',
            executable: 'python',
            specFile: Uri.file('somefile.json').fsPath,
            metadata: {
                interpreter: {
                    path: venvInterpreter.uri.fsPath
                }
            }
        };

        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(interpreterService.resolvedEnvironments).thenReturn([condaInterpreter, globalInterpreter]);
        when(interpreterService.getInterpreterDetails(uriEquals(venvInterpreter.uri))).thenResolve(undefined);
        when(trustedKernels.isTrusted(uriEquals(venvInterpreter.uri))).thenReturn(true);

        const interpreter = await helper.findMatchingInterpreter(kernelSpec, 'startUsingPythonInterpreter');

        assert.isUndefined(interpreter);
    });
});
