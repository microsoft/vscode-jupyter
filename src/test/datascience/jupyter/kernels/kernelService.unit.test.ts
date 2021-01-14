// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Kernel } from '@jupyterlab/services';
import { assert } from 'chai';
import { cloneDeep } from 'lodash';
import * as path from 'path';
import * as sinon from 'sinon';
import { anything, capture, instance, mock, verify, when } from 'ts-mockito';
import { CancellationToken } from 'vscode';
import { IPythonExtensionChecker } from '../../../../client/api/types';
import { PYTHON_LANGUAGE } from '../../../../client/common/constants';
import { FileSystem } from '../../../../client/common/platform/fileSystem';
import { IFileSystem } from '../../../../client/common/platform/types';
import { PythonExecutionFactory } from '../../../../client/common/process/pythonExecutionFactory';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../../../client/common/process/types';
import { ReadWrite } from '../../../../client/common/types';
import { JupyterSessionManager } from '../../../../client/datascience/jupyter/jupyterSessionManager';
import { JupyterKernelSpec } from '../../../../client/datascience/jupyter/kernels/jupyterKernelSpec';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { KernelService } from '../../../../client/datascience/jupyter/kernels/kernelService';
import {
    IJupyterKernelSpec,
    IJupyterSessionManager,
    IJupyterSubCommandExecutionService,
    KernelInterpreterDependencyResponse
} from '../../../../client/datascience/types';
import { IEnvironmentActivationService } from '../../../../client/interpreter/activation/types';
import { IInterpreterService } from '../../../../client/interpreter/contracts';
import { PythonEnvironment } from '../../../../client/pythonEnvironments/info';
import { FakeClock } from '../../../common';

// tslint:disable-next-line: max-func-body-length
suite('DataScience - KernelService', () => {
    let kernelService: KernelService;
    let interperterService: IInterpreterService;
    let fs: IFileSystem;
    let sessionManager: IJupyterSessionManager;
    let execFactory: IPythonExecutionFactory;
    let execService: IPythonExecutionService;
    let activationHelper: IEnvironmentActivationService;
    let dependencyService: KernelDependencyService;
    let jupyterInterpreterExecutionService: IJupyterSubCommandExecutionService;

    function initialize() {
        interperterService = mock<IInterpreterService>();
        fs = mock(FileSystem);
        sessionManager = mock(JupyterSessionManager);
        activationHelper = mock<IEnvironmentActivationService>();
        execFactory = mock(PythonExecutionFactory);
        execService = mock<IPythonExecutionService>();
        dependencyService = mock(KernelDependencyService);
        const extensionChecker = mock<IPythonExtensionChecker>();
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        jupyterInterpreterExecutionService = mock<IJupyterSubCommandExecutionService>();
        when(execFactory.createActivatedEnvironment(anything())).thenResolve(instance(execService));
        // tslint:disable-next-line: no-any
        (instance(execService) as any).then = undefined;

        kernelService = new KernelService(
            instance(jupyterInterpreterExecutionService),
            instance(execFactory),
            instance(interperterService),
            instance(dependencyService),
            instance(fs),
            instance(activationHelper),
            instance(extensionChecker)
        );
    }
    setup(initialize);
    teardown(() => sinon.restore());

    test('Should not return a matching spec from a session for a given kernelspec', async () => {
        const activeKernelSpecs: IJupyterKernelSpec[] = [
            {
                argv: [],
                language: PYTHON_LANGUAGE,
                name: '1',
                path: '',
                display_name: '1',
                metadata: {},
                env: undefined
            },
            {
                argv: [],
                language: PYTHON_LANGUAGE,
                name: '2',
                path: '',
                display_name: '2',
                metadata: {},
                env: undefined
            }
        ];
        when(sessionManager.getKernelSpecs()).thenResolve(activeKernelSpecs);

        const matchingKernel = await kernelService.findMatchingKernelSpec(
            { name: 'A', display_name: 'A' },
            instance(sessionManager)
        );

        assert.isUndefined(matchingKernel);
        verify(sessionManager.getKernelSpecs()).once();
    });
    test('Should not return a matching spec from a session for a given interpeter', async () => {
        const activeKernelSpecs: IJupyterKernelSpec[] = [
            {
                argv: [],
                language: PYTHON_LANGUAGE,
                name: '1',
                path: '',
                display_name: '1',
                metadata: {},
                env: undefined
            },
            {
                argv: [],
                language: PYTHON_LANGUAGE,
                name: '2',
                path: '',
                display_name: '2',
                metadata: {},
                env: undefined
            }
        ];
        when(sessionManager.getKernelSpecs()).thenResolve(activeKernelSpecs);
        const interpreter: PythonEnvironment = {
            path: 'some Path',
            displayName: 'Hello World',
            envName: 'Hello'
            // tslint:disable-next-line: no-any
        } as any;

        const matchingKernel = await kernelService.findMatchingKernelSpec(interpreter, instance(sessionManager));

        assert.isUndefined(matchingKernel);
        verify(sessionManager.getKernelSpecs()).once();
    });
    test('Should not return a matching spec from a jupyter process for a given kernelspec', async () => {
        when(jupyterInterpreterExecutionService.getKernelSpecs(anything())).thenResolve([]);

        const matchingKernel = await kernelService.findMatchingKernelSpec({ name: 'A', display_name: 'A' }, undefined);

        assert.isUndefined(matchingKernel);
    });
    test('Should not return a matching spec from a jupyter process for a given interpreter', async () => {
        when(jupyterInterpreterExecutionService.getKernelSpecs(anything())).thenResolve([]);

        const interpreter: PythonEnvironment = {
            path: 'some Path',
            displayName: 'Hello World',
            envName: 'Hello'
            // tslint:disable-next-line: no-any
        } as any;

        const matchingKernel = await kernelService.findMatchingKernelSpec(interpreter, undefined);

        assert.isUndefined(matchingKernel);
    });
    test('Should return a matching spec from a session for a given kernelspec', async () => {
        const activeKernelSpecs: IJupyterKernelSpec[] = [
            {
                argv: [],
                language: PYTHON_LANGUAGE,
                name: '1',
                path: 'Path1',
                display_name: 'Disp1',
                metadata: {},
                env: undefined
            },
            {
                argv: [],
                language: PYTHON_LANGUAGE,
                name: '2',
                path: 'Path2',
                display_name: 'Disp2',
                metadata: {},
                env: undefined
            }
        ];
        when(sessionManager.getKernelSpecs()).thenResolve(activeKernelSpecs);

        const matchingKernel = await kernelService.findMatchingKernelSpec(
            { name: '2', display_name: 'Disp2' },
            instance(sessionManager)
        );

        assert.isOk(matchingKernel);
        assert.equal(matchingKernel?.display_name, 'Disp2');
        assert.equal(matchingKernel?.name, '2');
        assert.equal(matchingKernel?.path, 'Path2');
        assert.equal(matchingKernel?.language, PYTHON_LANGUAGE);
        verify(sessionManager.getKernelSpecs()).once();
    });
    test('Should return a matching spec from a session for a given interpreter', async () => {
        const activeKernelSpecs: IJupyterKernelSpec[] = [
            {
                argv: [],
                language: PYTHON_LANGUAGE,
                name: '1',
                path: 'Path1',
                display_name: 'Disp1',
                metadata: {},
                env: undefined
            },
            {
                argv: [],
                language: PYTHON_LANGUAGE,
                name: '2',
                path: 'Path2',
                display_name: 'Disp2',
                metadata: { interpreter: { path: 'myPath2' } },
                env: undefined
            },
            {
                argv: [],
                language: PYTHON_LANGUAGE,
                name: '3',
                path: 'Path3',
                display_name: 'Disp3',
                metadata: { interpreter: { path: 'myPath3' } },
                env: undefined
            }
        ];
        when(sessionManager.getKernelSpecs()).thenResolve(activeKernelSpecs);
        when(fs.areLocalPathsSame('myPath2', 'myPath2')).thenReturn(true);
        const interpreter: PythonEnvironment = {
            displayName: 'Disp2',
            path: 'myPath2',
            sysPrefix: 'xyz',
            sysVersion: ''
        };

        const matchingKernel = await kernelService.findMatchingKernelSpec(interpreter, instance(sessionManager));

        assert.isOk(matchingKernel);
        assert.equal(matchingKernel?.display_name, 'Disp2');
        assert.equal(matchingKernel?.name, '2');
        assert.equal(matchingKernel?.path, 'Path2');
        assert.deepEqual(matchingKernel?.metadata, activeKernelSpecs[1].metadata);
        assert.equal(matchingKernel?.language, PYTHON_LANGUAGE);
        verify(sessionManager.getKernelSpecs()).once();
    });
    test('Should return a matching spec from a jupyter process for a given kernelspec', async () => {
        const kernelSpecs = [
            new JupyterKernelSpec(
                {
                    name: 'K1',
                    argv: [],
                    display_name: 'disp1',
                    language: PYTHON_LANGUAGE,
                    resources: {},
                    metadata: { interpreter: { path: 'Some Path', envName: 'MyEnvName' } }
                },
                path.join('dir1', 'kernel.json')
            ),
            new JupyterKernelSpec(
                {
                    name: 'K2',
                    argv: [],
                    display_name: 'disp2',
                    language: PYTHON_LANGUAGE,
                    resources: {},
                    metadata: { interpreter: { path: 'Some Path2', envName: 'MyEnvName2' } }
                },
                path.join('dir2', 'kernel.json')
            )
        ];
        when(jupyterInterpreterExecutionService.getKernelSpecs(anything())).thenResolve(kernelSpecs);
        const matchingKernel = await kernelService.findMatchingKernelSpec(
            { name: 'K2', display_name: 'disp2' },
            undefined
        );

        assert.isOk(matchingKernel);
        assert.equal(matchingKernel?.display_name, 'disp2');
        assert.equal(matchingKernel?.name, 'K2');
        assert.equal(matchingKernel?.metadata?.interpreter?.path, 'Some Path2');
        assert.equal(matchingKernel?.language, PYTHON_LANGUAGE);
    });
    test('Should return a matching spec from a jupyter process for a given interpreter', async () => {
        const kernelSpecs = [
            new JupyterKernelSpec(
                {
                    name: 'K1',
                    argv: [],
                    display_name: 'disp1',
                    language: PYTHON_LANGUAGE,
                    resources: {},
                    metadata: { interpreter: { path: 'Some Path', envName: 'MyEnvName' } }
                },
                path.join('dir1', 'kernel.json')
            ),
            new JupyterKernelSpec(
                {
                    name: 'K2',
                    argv: [],
                    display_name: 'disp2',
                    language: PYTHON_LANGUAGE,
                    resources: {},
                    metadata: { interpreter: { path: 'Some Path2', envName: 'MyEnvName2' } }
                },
                path.join('dir2', 'kernel.json')
            )
        ];
        when(jupyterInterpreterExecutionService.getKernelSpecs(anything())).thenResolve(kernelSpecs);
        when(fs.areLocalPathsSame('Some Path2', 'Some Path2')).thenReturn(true);
        when(fs.localFileExists(path.join('dir2', 'kernel.json'))).thenResolve(true);
        const interpreter: PythonEnvironment = {
            displayName: 'disp2',
            path: 'Some Path2',
            sysPrefix: 'xyz',
            sysVersion: ''
        };

        const matchingKernel = await kernelService.findMatchingKernelSpec(interpreter, undefined);

        assert.isOk(matchingKernel);
        assert.equal(matchingKernel?.display_name, 'disp2');
        assert.equal(matchingKernel?.name, 'K2');
        assert.equal(matchingKernel?.metadata?.interpreter?.path, 'Some Path2');
        assert.equal(matchingKernel?.language, PYTHON_LANGUAGE);
        assert.deepEqual(matchingKernel?.metadata, kernelSpecs[1].metadata);
    });
    // tslint:disable-next-line: max-func-body-length
    suite('Registering Interpreters as Kernels', () => {
        let findMatchingKernelSpecStub: sinon.SinonStub<
            [PythonEnvironment, IJupyterSessionManager?, (CancellationToken | undefined)?],
            Promise<IJupyterKernelSpec | undefined>
        >;
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
            findMatchingKernelSpecStub = sinon.stub(KernelService.prototype, 'findMatchingKernelSpec');
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

            const promise = kernelService.registerKernel(invalidInterpreter);

            await assert.isRejected(promise, 'Interpreter does not have a display name');
        });
        test('Fail if installed kernel cannot be found', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            findMatchingKernelSpecStub.resolves(undefined);
            fakeTimer.install();

            const promise = kernelService.registerKernel(interpreter);

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
            findMatchingKernelSpecStub.resolves(undefined);
            fakeTimer.install();

            const promise = kernelService.registerKernel(interpreter);

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
            findMatchingKernelSpecStub.resolves(undefined);

            const kernel = await kernelService.registerKernel(interpreter);

            assert.isUndefined(kernel);
            verify(execService.execModule('ipykernel', anything(), anything())).never();
            verify(dependencyService.installMissingDependencies(anything(), anything())).once();
        });
        test('Fail if installed kernel is not an instance of JupyterKernelSpec', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            // tslint:disable-next-line: no-any
            findMatchingKernelSpecStub.resolves({} as any);

            const promise = kernelService.registerKernel(interpreter);

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
            // tslint:disable-next-line: no-any
            const kernel = new JupyterKernelSpec({} as any);
            findMatchingKernelSpecStub.resolves(kernel);

            const promise = kernelService.registerKernel(interpreter);

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
            when(fs.readLocalFile(kernelJsonFile)).thenResolve(JSON.stringify(kernelSpecModel));
            when(fs.writeLocalFile(kernelJsonFile, anything())).thenResolve();
            when(activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)).thenResolve(
                undefined
            );
            findMatchingKernelSpecStub.resolves(kernel);
            const expectedKernelJsonContent: ReadWrite<Kernel.ISpecModel> = cloneDeep(kernelSpecModel);
            // Fully qualified path must be injected into `argv`.
            expectedKernelJsonContent.argv = [interpreter.path, '-m', 'ipykernel'];
            // tslint:disable-next-line: no-any
            expectedKernelJsonContent.metadata!.interpreter = interpreter as any;

            const installedKernel = await kernelService.registerKernel(interpreter);

            // tslint:disable-next-line: no-any
            assert.deepEqual(kernel, installedKernel as any);
            verify(fs.writeLocalFile(kernelJsonFile, anything())).once();
            // Verify the contents of JSON written to the file match as expected.
            assert.deepEqual(JSON.parse(capture(fs.writeLocalFile).first()[1] as string), expectedKernelJsonContent);
        });
        test('Kernel is installed and spec file is updated with interpreter information in metadata along with environment variables', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            const kernel = new JupyterKernelSpec(kernelSpecModel, kernelJsonFile);
            when(fs.readLocalFile(kernelJsonFile)).thenResolve(JSON.stringify(kernelSpecModel));
            when(fs.writeLocalFile(kernelJsonFile, anything())).thenResolve();
            const envVariables = { MYVAR: '1' };
            when(activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)).thenResolve(
                envVariables
            );
            findMatchingKernelSpecStub.resolves(kernel);
            const expectedKernelJsonContent: ReadWrite<Kernel.ISpecModel> = cloneDeep(kernelSpecModel);
            // Fully qualified path must be injected into `argv`.
            expectedKernelJsonContent.argv = [interpreter.path, '-m', 'ipykernel'];
            // tslint:disable-next-line: no-any
            expectedKernelJsonContent.metadata!.interpreter = interpreter as any;
            // tslint:disable-next-line: no-any
            expectedKernelJsonContent.env = envVariables as any;

            const installedKernel = await kernelService.registerKernel(interpreter);

            // tslint:disable-next-line: no-any
            assert.deepEqual(kernel, installedKernel as any);
            verify(fs.writeLocalFile(kernelJsonFile, anything())).once();
            // Verify the contents of JSON written to the file match as expected.
            assert.deepEqual(JSON.parse(capture(fs.writeLocalFile).first()[1] as string), expectedKernelJsonContent);
        });
        test('Kernel is found and spec file is updated with interpreter information in metadata along with environment variables', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            const kernel = new JupyterKernelSpec(kernelSpecModel, kernelJsonFile);
            when(jupyterInterpreterExecutionService.getKernelSpecs(anything())).thenResolve([kernel]);
            when(fs.readLocalFile(kernelJsonFile)).thenResolve(JSON.stringify(kernelSpecModel));
            when(fs.writeLocalFile(kernelJsonFile, anything())).thenResolve();
            const envVariables = { MYVAR: '1' };
            when(activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)).thenResolve(
                envVariables
            );
            findMatchingKernelSpecStub.resolves(kernel);
            const expectedKernelJsonContent: ReadWrite<Kernel.ISpecModel> = cloneDeep(kernelSpecModel);
            // Fully qualified path must be injected into `argv`.
            expectedKernelJsonContent.argv = [interpreter.path, '-m', 'ipykernel'];
            // tslint:disable-next-line: no-any
            expectedKernelJsonContent.metadata!.interpreter = interpreter as any;
            // tslint:disable-next-line: no-any
            expectedKernelJsonContent.env = envVariables as any;

            const installedKernel = await kernelService.searchAndRegisterKernel(interpreter, true);

            // tslint:disable-next-line: no-any
            assert.deepEqual(kernel, installedKernel as any);
            verify(fs.writeLocalFile(kernelJsonFile, anything())).once();
            // Verify the contents of JSON written to the file match as expected.
            assert.deepEqual(JSON.parse(capture(fs.writeLocalFile).first()[1] as string), expectedKernelJsonContent);
        });
        test('Kernel is found and spec file is not updated with interpreter information when user spec file', async () => {
            when(execService.execModule('ipykernel', anything(), anything())).thenResolve({ stdout: '' });
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            const kernel = new JupyterKernelSpec(userKernelSpecModel, kernelJsonFile);
            when(jupyterInterpreterExecutionService.getKernelSpecs(anything())).thenResolve([kernel]);
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
            findMatchingKernelSpecStub.resolves(kernel);

            const installedKernel = await kernelService.searchAndRegisterKernel(interpreter, true);

            // tslint:disable-next-line: no-any
            assert.deepEqual(kernel, installedKernel as any);
            assert.ok(contents, 'Env not updated');
            const obj = JSON.parse(contents!);
            assert.notOk(obj.metadata.interpreter, 'MetaData should not have been written');
        });
    });
});
