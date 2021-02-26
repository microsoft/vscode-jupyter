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
import { IPythonExecutionService } from '../../../../client/common/process/types';
import { ReadWrite } from '../../../../client/common/types';
import { JupyterKernelSpec } from '../../../../client/datascience/jupyter/kernels/jupyterKernelSpec';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { JupyterKernelService } from '../../../../client/datascience/jupyter/kernels/jupyterKernelService';
import { KernelConnectionMetadata, KernelSpecConnectionMetadata } from '../../../../client/datascience/jupyter/kernels/types';
import { LocalKernelFinder } from '../../../../client/datascience/kernel-launcher/localKernelFinder';
import { ILocalKernelFinder } from '../../../../client/datascience/kernel-launcher/types';
import { IEnvironmentActivationService } from '../../../../client/interpreter/activation/types';
import { PythonEnvironment } from '../../../../client/pythonEnvironments/info';
import { FakeClock } from '../../../common';
import { IJupyterKernelSpec } from '../../../../client/datascience/types';

// eslint-disable-next-line
suite('DataScience - KernelService', () => {
    let kernelService: JupyterKernelService;
    let fs: IFileSystem;
    let execService: IPythonExecutionService;
    let activationHelper: IEnvironmentActivationService;
    let dependencyService: KernelDependencyService;
    let kernelFinder: ILocalKernelFinder;

    function initialize() {
        fs = mock(FileSystem);
        activationHelper = mock<IEnvironmentActivationService>();
        execService = mock<IPythonExecutionService>();
        dependencyService = mock(KernelDependencyService);
        kernelFinder = mock(LocalKernelFinder);
        const extensionChecker = mock<IPythonExtensionChecker>();
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

        kernelService = new JupyterKernelService(
            instance(dependencyService),
            instance(fs),
            instance(activationHelper),
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
        // Marked as readonly, to ensure we do not update this in tests.
        const kernelSpecModel: Readonly<IJupyterKernelSpec> = {
            argv: ['python', '-m', 'ipykernel'],
            display_name: interpreter.displayName!,
            language: PYTHON_LANGUAGE,
            name: 'somme name',
            env: {},
            metadata: {
                something: '1',
                interpreter: {
                    path: interpreter.path
                }
            },
            path: kernelJsonFile
        };
        const kernelMetadata: KernelConnectionMetadata = {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: { ...kernelSpecModel, path: kernelJsonFile },
            interpreter
        }

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
            const invalidKernelMetadata: KernelConnectionMetadata = {
                kind: 'startUsingPythonInterpreter',
                kernelSpec: { ...kernelSpecModel, path: kernelJsonFile },
                interpreter: invalidInterpreter
            }
    
            const promise = kernelService.ensureKernelIsUsable(invalidKernelMetadata);

            await assert.isRejected(promise, 'Interpreter does not have a display name');
        });
        test('Fail if installed kernel cannot be found', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            fakeTimer.install();
            const promise = kernelService.ensureKernelIsUsable(kernelMetadata);

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
            when(dependencyService.installMissingDependencies(anything(), anything())).thenResolve();
            fakeTimer.install();

            const promise = kernelService.ensureKernelIsUsable(kernelMetadata);

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
            when(dependencyService.installMissingDependencies(anything(), anything())).thenResolve();

            const kernel = await kernelService.ensureKernelIsUsable(kernelMetadata);

            assert.isUndefined(kernel);
            verify(execService.execModule('ipykernel', anything(), anything())).never();
            verify(dependencyService.installMissingDependencies(anything(), anything())).once();
        });
        test('Fail if installed kernel is not an instance of JupyterKernelSpec', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            when(kernelFinder.findKernel(anything(), anything(), anything())).thenResolve({} as any);

            const promise = kernelService.ensureKernelIsUsable(kernelMetadata);

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
            const kernelSpecMetadata: KernelSpecConnectionMetadata = {
                kind: 'startUsingKernelSpec',
                kernelSpec: kernel
            };
            when(kernelFinder.findKernel(anything(), anything(), anything())).thenResolve(kernelSpecMetadata);
            const promise = kernelService.ensureKernelIsUsable(kernelMetadata);

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
            when(kernelFinder.findKernel(anything(), anything(), anything())).thenResolve(kernelMetadata);
            when(fs.readLocalFile(kernelJsonFile)).thenResolve(JSON.stringify(kernelSpecModel));
            when(fs.writeLocalFile(kernelJsonFile, anything())).thenResolve();
            when(activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)).thenResolve(
                undefined
            );
            const expectedKernelJsonContent = cloneDeep(kernelSpecModel);
            // Fully qualified path must be injected into `argv`.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (expectedKernelJsonContent as any).argv = [interpreter.path, '-m', 'ipykernel'];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expectedKernelJsonContent.metadata!.interpreter = interpreter as any;

            await kernelService.ensureKernelIsUsable(kernelMetadata);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            verify(fs.writeLocalFile(kernelJsonFile, anything())).once();
            // Verify the contents of JSON written to the file match as expected.
            assert.deepEqual(JSON.parse(capture(fs.writeLocalFile).first()[1] as string), expectedKernelJsonContent);
        });
        test('Kernel is installed and spec file is updated with interpreter information in metadata along with environment variables', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            when(kernelFinder.findKernel(anything(), anything(), anything())).thenResolve(kernelMetadata);
            when(fs.readLocalFile(kernelJsonFile)).thenResolve(JSON.stringify(kernelSpecModel));
            when(fs.writeLocalFile(kernelJsonFile, anything())).thenResolve();
            const envVariables = { MYVAR: '1' };
            when(activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)).thenResolve(
                envVariables
            );
            const expectedKernelJsonContent = cloneDeep(kernelSpecModel);
            // Fully qualified path must be injected into `argv`.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (expectedKernelJsonContent as any).argv = [interpreter.path, '-m', 'ipykernel'];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expectedKernelJsonContent.metadata!.interpreter = interpreter as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (expectedKernelJsonContent as any).env = envVariables as any;

            await kernelService.ensureKernelIsUsable(kernelMetadata);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            verify(fs.writeLocalFile(kernelJsonFile, anything())).once();
            // Verify the contents of JSON written to the file match as expected.
            assert.deepEqual(JSON.parse(capture(fs.writeLocalFile).first()[1] as string), expectedKernelJsonContent);
        });
        test('Kernel is found and spec file is updated with interpreter information in metadata along with environment variables', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            when(kernelFinder.findKernel(anything(), anything(), anything())).thenResolve(kernelMetadata);
            when(fs.readLocalFile(kernelJsonFile)).thenResolve(JSON.stringify(kernelSpecModel));
            when(fs.writeLocalFile(kernelJsonFile, anything())).thenResolve();
            const envVariables = { MYVAR: '1' };
            when(activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)).thenResolve(
                envVariables
            );
            const expectedKernelJsonContent: ReadWrite<IJupyterKernelSpec> = cloneDeep(kernelSpecModel);
            // Fully qualified path must be injected into `argv`.
            expectedKernelJsonContent.argv = [interpreter.path, '-m', 'ipykernel'];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expectedKernelJsonContent.metadata!.interpreter = interpreter as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expectedKernelJsonContent.env = envVariables as any;

            await kernelService.ensureKernelIsUsable(kernelMetadata, undefined, true);

            verify(fs.writeLocalFile(kernelJsonFile, anything())).once();
            // Verify the contents of JSON written to the file match as expected.
            assert.deepEqual(JSON.parse(capture(fs.writeLocalFile).first()[1] as string), expectedKernelJsonContent);
        });
        test('Kernel is found and spec file is not updated with interpreter information when user spec file', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            const kernel = new JupyterKernelSpec(userKernelSpecModel, kernelJsonFile);
            const kernelSpecMetadata: KernelSpecConnectionMetadata = {
                kind: 'startUsingKernelSpec',
                kernelSpec: kernel
            };
            when(kernelFinder.findKernel(anything(), anything(), anything())).thenResolve(kernelSpecMetadata);
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
            await kernelService.ensureKernelIsUsable(kernelSpecMetadata, undefined, true);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assert.ok(contents, 'Env not updated');
            const obj = JSON.parse(contents!);
            assert.notOk(obj.metadata.interpreter, 'MetaData should not have been written');
        });
    });
});
