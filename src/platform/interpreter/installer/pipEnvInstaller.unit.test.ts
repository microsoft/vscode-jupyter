// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import { Uri } from 'vscode';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { PipEnvInstaller } from '../../../platform/interpreter/installer/pipEnvInstaller.node';
import * as pipEnvHelper from '../../../platform/interpreter/installer/pipenv.node';
import { instance, mock, when } from 'ts-mockito';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';
import { resolvableInstance, uriEquals } from '../../../test/datascience/helpers';
import type { IDisposable } from '../../common/types';
import { PythonExtension } from '@vscode/python-extension';
import { dispose } from '../../common/utils/lifecycle';
import { setPythonApi } from '../helpers';

suite('PipEnv installer', async () => {
    let disposables: IDisposable[] = [];
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let isPipenvEnvironmentRelatedToFolder: sinon.SinonStub;
    let interpreterService: TypeMoq.IMock<IInterpreterService>;
    let pipEnvInstaller: PipEnvInstaller;
    const interpreterPath = Uri.file('path/to/interpreter');
    const workspaceFolder = Uri.file('path/to/folder');
    let environments: PythonExtension['environments'];
    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        interpreterService = TypeMoq.Mock.ofType<IInterpreterService>();
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(IInterpreterService)))
            .returns(() => interpreterService.object);

        isPipenvEnvironmentRelatedToFolder = sinon
            .stub(pipEnvHelper, 'isPipenvEnvironmentRelatedToFolder')
            .callsFake((interpreter: Uri, folder: Uri) => {
                return Promise.resolve(interpreterPath === interpreter && folder === workspaceFolder);
            });
        pipEnvInstaller = new PipEnvInstaller(serviceContainer.object);

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
        isPipenvEnvironmentRelatedToFolder.restore();
    });

    test('Installer name is pipenv', () => {
        expect(pipEnvInstaller.name).to.equal('pipenv');
    });

    test('Installer priority is 10', () => {
        expect(pipEnvInstaller.priority).to.equal(10);
    });

    test('If InterpreterUri is Pipenv interpreter, method isSupported() returns true', async () => {
        const interpreter = {
            id: '1'
        };
        when(environments.known).thenReturn([
            {
                id: '1',
                tools: [EnvironmentType.Pipenv]
            } as any
        ]);

        const result = await pipEnvInstaller.isSupported(interpreter as any);
        expect(result).to.equal(true, 'Should be true');
    });

    test('If InterpreterUri is Python interpreter but not of type Pipenv, method isSupported() returns false', async () => {
        const interpreter = {
            id: '1'
        };
        when(environments.known).thenReturn([
            {
                id: '1',
                tools: [EnvironmentType.Conda]
            } as any
        ]);

        const result = await pipEnvInstaller.isSupported(interpreter as any);
        expect(result).to.equal(false, 'Should be false');
    });

    test('If active environment is pipenv and is related to workspace folder, return true', async () => {
        const resource = Uri.parse('a');
        when(environments.known).thenReturn([
            {
                id: '1',
                tools: [EnvironmentType.Pipenv]
            } as any
        ]);

        interpreterService
            .setup((p) => p.getActiveInterpreter(resource))
            .returns(() => Promise.resolve({ id: '1', uri: interpreterPath } as any));

        when(mockedVSCodeNamespaces.workspace.getWorkspaceFolder(uriEquals(resource))).thenReturn({
            uri: workspaceFolder
        } as any);
        const result = await pipEnvInstaller.isSupported(resource);
        expect(result).to.equal(true, 'Should be true');
    });

    test('If active environment is not pipenv, return false', async () => {
        const resource = Uri.parse('a');
        interpreterService
            .setup((p) => p.getActiveInterpreter(resource))
            .returns(() => Promise.resolve({ uri: interpreterPath } as any));

        when(mockedVSCodeNamespaces.workspace.getWorkspaceFolder(uriEquals(resource))).thenReturn({
            uri: { fsPath: workspaceFolder }
        } as any);
        const result = await pipEnvInstaller.isSupported(resource);
        expect(result).to.equal(false, 'Should be false');
    });

    test('If active environment is pipenv but not related to workspace folder, return false', async () => {
        const resource = Uri.parse('a');
        interpreterService
            .setup((p) => p.getActiveInterpreter(resource))
            .returns(() => Promise.resolve({ uri: 'some random path' } as any));

        when(mockedVSCodeNamespaces.workspace.getWorkspaceFolder(uriEquals(resource))).thenReturn({
            uri: { fsPath: workspaceFolder }
        } as any);
        const result = await pipEnvInstaller.isSupported(resource);
        expect(result).to.equal(false, 'Should be false');
    });
});
