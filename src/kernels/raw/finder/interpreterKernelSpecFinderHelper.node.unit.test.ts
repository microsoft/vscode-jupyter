// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as path from '../../../platform/vscode-path/path';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { CancellationTokenSource, Disposable, EventEmitter, Uri } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { DisposableStore } from '../../../platform/common/utils/lifecycle';
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
import { PythonExtension } from '@vscode/python-extension';
import { crateMockedPythonApi, whenKnownEnvironments, whenResolveEnvironment } from '../../helpers.unit.test';

suite('Interpreter Kernel Spec Finder Helper', () => {
    let helper: GlobalPythonKernelSpecFinder;
    let disposables: DisposableStore;
    let jupyterPaths: JupyterPaths;
    let kernelSpecFinder: LocalKernelSpecFinder;
    let interpreterService: IInterpreterService;
    let extensionChecker: IPythonExtensionChecker;
    let trustedKernels: ITrustedKernelPaths;
    let venvInterpreter: PythonEnvironment & { sysPrefix: string };
    const condaInterpreter: PythonEnvironment & { sysPrefix: string } = {
        id: 'conda',
        sysPrefix: 'home/conda',
        uri: Uri.file('conda')
    };
    const globalInterpreter: PythonEnvironment & { sysPrefix: string } = {
        id: 'globalInterpreter',
        sysPrefix: 'home/global',
        uri: Uri.joinPath(Uri.file('globalSys'), 'bin', 'python')
    };
    let environments: PythonExtension['environments'];
    let eventEmitter: EventEmitter<IJupyterKernelSpec>;
    const kernelSpecs: IJupyterKernelSpec[] = [];
    let cancelToken: CancellationTokenSource;
    setup(() => {
        disposables = new DisposableStore();
        cancelToken = disposables.add(new CancellationTokenSource());

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
        disposables.add(helper);

        eventEmitter = disposables.add(new EventEmitter<IJupyterKernelSpec>());
        disposables.add(eventEmitter.event((item) => kernelSpecs.push(item)));
        disposables.add(new Disposable(() => (kernelSpecs.length = 0)));

        venvInterpreter = {
            id: 'venvPython',
            sysPrefix: 'home/venvPython',
            uri: Uri.file('home/venvPython/bin/python')
        };
        environments = crateMockedPythonApi(disposables).environments;
        whenKnownEnvironments(environments).thenReturn([]);
        whenResolveEnvironment(environments, venvInterpreter.id).thenResolve({
            id: venvInterpreter.id,
            executable: { sysPrefix: 'home/venvPython', uri: Uri.file('home/venvPython/bin/python') }
        });
        whenResolveEnvironment(environments, condaInterpreter.id).thenResolve({
            id: condaInterpreter.id,
            executable: { sysPrefix: 'home/conda' }
        });
        whenResolveEnvironment(environments, globalInterpreter.id).thenResolve({
            id: globalInterpreter.id,
            executable: { sysPrefix: 'home/global' }
        });
        kernelSpecs.length = 0;
    });
    teardown(() => disposables.dispose());

    test('No kernel specs in venv', async () => {
        const searchPath = Uri.file(path.join('home/venvPython', baseKernelPath));
        when(kernelSpecFinder.findKernelSpecsInPaths(uriEquals(searchPath), anything())).thenResolve([]);

        await findKernelSpecsInInterpreter(
            venvInterpreter,
            cancelToken.token,
            instance(jupyterPaths),
            instance(kernelSpecFinder),
            eventEmitter
        );

        verify(kernelSpecFinder.findKernelSpecsInPaths(uriEquals(searchPath), anything())).atLeast(1);
        assert.strictEqual(kernelSpecs.length, 0);
    });
    test('Finds a kernel spec in venv', async () => {
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
        const cancelToken2 = disposables.add(new CancellationTokenSource());
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
        let eventEmitter = disposables.add(new EventEmitter<IJupyterKernelSpec>());
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

        eventEmitter = disposables.add(new EventEmitter<IJupyterKernelSpec>());
        disposables.add(eventEmitter.event((item) => kernelSpecs.push(item)));
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
        whenKnownEnvironments(environments).thenReturn([
            {
                id: venvInterpreter.id,
                executable: { sysPrefix: 'home/venvPython', uri: Uri.file('home/venvPython/bin/python') }
            },
            {
                id: condaInterpreter.id,
                executable: { sysPrefix: 'home/conda' }
            },
            {
                id: globalInterpreter.id,
                executable: { sysPrefix: 'home/global' }
            }
        ]);
        const interpreter = await helper.findMatchingInterpreter(kernelSpec, 'startUsingPythonInterpreter');

        assert.strictEqual(interpreter?.id, venvInterpreter.id);
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
        whenKnownEnvironments(environments).thenReturn([
            {
                id: venvInterpreter.id,
                executable: { sysPrefix: 'home/venvPython', uri: Uri.file('home/venvPython/bin/python') }
            },
            {
                id: condaInterpreter.id,
                executable: { sysPrefix: 'home/conda' }
            },
            {
                id: globalInterpreter.id,
                executable: { sysPrefix: 'home/global' }
            }
        ]);
        const interpreter = await helper.findMatchingInterpreter(kernelSpec, 'startUsingPythonInterpreter');

        assert.strictEqual(interpreter?.id, venvInterpreter.id);
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
        whenKnownEnvironments(environments).thenReturn([
            {
                id: condaInterpreter.id,
                executable: { sysPrefix: 'home/conda' }
            },
            {
                id: globalInterpreter.id,
                executable: { sysPrefix: 'home/global' }
            }
        ]);

        when(interpreterService.getInterpreterDetails(uriEquals(venvInterpreter.uri), anything())).thenResolve(
            venvInterpreter
        );
        when(trustedKernels.isTrusted(uriEquals(venvInterpreter.uri))).thenReturn(true);

        const interpreter = await helper.findMatchingInterpreter(kernelSpec, 'startUsingPythonInterpreter');

        assert.strictEqual(interpreter?.id, venvInterpreter.id);
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
        when(interpreterService.getInterpreterDetails(uriEquals(venvInterpreter.uri), anything())).thenResolve(
            venvInterpreter
        );
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
        when(interpreterService.getInterpreterDetails(uriEquals(venvInterpreter.uri))).thenResolve(undefined);
        when(trustedKernels.isTrusted(uriEquals(venvInterpreter.uri))).thenReturn(true);

        const interpreter = await helper.findMatchingInterpreter(kernelSpec, 'startUsingPythonInterpreter');

        assert.isUndefined(interpreter);
    });
});
