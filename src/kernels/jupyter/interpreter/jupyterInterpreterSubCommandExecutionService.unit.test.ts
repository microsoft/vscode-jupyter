// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert, expect, use } from 'chai';
import chaiPromise from 'chai-as-promised';
import * as path from '../../../platform/vscode-path/path';
import * as sinon from 'sinon';
import { anything, capture, deepEqual, instance, mock, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { ObservableExecutionResult, Output } from '../../../platform/common/process/types.node';
import { DataScience } from '../../../platform/common/utils/localize';
import { EXTENSION_ROOT_DIR } from '../../../platform/constants.node';
import { IEnvironmentActivationService } from '../../../platform/interpreter/activation/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { ProductNames } from '../../../platform/interpreter/installer/productNames';
import { Product } from '../../../platform/interpreter/installer/types';
import { PythonExecutionFactory } from '../../../platform/interpreter/pythonExecutionFactory.node';
import { IPythonExecutionService } from '../../../platform/interpreter/types.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../test/constants.node';
import { MockOutputChannel } from '../../../test/mockClasses';
import { createPythonInterpreter } from '../../../test/utils/interpreters';
import { JupyterPaths } from '../../raw/finder/jupyterPaths.node';
import { JupyterServerInfo } from '../types';
import { JupyterInterpreterDependencyService } from './jupyterInterpreterDependencyService.node';
import { JupyterInterpreterService } from './jupyterInterpreterService.node';
import { JupyterInterpreterSubCommandExecutionService } from './jupyterInterpreterSubCommandExecutionService.node';
import { noop } from '../../../test/core';
import { createObservable } from '../../../platform/common/process/proc.node';
import { IDisposable } from '../../../platform/common/types';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { PythonExtension } from '@vscode/python-extension';
import { setPythonApi } from '../../../platform/interpreter/helpers';
import { resolvableInstance } from '../../../test/datascience/helpers';
use(chaiPromise);

/* eslint-disable  */

suite('Jupyter InterpreterSubCommandExecutionService', () => {
    let jupyterInterpreter: JupyterInterpreterService;
    let interpreterService: IInterpreterService;
    let jupyterDependencyService: JupyterInterpreterDependencyService;
    let execService: IPythonExecutionService;
    let jupyterInterpreterExecutionService: JupyterInterpreterSubCommandExecutionService;
    const selectedJupyterInterpreter = createPythonInterpreter();
    const activePythonInterpreter = createPythonInterpreter();
    let notebookStartResult: ObservableExecutionResult<string>;
    let environments: PythonExtension['environments'];
    let disposables: IDisposable[] = [];

    setup(() => {
        interpreterService = mock<IInterpreterService>();
        jupyterInterpreter = mock(JupyterInterpreterService);
        jupyterDependencyService = mock(JupyterInterpreterDependencyService);
        const execFactory = mock(PythonExecutionFactory);
        execService = mock<IPythonExecutionService>();
        when(execFactory.createActivatedEnvironment(anything())).thenResolve(instance(execService));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (instance(execService) as any).then = undefined;
        const output = new MockOutputChannel('');
        const out = createObservable<Output<string>>();
        disposables.push(out);
        notebookStartResult = {
            dispose: noop,
            proc: undefined,
            out
        };
        const jupyterPaths = mock<JupyterPaths>();
        when(jupyterPaths.getKernelSpecTempRegistrationFolder()).thenResolve(
            Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'temp', 'jupyter', 'kernels'))
        );
        const envActivationService = mock<IEnvironmentActivationService>();
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenResolve();
        jupyterInterpreterExecutionService = new JupyterInterpreterSubCommandExecutionService(
            instance(jupyterInterpreter),
            instance(interpreterService),
            instance(jupyterDependencyService),
            instance(execFactory),
            output,
            instance(jupyterPaths),
            instance(envActivationService)
        );

        when(execService.execModuleObservable('jupyter', anything(), anything())).thenResolve(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            notebookStartResult as any
        );
        when(interpreterService.getActiveInterpreter()).thenResolve(activePythonInterpreter);
        when(interpreterService.getActiveInterpreter(undefined)).thenResolve(activePythonInterpreter);

        const mockedApi = mock<PythonExtension>();
        sinon.stub(PythonExtension, 'api').resolves(resolvableInstance(mockedApi));
        disposables.push({ dispose: () => sinon.restore() });
        environments = mock<PythonExtension['environments']>();
        when(mockedApi.environments).thenReturn(instance(environments));
        when(environments.known).thenReturn([]);
        setPythonApi(instance(mockedApi));
        disposables.push({ dispose: () => setPythonApi(undefined as any) });
    });

    teardown(() => {
        disposables = dispose(disposables);
        sinon.restore();
    });
    // eslint-disable-next-line
    suite('Interpreter is not selected', () => {
        setup(() => {
            when(jupyterInterpreter.getSelectedInterpreter()).thenResolve(undefined);
            when(jupyterInterpreter.getSelectedInterpreter(anything())).thenResolve(undefined);
        });
        test('Returns selected interpreter', async () => {
            const interpreter = await jupyterInterpreterExecutionService.getSelectedInterpreter(undefined);
            assert.isUndefined(interpreter);
        });
        test('Notebook is not supported', async () => {
            const isSupported = await jupyterInterpreterExecutionService.isNotebookSupported(undefined);
            assert.isFalse(isSupported);
        });
        test('Jupyter cannot be started because no interpreter has been selected', async () => {
            when(interpreterService.getActiveInterpreter(undefined)).thenResolve(undefined);
            const reason = await jupyterInterpreterExecutionService.getReasonForJupyterNotebookNotBeingSupported(
                undefined
            );
            assert.equal(reason, DataScience.selectJupyterInterpreter);
        });
        test('Jupyter cannot be started because jupyter is not installed', async () => {
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
                'Sample (Python 9.8.7)',
                ProductNames.get(Product.jupyter)!
            );
            when(environments.known).thenReturn([
                {
                    id: activePythonInterpreter.id,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7'
                    },
                    environment: {
                        name: 'Sample',
                        folderUri: Uri.file('Some Path')
                    },
                    executable: {
                        uri: activePythonInterpreter.uri
                    },
                    tools: []
                } as any
            ]);
            when(jupyterDependencyService.getDependenciesNotInstalled(activePythonInterpreter, undefined)).thenResolve([
                Product.jupyter
            ]);
            const reason = await jupyterInterpreterExecutionService.getReasonForJupyterNotebookNotBeingSupported(
                undefined
            );
            assert.equal(reason, expectedReason);
        });
        test('Jupyter cannot be started because notebook is not installed', async () => {
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
                'Python 9.8.7',
                ProductNames.get(Product.notebook)!
            );
            when(environments.known).thenReturn([
                {
                    id: activePythonInterpreter.id,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7'
                    },
                    environment: {
                        name: '',
                        folderUri: Uri.file('')
                    },
                    tools: []
                } as any
            ]);

            when(jupyterDependencyService.getDependenciesNotInstalled(activePythonInterpreter, undefined)).thenResolve([
                Product.notebook
            ]);
            const reason = await jupyterInterpreterExecutionService.getReasonForJupyterNotebookNotBeingSupported(
                undefined
            );
            assert.equal(reason, expectedReason);
        });
        test('Cannot start notebook', async () => {
            const promise = jupyterInterpreterExecutionService.startNotebook([], {});
            when(jupyterDependencyService.getDependenciesNotInstalled(activePythonInterpreter, undefined)).thenResolve([
                Product.notebook
            ]);
            when(environments.known).thenReturn([
                {
                    id: activePythonInterpreter.id,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7'
                    },
                    environment: {
                        name: '',
                        folderUri: Uri.file('')
                    },
                    tools: []
                } as any
            ]);

            await expect(promise).to.eventually.be.rejectedWith(
                DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
                    'Python 9.8.7',
                    ProductNames.get(Product.notebook)!
                )
            );
        });
        test('Cannot get a list of running jupyter servers', async () => {
            const promise = jupyterInterpreterExecutionService.getRunningJupyterServers(undefined);
            when(jupyterDependencyService.getDependenciesNotInstalled(activePythonInterpreter, undefined)).thenResolve([
                Product.notebook
            ]);
            when(environments.known).thenReturn([
                {
                    id: activePythonInterpreter.id,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7'
                    },
                    environment: {
                        name: '',
                        folderUri: Uri.file('')
                    },
                    tools: []
                } as any
            ]);

            await expect(promise).to.eventually.be.rejectedWith(
                DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
                    'Python 9.8.7',
                    ProductNames.get(Product.notebook)!
                )
            );
        });
    });
    // eslint-disable-next-line
    suite('Interpreter is selected', () => {
        setup(() => {
            when(jupyterInterpreter.getSelectedInterpreter()).thenResolve(selectedJupyterInterpreter);
            when(jupyterInterpreter.getSelectedInterpreter(anything())).thenResolve(selectedJupyterInterpreter);
        });
        test('Returns selected interpreter', async () => {
            const interpreter = await jupyterInterpreterExecutionService.getSelectedInterpreter(undefined);

            assert.deepEqual(interpreter, selectedJupyterInterpreter);
        });
        test('If ds dependencies are not installed, then notebook is not supported', async () => {
            when(jupyterDependencyService.areDependenciesInstalled(selectedJupyterInterpreter, anything())).thenResolve(
                false
            );

            const isSupported = await jupyterInterpreterExecutionService.isNotebookSupported(undefined);

            assert.isFalse(isSupported);
        });
        test('If ds dependencies are installed, then notebook is supported', async () => {
            when(jupyterInterpreter.getSelectedInterpreter(anything())).thenResolve(selectedJupyterInterpreter);
            when(jupyterDependencyService.areDependenciesInstalled(selectedJupyterInterpreter, anything())).thenResolve(
                true
            );

            const isSupported = await jupyterInterpreterExecutionService.isNotebookSupported(undefined);

            assert.isOk(isSupported);
        });
        test('Jupyter cannot be started because jupyter is not installed', async () => {
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
                'Python 9.8.7',
                ProductNames.get(Product.jupyter)!
            );
            when(environments.known).thenReturn([
                {
                    id: activePythonInterpreter.id,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7'
                    },
                    environment: {
                        name: '',
                        folderUri: Uri.file('')
                    },
                    tools: []
                } as any
            ]);

            when(
                jupyterDependencyService.getDependenciesNotInstalled(selectedJupyterInterpreter, undefined)
            ).thenResolve([Product.jupyter]);

            const reason = await jupyterInterpreterExecutionService.getReasonForJupyterNotebookNotBeingSupported(
                undefined
            );

            assert.equal(reason, expectedReason);
        });
        test('Jupyter cannot be started because notebook is not installed', async () => {
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
                'Python 9.8.7',
                ProductNames.get(Product.notebook)!
            );
            when(environments.known).thenReturn([
                {
                    id: activePythonInterpreter.id,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7'
                    },
                    environment: {
                        name: '',
                        folderUri: Uri.file('')
                    },
                    tools: []
                } as any
            ]);

            when(
                jupyterDependencyService.getDependenciesNotInstalled(selectedJupyterInterpreter, undefined)
            ).thenResolve([Product.notebook]);

            const reason = await jupyterInterpreterExecutionService.getReasonForJupyterNotebookNotBeingSupported(
                undefined
            );

            assert.equal(reason, expectedReason);
        });
        test('Jupyter cannot be started because kernelspec is not available', async () => {
            when(
                jupyterDependencyService.getDependenciesNotInstalled(selectedJupyterInterpreter, undefined)
            ).thenResolve([Product.kernelspec]);

            const reason = await jupyterInterpreterExecutionService.getReasonForJupyterNotebookNotBeingSupported(
                undefined
            );

            assert.equal(reason, DataScience.jupyterKernelSpecModuleNotFound(selectedJupyterInterpreter.uri.fsPath));
        });
        test('Can start jupyer notebook', async () => {
            const output = await jupyterInterpreterExecutionService.startNotebook([], {});

            assert.isOk(output === notebookStartResult);
            const moduleName = capture(execService.execModuleObservable).first()[0];
            const args = capture(execService.execModuleObservable).first()[1];
            assert.equal(moduleName, 'jupyter');
            assert.equal(args[0], 'notebook');
        });
        test('Return list of running jupyter servers', async () => {
            const file = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'vscode_datascience_helpers', 'getServerInfo.py');
            const expectedServers: JupyterServerInfo[] = [
                {
                    base_url: '1',
                    hostname: '111',
                    notebook_dir: 'a',
                    password: true,
                    pid: 1,
                    port: 1243,
                    secure: false,
                    token: 'wow',
                    url: 'url'
                },
                {
                    base_url: '2',
                    hostname: '22',
                    notebook_dir: 'b',
                    password: false,
                    pid: 13,
                    port: 4444,
                    secure: true,
                    token: 'wow2',
                    url: 'url2'
                }
            ];
            when(execService.exec(deepEqual([file]), anything())).thenResolve({
                stdout: JSON.stringify(expectedServers)
            });

            const servers = await jupyterInterpreterExecutionService.getRunningJupyterServers(undefined);

            assert.deepEqual(servers, expectedServers);
        });
    });
});
