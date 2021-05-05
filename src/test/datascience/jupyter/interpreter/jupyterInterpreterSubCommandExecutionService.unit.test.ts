// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert, expect, use } from 'chai';
import * as chaiPromise from 'chai-as-promised';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import * as sinon from 'sinon';
import { Subject } from 'rxjs/Subject';
import { anything, capture, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { ProductNames } from '../../../../client/common/installer/productNames';
import { PathUtils } from '../../../../client/common/platform/pathUtils';
import { PythonExecutionFactory } from '../../../../client/common/process/pythonExecutionFactory';
import {
    IPythonDaemonExecutionService,
    ObservableExecutionResult,
    Output
} from '../../../../client/common/process/types';
import { Product } from '../../../../client/common/types';
import { DataScience } from '../../../../client/common/utils/localize';
import { noop } from '../../../../client/common/utils/misc';
import { EXTENSION_ROOT_DIR } from '../../../../client/constants';
import { JupyterDaemonModule } from '../../../../client/datascience/constants';
import { JupyterInterpreterDependencyService } from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService';
import { JupyterInterpreterService } from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterService';
import { JupyterInterpreterSubCommandExecutionService } from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService';
import { JupyterServerInfo } from '../../../../client/datascience/jupyter/jupyterConnection';
import { IInterpreterService } from '../../../../client/interpreter/contracts';
import { MockOutputChannel } from '../../../mockClasses';
import { createPythonInterpreter } from '../../../utils/interpreters';
use(chaiPromise);

/* eslint-disable  */

suite('DataScience - Jupyter InterpreterSubCommandExecutionService', () => {
    let jupyterInterpreter: JupyterInterpreterService;
    let interperterService: IInterpreterService;
    let jupyterDependencyService: JupyterInterpreterDependencyService;
    let execService: IPythonDaemonExecutionService;
    let jupyterInterpreterExecutionService: JupyterInterpreterSubCommandExecutionService;
    const selectedJupyterInterpreter = createPythonInterpreter({ displayName: 'JupyterInterpreter' });
    const activePythonInterpreter = createPythonInterpreter({ displayName: 'activePythonInterpreter' });
    let notebookStartResult: ObservableExecutionResult<string>;
    setup(() => {
        interperterService = mock<IInterpreterService>();
        jupyterInterpreter = mock(JupyterInterpreterService);
        jupyterDependencyService = mock(JupyterInterpreterDependencyService);
        const getRealPathStub = sinon.stub(fsExtra, 'realpath');
        getRealPathStub.returns(Promise.resolve('foo'));
        const execFactory = mock(PythonExecutionFactory);
        execService = mock<IPythonDaemonExecutionService>();
        when(
            execFactory.createDaemon(
                deepEqual({ daemonModule: JupyterDaemonModule, pythonPath: selectedJupyterInterpreter.path })
            )
        ).thenResolve(instance(execService));
        when(execFactory.createActivatedEnvironment(anything())).thenResolve(instance(execService));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (instance(execService) as any).then = undefined;
        const output = new MockOutputChannel('');
        const pathUtils = mock(PathUtils);
        notebookStartResult = {
            dispose: noop,
            proc: undefined,
            out: new Subject<Output<string>>().asObservable()
        };
        jupyterInterpreterExecutionService = new JupyterInterpreterSubCommandExecutionService(
            instance(jupyterInterpreter),
            instance(interperterService),
            instance(jupyterDependencyService),
            instance(execFactory),
            output,
            instance(pathUtils)
        );

        when(execService.execModuleObservable('jupyter', anything(), anything())).thenResolve(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            notebookStartResult as any
        );
        when(interperterService.getActiveInterpreter()).thenResolve(activePythonInterpreter);
        when(interperterService.getActiveInterpreter(undefined)).thenResolve(activePythonInterpreter);
    });
    teardown(() => {
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
            when(interperterService.getActiveInterpreter(undefined)).thenResolve(undefined);
            const reason = await jupyterInterpreterExecutionService.getReasonForJupyterNotebookNotBeingSupported(
                undefined
            );
            assert.equal(reason, DataScience.selectJupyterInterpreter());
        });
        test('Jupyter cannot be started because jupyter is not installed', async () => {
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter().format(
                activePythonInterpreter.displayName!,
                ProductNames.get(Product.jupyter)!
            );
            when(jupyterDependencyService.getDependenciesNotInstalled(activePythonInterpreter, undefined)).thenResolve([
                Product.jupyter
            ]);
            const reason = await jupyterInterpreterExecutionService.getReasonForJupyterNotebookNotBeingSupported(
                undefined
            );
            assert.equal(reason, expectedReason);
        });
        test('Jupyter cannot be started because notebook is not installed', async () => {
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter().format(
                activePythonInterpreter.displayName!,
                ProductNames.get(Product.notebook)!
            );
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

            await expect(promise).to.eventually.be.rejectedWith(
                DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter().format(
                    activePythonInterpreter.displayName!,
                    ProductNames.get(Product.notebook)!
                )
            );
        });
        test('Cannot launch notebook file in jupyter notebook', async () => {
            const promise = jupyterInterpreterExecutionService.openNotebook('some.ipynb');
            when(jupyterDependencyService.getDependenciesNotInstalled(activePythonInterpreter, undefined)).thenResolve([
                Product.notebook
            ]);

            await expect(promise).to.eventually.be.rejectedWith(
                DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter().format(
                    activePythonInterpreter.displayName!,
                    ProductNames.get(Product.notebook)!
                )
            );
        });
        test('Cannot get a list of running jupyter servers', async () => {
            const promise = jupyterInterpreterExecutionService.getRunningJupyterServers(undefined);
            when(jupyterDependencyService.getDependenciesNotInstalled(activePythonInterpreter, undefined)).thenResolve([
                Product.notebook
            ]);

            await expect(promise).to.eventually.be.rejectedWith(
                DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter().format(
                    activePythonInterpreter.displayName!,
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
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter().format(
                selectedJupyterInterpreter.displayName!,
                ProductNames.get(Product.jupyter)!
            );
            when(
                jupyterDependencyService.getDependenciesNotInstalled(selectedJupyterInterpreter, undefined)
            ).thenResolve([Product.jupyter]);

            const reason = await jupyterInterpreterExecutionService.getReasonForJupyterNotebookNotBeingSupported(
                undefined
            );

            assert.equal(reason, expectedReason);
        });
        test('Jupyter cannot be started because notebook is not installed', async () => {
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter().format(
                selectedJupyterInterpreter.displayName!,
                ProductNames.get(Product.notebook)!
            );
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

            assert.equal(reason, DataScience.jupyterKernelSpecModuleNotFound().format(selectedJupyterInterpreter.path));
        });
        test('Can start jupyer notebook', async () => {
            const output = await jupyterInterpreterExecutionService.startNotebook([], {});

            assert.isOk(output === notebookStartResult);
            const moduleName = capture(execService.execModuleObservable).first()[0];
            const args = capture(execService.execModuleObservable).first()[1];
            assert.equal(moduleName, 'jupyter');
            assert.equal(args[0], 'notebook');
        });
        test('Can launch notebook file in jupyter notebook', async () => {
            const file = 'somefile.ipynb';
            when(execService.execModule('jupyter', anything(), anything())).thenResolve();

            await jupyterInterpreterExecutionService.openNotebook(file);

            verify(
                execService.execModule(
                    'jupyter',
                    deepEqual(['notebook', `--NotebookApp.file_to_run=${file}`]),
                    anything()
                )
            ).once();
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
