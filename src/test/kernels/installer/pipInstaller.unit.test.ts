// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

'use strict';

import { assert, expect } from 'chai';
import { IPythonExecutionFactory, IPythonExecutionService, Output } from '../../../platform/common/process/types.node';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { PipInstaller } from '../../../kernels/installer/pipInstaller.node';
import { CancellationTokenSource, Uri, WorkspaceConfiguration } from 'vscode';
import { anything, capture, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { Product } from '../../../kernels/installer/types';
import { IDisposable } from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IApplicationShell, IWorkspaceService } from '../../../platform/common/application/types';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { noop } from '../../core';
import { ChildProcess } from 'child_process';

suite('Pip installer', async () => {
    let serviceContainer: IServiceContainer;
    let pythonExecutionFactory: IPythonExecutionFactory;
    let pipInstaller: PipInstaller;
    let pythonExecutionService: IPythonExecutionService;
    let proc: ChildProcess;
    const disposables: IDisposable[] = [];
    let subject: ReplaySubject<Output<string>>;
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

        const workspace = mock<IWorkspaceService>();
        when(serviceContainer.get<IWorkspaceService>(IWorkspaceService)).thenReturn(instance(workspace));
        const workspaceConfig = mock<WorkspaceConfiguration>();
        const appShell = mock<IApplicationShell>();
        when(serviceContainer.get<IApplicationShell>(IApplicationShell)).thenReturn(instance(appShell));
        const cancellation = new CancellationTokenSource();
        disposables.push(cancellation);
        const progress = mock<any>();
        when(appShell.withProgress(anything(), anything())).thenCall((_, cb) =>
            cb(instance(progress), cancellation.token)
        );
        when(workspace.getConfiguration('http')).thenReturn(instance(workspaceConfig));
        when(workspaceConfig.get('proxy', '')).thenReturn('');

        proc = mock<ChildProcess>();
        subject = new ReplaySubject<Output<string>>();
        when(pythonExecutionService.execObservable(anything(), anything())).thenReturn({
            dispose: noop,
            out: subject,
            proc: instance(proc)
        });

        pipInstaller = new PipInstaller(instance(serviceContainer));
    });
    teardown(() => disposeAllDisposables(disposables));
    test('Installer name is Pip', () => {
        expect(pipInstaller.name).to.equal('Pip');
    });

    test('Installer priority is 0', () => {
        expect(pipInstaller.priority).to.equal(0);
    });

    test('If InterpreterUri is Python interpreter, Python execution factory is called with the correct arguments', async () => {
        const interpreter = {
            path: 'pythonPath'
        } as unknown as PythonEnvironment;

        await pipInstaller.isSupported(interpreter as any);

        verify(pythonExecutionFactory.create(deepEqual({ resource: undefined, interpreter }))).once();
    });

    test('Method isSupported() returns true if pip module is installed', async () => {
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Global,
            uri: Uri.file('foobar'),
            sysPrefix: '0'
        };
        when(pythonExecutionService.isModuleInstalled('pip')).thenResolve(true);

        const expected = await pipInstaller.isSupported(interpreter);

        expect(expected).to.equal(true, 'Should be true');
    });

    test('Method isSupported() returns false if pip module is not installed', async () => {
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Global,
            uri: Uri.file('foobar'),
            sysPrefix: '0'
        };

        when(pythonExecutionService.isModuleInstalled('pip')).thenResolve(false);

        const expected = await pipInstaller.isSupported(interpreter);

        expect(expected).to.equal(false, 'Should be false');
    });

    test('Method isSupported() returns false if checking if pip module is installed fails with error', async () => {
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Global,
            uri: Uri.file('foobar'),
            sysPrefix: '0'
        };
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
                    envType,
                    uri: Uri.file('foobar'),
                    sysPrefix: '0'
                };
                when(pythonExecutionService.isModuleInstalled('pip')).thenReject(
                    new Error('Unable to check if module is installed')
                );
                when(proc.exitCode).thenReturn(0);
                subject.next({ out: '', source: 'stdout' });
                subject.complete();

                const cancellationToken = new CancellationTokenSource();
                disposables.push(cancellationToken);

                await pipInstaller.installModule(Product.ipykernel, interpreter, cancellationToken);

                let args = ['-m', 'pip', 'install', '-U', 'ipykernel'];
                if (
                    envType === EnvironmentType.Global ||
                    envType === EnvironmentType.System ||
                    envType === EnvironmentType.WindowsStore
                ) {
                    args = ['-m', 'pip', 'install', '-U', '--user', 'ipykernel'];
                }
                assert.deepEqual(capture(pythonExecutionService.execObservable).first()[0], args);
                verify(pythonExecutionService.execObservable(anything(), anything())).once();
            });
        });
});
