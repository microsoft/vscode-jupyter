// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Kernel } from '@jupyterlab/services';
import { assert } from 'chai';
import { cloneDeep } from 'lodash';
import * as path from 'path';
import * as sinon from 'sinon';
import { anything, capture, instance, mock, verify, when } from 'ts-mockito';
import { IPythonExtensionChecker } from '../../../../client/api/types';
import { PYTHON_LANGUAGE } from '../../../../client/common/constants';
import { FileSystem } from '../../../../client/common/platform/fileSystem';
import { IFileSystem } from '../../../../client/common/platform/types';
import { PythonExecutionFactory } from '../../../../client/common/process/pythonExecutionFactory';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../../../client/common/process/types';
import { ReadWrite } from '../../../../client/common/types';
import { JupyterKernelSpec } from '../../../../client/datascience/jupyter/kernels/jupyterKernelSpec';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { KernelService } from '../../../../client/datascience/jupyter/kernels/kernelService';
import { KernelFinder } from '../../../../client/datascience/kernel-launcher/kernelFinder';
import { IKernelFinder } from '../../../../client/datascience/kernel-launcher/types';
import {
    IJupyterSubCommandExecutionService,
    KernelInterpreterDependencyResponse
} from '../../../../client/datascience/types';
import { IEnvironmentActivationService } from '../../../../client/interpreter/activation/types';
import { IInterpreterService } from '../../../../client/interpreter/contracts';
import { PythonEnvironment } from '../../../../client/pythonEnvironments/info';
import { FakeClock } from '../../../common';

// eslint-disable-next-line
suite('DataScience - KernelService', () => {
    let kernelService: KernelService;
    let interperterService: IInterpreterService;
    let fs: IFileSystem;
    let execFactory: IPythonExecutionFactory;
    let execService: IPythonExecutionService;
    let activationHelper: IEnvironmentActivationService;
    let dependencyService: KernelDependencyService;
    let jupyterInterpreterExecutionService: IJupyterSubCommandExecutionService;
    let kernelFinder: IKernelFinder;

    function initialize() {
        interperterService = mock<IInterpreterService>();
        fs = mock(FileSystem);
        activationHelper = mock<IEnvironmentActivationService>();
        execFactory = mock(PythonExecutionFactory);
        execService = mock<IPythonExecutionService>();
        dependencyService = mock(KernelDependencyService);
        kernelFinder = mock(KernelFinder);
        const extensionChecker = mock<IPythonExtensionChecker>();
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        jupyterInterpreterExecutionService = mock<IJupyterSubCommandExecutionService>();
        when(execFactory.createActivatedEnvironment(anything())).thenResolve(instance(execService));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (instance(execService) as any).then = undefined;

        kernelService = new KernelService(
            instance(jupyterInterpreterExecutionService),
            instance(execFactory),
            instance(interperterService),
            instance(dependencyService),
            instance(fs),
            instance(activationHelper),
            instance(extensionChecker),
            instance(kernelFinder)
        );
    }
    setup(initialize);
    teardown(() => sinon.restore());

    // eslint-disable-next-line
    suite('Registering Interpreters as Kernels', () => {
        let fakeTimer: FakeClock;
        const interpreter: PythonEnvironment = {
            path: path.join('interpreter', 'python'),
            sysPrefix: '',
            sysVersion: '',
            displayName: 'Hello'
        };
        // Marked as readonly, to ensure we do not update this in tests.
        const kernelSpecModel: Readonly<Kernel.ISpecModel> = {
            argv: ['python', '-m', 'ipykernel'],
            display_name: interpreter.displayName!,
            language: PYTHON_LANGUAGE,
            name: 'somme name',
            resources: {},
            env: {},
            metadata: {
                something: '1',
                interpreter: {
                    path: interpreter.path
                }
            }
        };
        const userKernelSpecModel: Readonly<Kernel.ISpecModel> = {
            argv: ['python', '-m', 'ipykernel'],
            display_name: interpreter.displayName!,
            language: PYTHON_LANGUAGE,
            name: 'somme name',
            resources: {},
            env: {},
            metadata: {
                something: '1'
            }
        };
        const kernelJsonFile = path.join('someFile', 'kernel.json');

        setup(() => {
            fakeTimer = new FakeClock();
            initialize();
        });

        teardown(() => fakeTimer.uninstall());

        test('Fail if interpreter does not have a display name', async () => {
            const invalidInterpreter: PythonEnvironment = {
                path: '',
                sysPrefix: '',
                sysVersion: ''
            };

            const promise = kernelService.registerKernel(undefined, invalidInterpreter);

            await assert.isRejected(promise, 'Interpreter does not have a display name');
        });
        test('Fail if installed kernel cannot be found', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            fakeTimer.install();
            const promise = kernelService.registerKernel(undefined, interpreter);

            await fakeTimer.wait();
            await assert.isRejected(promise);
            verify(execService.execModule('ipykernel', anything(), anything())).once();
            const installArgs = capture(execService.execModule).first()[1] as string[];
            const kernelName = installArgs[3];
            assert.deepEqual(installArgs, [
                'install',
                '--user',
                '--name',
                kernelName,
                '--display-name',
                interpreter.displayName
            ]);
            await assert.isRejected(
                promise,
                `Kernel not created with the name ${kernelName}, display_name ${interpreter.displayName}. Output is `
            );
        });
        test('If ipykernel is not installed, then prompt to install ipykernel', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(false);
            when(dependencyService.installMissingDependencies(anything(), anything())).thenResolve(
                KernelInterpreterDependencyResponse.ok
            );
            fakeTimer.install();

            const promise = kernelService.registerKernel(undefined, interpreter);

            await fakeTimer.wait();
            await assert.isRejected(promise);
            verify(execService.execModule('ipykernel', anything(), anything())).once();
            const installArgs = capture(execService.execModule).first()[1] as string[];
            const kernelName = installArgs[3];
            assert.deepEqual(installArgs, [
                'install',
                '--user',
                '--name',
                kernelName,
                '--display-name',
                interpreter.displayName
            ]);
            await assert.isRejected(
                promise,
                `Kernel not created with the name ${kernelName}, display_name ${interpreter.displayName}. Output is `
            );
            verify(dependencyService.installMissingDependencies(anything(), anything())).once();
        });
        test('If ipykernel is not installed, and ipykerne installation is canclled, then do not reigster kernel', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(false);
            when(dependencyService.installMissingDependencies(anything(), anything())).thenResolve(
                KernelInterpreterDependencyResponse.cancel
            );

            const kernel = await kernelService.registerKernel(undefined, interpreter);

            assert.isUndefined(kernel);
            verify(execService.execModule('ipykernel', anything(), anything())).never();
            verify(dependencyService.installMissingDependencies(anything(), anything())).once();
        });
        test('Fail if installed kernel is not an instance of JupyterKernelSpec', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            when(kernelFinder.findKernelSpec(anything(), anything(), anything())).thenResolve({} as any);

            const promise = kernelService.registerKernel(undefined, interpreter);

            await assert.isRejected(promise);
            verify(execService.execModule('ipykernel', anything(), anything())).once();
            const installArgs = capture(execService.execModule).first()[1] as string[];
            const kernelName = installArgs[3];
            await assert.isRejected(
                promise,
                `Kernel not registered locally, created with the name ${kernelName}, display_name ${interpreter.displayName}. Output is `
            );
        });
        test('Fail if installed kernel spec does not have a specFile setup', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const kernel = new JupyterKernelSpec({} as any);
            when(kernelFinder.findKernelSpec(anything(), anything(), anything())).thenResolve(kernel);
            const promise = kernelService.registerKernel(undefined, interpreter);

            await assert.isRejected(promise);
            verify(execService.execModule('ipykernel', anything(), anything())).once();
            const installArgs = capture(execService.execModule).first()[1] as string[];
            const kernelName = installArgs[3];
            await assert.isRejected(
                promise,
                `kernel.json not created with the name ${kernelName}, display_name ${interpreter.displayName}. Output is `
            );
        });
        test('Kernel is installed and spec file is updated with interpreter information in metadata and interpreter path in argv', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            const kernel = new JupyterKernelSpec(kernelSpecModel, kernelJsonFile);
            when(kernelFinder.findKernelSpec(anything(), anything(), anything())).thenResolve(kernel);
            when(fs.readLocalFile(kernelJsonFile)).thenResolve(JSON.stringify(kernelSpecModel));
            when(fs.writeLocalFile(kernelJsonFile, anything())).thenResolve();
            when(activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)).thenResolve(
                undefined
            );
            const expectedKernelJsonContent: ReadWrite<Kernel.ISpecModel> = cloneDeep(kernelSpecModel);
            // Fully qualified path must be injected into `argv`.
            expectedKernelJsonContent.argv = [interpreter.path, '-m', 'ipykernel'];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expectedKernelJsonContent.metadata!.interpreter = interpreter as any;

            const installedKernel = await kernelService.registerKernel(undefined, interpreter);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.deepEqual(kernel, installedKernel as any);
            verify(fs.writeLocalFile(kernelJsonFile, anything())).once();
            // Verify the contents of JSON written to the file match as expected.
            assert.deepEqual(JSON.parse(capture(fs.writeLocalFile).first()[1] as string), expectedKernelJsonContent);
        });
        test('Kernel is installed and spec file is updated with interpreter information in metadata along with environment variables', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            const kernel = new JupyterKernelSpec(kernelSpecModel, kernelJsonFile);
            when(kernelFinder.findKernelSpec(anything(), anything(), anything())).thenResolve(kernel);
            when(fs.readLocalFile(kernelJsonFile)).thenResolve(JSON.stringify(kernelSpecModel));
            when(fs.writeLocalFile(kernelJsonFile, anything())).thenResolve();
            const envVariables = { MYVAR: '1' };
            when(activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)).thenResolve(
                envVariables
            );
            const expectedKernelJsonContent: ReadWrite<Kernel.ISpecModel> = cloneDeep(kernelSpecModel);
            // Fully qualified path must be injected into `argv`.
            expectedKernelJsonContent.argv = [interpreter.path, '-m', 'ipykernel'];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expectedKernelJsonContent.metadata!.interpreter = interpreter as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expectedKernelJsonContent.env = envVariables as any;

            const installedKernel = await kernelService.registerKernel(undefined, interpreter);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.deepEqual(kernel, installedKernel as any);
            verify(fs.writeLocalFile(kernelJsonFile, anything())).once();
            // Verify the contents of JSON written to the file match as expected.
            assert.deepEqual(JSON.parse(capture(fs.writeLocalFile).first()[1] as string), expectedKernelJsonContent);
        });
        test('Kernel is found and spec file is updated with interpreter information in metadata along with environment variables', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            const kernel = new JupyterKernelSpec(kernelSpecModel, kernelJsonFile);
            when(kernelFinder.findKernelSpec(anything(), anything(), anything())).thenResolve(kernel);
            when(fs.readLocalFile(kernelJsonFile)).thenResolve(JSON.stringify(kernelSpecModel));
            when(fs.writeLocalFile(kernelJsonFile, anything())).thenResolve();
            const envVariables = { MYVAR: '1' };
            when(activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)).thenResolve(
                envVariables
            );
            const expectedKernelJsonContent: ReadWrite<Kernel.ISpecModel> = cloneDeep(kernelSpecModel);
            // Fully qualified path must be injected into `argv`.
            expectedKernelJsonContent.argv = [interpreter.path, '-m', 'ipykernel'];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expectedKernelJsonContent.metadata!.interpreter = interpreter as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expectedKernelJsonContent.env = envVariables as any;

            const installedKernel = await kernelService.searchAndRegisterKernel(undefined, interpreter, true);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.deepEqual(kernel, installedKernel as any);
            verify(fs.writeLocalFile(kernelJsonFile, anything())).once();
            // Verify the contents of JSON written to the file match as expected.
            assert.deepEqual(JSON.parse(capture(fs.writeLocalFile).first()[1] as string), expectedKernelJsonContent);
        });
        test('Kernel is found and spec file is not updated with interpreter information when user spec file', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            const kernel = new JupyterKernelSpec(userKernelSpecModel, kernelJsonFile);
            when(kernelFinder.findKernelSpec(anything(), anything(), anything())).thenResolve(kernel);
            when(fs.readLocalFile(kernelJsonFile)).thenResolve(JSON.stringify(userKernelSpecModel));
            let contents: string | undefined;
            when(fs.writeLocalFile(kernelJsonFile, anything())).thenCall((_f, c) => {
                contents = c;
                return Promise.resolve();
            });
            const envVariables = { MYVAR: '1' };
            when(activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)).thenResolve(
                envVariables
            );
            const installedKernel = await kernelService.searchAndRegisterKernel(undefined, interpreter, true);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.deepEqual(kernel, installedKernel as any);
            assert.ok(contents, 'Env not updated');
            const obj = JSON.parse(contents!);
            assert.notOk(obj.metadata.interpreter, 'MetaData should not have been written');
        });
    });
});
