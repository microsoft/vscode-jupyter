/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert, expect } from 'chai';
import * as TypeMoq from 'typemoq';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../../platform/common/process/types.node';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { PipInstaller } from '../../../kernels/installer/pipInstaller.node';
import { Uri } from 'vscode';

suite('Pip installer', async () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let pythonExecutionFactory: TypeMoq.IMock<IPythonExecutionFactory>;
    let pipInstaller: PipInstaller;
    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        pythonExecutionFactory = TypeMoq.Mock.ofType<IPythonExecutionFactory>();
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(IPythonExecutionFactory)))
            .returns(() => pythonExecutionFactory.object);
        pipInstaller = new PipInstaller(serviceContainer.object);
    });

    test('Installer name is Pip', () => {
        expect(pipInstaller.name).to.equal('Pip');
    });

    test('Installer priority is 0', () => {
        expect(pipInstaller.priority).to.equal(0);
    });

    test('If InterpreterUri is Python interpreter, Python execution factory is called with the correct arguments', async () => {
        const pythonExecutionService = TypeMoq.Mock.ofType<IPythonExecutionService>();
        const interpreter = {
            path: 'pythonPath'
        };
        pythonExecutionFactory
            .setup((p) => p.create(TypeMoq.It.isAny()))
            .callback((options) => {
                assert.deepEqual(options, { resource: undefined, interpreter });
            })
            .returns(() => Promise.resolve(pythonExecutionService.object))
            .verifiable(TypeMoq.Times.once());
        pythonExecutionService.setup((p) => (p as any).then).returns(() => undefined);

        await pipInstaller.isSupported(interpreter as any);

        pythonExecutionFactory.verifyAll();
    });

    test('Method isSupported() returns true if pip module is installed', async () => {
        const pythonExecutionService = TypeMoq.Mock.ofType<IPythonExecutionService>();
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Global,
            uri: Uri.file('foobar'),
            sysPrefix: '0'
        };

        pythonExecutionFactory
            .setup((p) => p.create(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(pythonExecutionService.object));
        pythonExecutionService.setup((p) => (p as any).then).returns(() => undefined);
        pythonExecutionService.setup((p) => p.isModuleInstalled('pip')).returns(() => Promise.resolve(true));

        const expected = await pipInstaller.isSupported(interpreter);

        expect(expected).to.equal(true, 'Should be true');
    });

    test('Method isSupported() returns false if pip module is not installed', async () => {
        const pythonExecutionService = TypeMoq.Mock.ofType<IPythonExecutionService>();
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Global,
            uri: Uri.file('foobar'),
            sysPrefix: '0'
        };

        pythonExecutionFactory
            .setup((p) => p.create(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(pythonExecutionService.object));
        pythonExecutionService.setup((p) => (p as any).then).returns(() => undefined);
        pythonExecutionService.setup((p) => p.isModuleInstalled('pip')).returns(() => Promise.resolve(false));

        const expected = await pipInstaller.isSupported(interpreter);

        expect(expected).to.equal(false, 'Should be false');
    });

    test('Method isSupported() returns false if checking if pip module is installed fails with error', async () => {
        const pythonExecutionService = TypeMoq.Mock.ofType<IPythonExecutionService>();
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Global,
            uri: Uri.file('foobar'),
            sysPrefix: '0'
        };
        pythonExecutionFactory
            .setup((p) => p.create(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(pythonExecutionService.object));
        pythonExecutionService.setup((p) => (p as any).then).returns(() => undefined);
        pythonExecutionService
            .setup((p) => p.isModuleInstalled('pip'))
            .returns(() => Promise.reject('Unable to check if module is installed'));

        const expected = await pipInstaller.isSupported(interpreter);

        expect(expected).to.equal(false, 'Should be false');
    });
});
