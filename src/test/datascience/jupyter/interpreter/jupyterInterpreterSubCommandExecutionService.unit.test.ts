// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert, expect, use } from 'chai';
import chaiPromise from 'chai-as-promised';
import * as path from '../../../../platform/vscode-path/path';
import * as fsExtra from 'fs-extra';
import * as sinon from 'sinon';
import { Subject } from 'rxjs/Subject';
import { anything, capture, deepEqual, instance, mock, when } from 'ts-mockito';
import { PythonExecutionFactory } from '../../../../platform/common/process/pythonExecutionFactory.node';
import {
    IPythonExecutionService,
    ObservableExecutionResult,
    Output
} from '../../../../platform/common/process/types.node';
import { DataScience } from '../../../../platform/common/utils/localize';
import { noop } from '../../../../platform/common/utils/misc';
import { EXTENSION_ROOT_DIR } from '../../../../platform/constants.node';
import { IInterpreterService } from '../../../../platform/interpreter/contracts';
import { MockOutputChannel } from '../../../mockClasses';
import { createPythonInterpreter } from '../../../utils/interpreters';
import { ProductNames } from '../../../../kernels/installer/productNames';
import { Product } from '../../../../kernels/installer/types';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../constants.node';
import { IEnvironmentActivationService } from '../../../../platform/interpreter/activation/types';
import { JupyterInterpreterDependencyService } from '../../../../kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node';
import { JupyterInterpreterService } from '../../../../kernels/jupyter/interpreter/jupyterInterpreterService.node';
import { JupyterInterpreterSubCommandExecutionService } from '../../../../kernels/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService.node';
import { JupyterPaths } from '../../../../kernels/raw/finder/jupyterPaths.node';
import { JupyterServerInfo } from '../../../../kernels/jupyter/types';
import { Uri } from 'vscode';
use(chaiPromise);

/* eslint-disable  */

suite('Jupyter InterpreterSubCommandExecutionService', () => {
    let jupyterInterpreter: JupyterInterpreterService;
    let interpreterService: IInterpreterService;
    let jupyterDependencyService: JupyterInterpreterDependencyService;
    let execService: IPythonExecutionService;
    let jupyterInterpreterExecutionService: JupyterInterpreterSubCommandExecutionService;
    const selectedJupyterInterpreter = createPythonInterpreter({ displayName: 'JupyterInterpreter' });
    const activePythonInterpreter = createPythonInterpreter({ displayName: 'activePythonInterpreter' });
    let notebookStartResult: ObservableExecutionResult<string>;
    setup(() => {
        interpreterService = mock<IInterpreterService>();
        jupyterInterpreter = mock(JupyterInterpreterService);
        jupyterDependencyService = mock(JupyterInterpreterDependencyService);
        const getRealPathStub = sinon.stub(fsExtra, 'realpath');
        getRealPathStub.returns(Promise.resolve('foo'));
        const execFactory = mock(PythonExecutionFactory);
        execService = mock<IPythonExecutionService>();
        when(execFactory.createActivatedEnvironment(anything())).thenResolve(instance(execService));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (instance(execService) as any).then = undefined;
        const output = new MockOutputChannel('');
        notebookStartResult = {
            dispose: noop,
            proc: undefined,
            out: new Subject<Output<string>>().asObservable()
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
            when(interpreterService.getActiveInterpreter(undefined)).thenResolve(undefined);
            const reason = await jupyterInterpreterExecutionService.getReasonForJupyterNotebookNotBeingSupported(
                undefined
            );
            assert.equal(reason, DataScience.selectJupyterInterpreter);
        });
        test('Jupyter cannot be started because jupyter is not installed', async () => {
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
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
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
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
                DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
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
                DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
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
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
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
            const expectedReason = DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(
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
