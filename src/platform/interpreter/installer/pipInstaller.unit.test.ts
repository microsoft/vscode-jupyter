// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert, expect } from 'chai';
import { Output } from '../../../platform/common/process/types.node';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { PipInstaller } from '../../../platform/interpreter/installer/pipInstaller.node';
import { CancellationTokenSource, Uri, WorkspaceConfiguration } from 'vscode';
import { anything, capture, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { Product } from '../../../platform/interpreter/installer/types';
import { IDisposable } from '../../../platform/common/types';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { ChildProcess } from 'child_process';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../../platform/interpreter/types.node';
import { noop } from '../../../test/core';
import { createObservable } from '../../common/process/proc.node';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';
import { PythonExtension } from '@vscode/python-extension';
import sinon from 'sinon';
import { resolvableInstance } from '../../../test/datascience/helpers';
import { setPythonApi } from '../helpers';

suite('Pip installer', async () => {
    let serviceContainer: IServiceContainer;
    let pythonExecutionFactory: IPythonExecutionFactory;
    let pipInstaller: PipInstaller;
    let pythonExecutionService: IPythonExecutionService;
    let proc: ChildProcess;
    let disposables: IDisposable[] = [];
    let subject: ReturnType<typeof createObservable<Output<string>>>;
    let environments: PythonExtension['environments'];
    setup(() => {
        serviceContainer = mock<IServiceContainer>();
        pythonExecutionFactory = mock<IPythonExecutionFactory>();
        when(serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory)).thenReturn(
            instance(pythonExecutionFactory)
        );
        pythonExecutionService = mock<IPythonExecutionService>();
        (instance(pythonExecutionService) as any).then = undefined;
        when(pythonExecutionFactory.create(anything())).thenResolve(instance(pythonExecutionService));
        when(pythonExecutionFactory.createActivatedEnvironment(anything())).thenResolve(
            instance(pythonExecutionService)
        );

        const workspaceConfig = mock<WorkspaceConfiguration>();
        const cancellation = new CancellationTokenSource();
        disposables.push(cancellation);
        const progress = mock<any>();
        when(mockedVSCodeNamespaces.window.withProgress(anything(), anything())).thenCall((_, cb) =>
            cb(instance(progress), cancellation.token)
        );
        when(mockedVSCodeNamespaces.workspace.getConfiguration('http')).thenReturn(instance(workspaceConfig));
        when(workspaceConfig.get('proxy', '')).thenReturn('');

        proc = mock<ChildProcess>();
        subject = createObservable<Output<string>>();
        disposables.push(subject);
        when(pythonExecutionService.execObservable(anything(), anything())).thenReturn({
            dispose: noop,
            out: subject,
            proc: instance(proc)
        });

        pipInstaller = new PipInstaller(instance(serviceContainer));

        const mockedApi = mock<PythonExtension>();
        sinon.stub(PythonExtension, 'api').resolves(resolvableInstance(mockedApi));
        disposables.push({ dispose: () => sinon.restore() });
        environments = mock<PythonExtension['environments']>();
        when(mockedApi.environments).thenReturn(instance(environments));
        when(environments.known).thenReturn([]);
        setPythonApi(instance(mockedApi));
        disposables.push({ dispose: () => setPythonApi(undefined as any) });
    });

    teardown(() => (disposables = dispose(disposables)));
    test('Installer name is Pip', () => {
        expect(pipInstaller.name).to.equal('Pip');
    });

    test('Installer priority is 0', () => {
        expect(pipInstaller.priority).to.equal(0);
    });

    test('If InterpreterUri is Python interpreter, Python execution factory is called with the correct arguments', async () => {
        const interpreter = {
            id: '1',
            path: 'pythonPath'
        } as unknown as PythonEnvironment;
        when(environments.known).thenReturn([
            {
                id: '1',
                tools: []
            } as any
        ]);

        await pipInstaller.isSupported(interpreter as any);

        verify(pythonExecutionFactory.create(deepEqual({ resource: undefined, interpreter }))).once();
    });

    test('Method isSupported() returns true if pip module is installed', async () => {
        const interpreter: PythonEnvironment = {
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath
        };
        when(environments.known).thenReturn([
            {
                id: interpreter.id,
                tools: [EnvironmentType.Unknown]
            } as any
        ]);

        when(pythonExecutionService.isModuleInstalled('pip')).thenResolve(true);

        const expected = await pipInstaller.isSupported(interpreter);

        expect(expected).to.equal(true, 'Should be true');
    });

    test('Method isSupported() returns false if pip module is not installed', async () => {
        const interpreter: PythonEnvironment = {
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath
        };
        when(environments.known).thenReturn([
            {
                id: interpreter.id,
                tools: [EnvironmentType.Unknown]
            } as any
        ]);

        when(pythonExecutionService.isModuleInstalled('pip')).thenResolve(false);

        const expected = await pipInstaller.isSupported(interpreter);

        expect(expected).to.equal(false, 'Should be false');
    });

    test('Method isSupported() returns false if checking if pip module is installed fails with error', async () => {
        const interpreter: PythonEnvironment = {
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath
        };
        when(environments.known).thenReturn([
            {
                id: interpreter.id,
                tools: [EnvironmentType.Unknown]
            } as any
        ]);

        when(pythonExecutionService.isModuleInstalled('pip')).thenReject(
            new Error('Unable to check if module is installed')
        );

        const expected = await pipInstaller.isSupported(interpreter);

        expect(expected).to.equal(false, 'Should be false');
    });
    Object.keys(EnvironmentType)
        .map((envType) => envType as unknown as EnvironmentType)
        .forEach((envType) => {
            test(`Test install args for ${envType}`, async () => {
                const interpreter: PythonEnvironment = {
                    uri: Uri.file('foobar'),
                    id: Uri.file('foobar').fsPath
                };
                when(environments.known).thenReturn([
                    {
                        id: interpreter.id,
                        tools: [envType]
                    } as any
                ]);

                when(pythonExecutionService.isModuleInstalled('pip')).thenReject(
                    new Error('Unable to check if module is installed')
                );
                when(proc.exitCode).thenReturn(0);
                subject.fire({ out: '', source: 'stdout' });
                subject.resolve();

                const cancellationToken = new CancellationTokenSource();
                disposables.push(cancellationToken);

                await pipInstaller.installModule(Product.ipykernel, interpreter, cancellationToken);

                let args = ['-m', 'pip', 'install', '-U', 'ipykernel'];
                if (envType === EnvironmentType.Unknown) {
                    args = ['-m', 'pip', 'install', '-U', '--user', 'ipykernel'];
                }
                assert.deepEqual(capture(pythonExecutionService.execObservable).first()[0], args);
                verify(pythonExecutionService.execObservable(anything(), anything())).once();
            });
        });
});
