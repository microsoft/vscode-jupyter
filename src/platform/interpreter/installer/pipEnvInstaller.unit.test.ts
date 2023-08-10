// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { PipEnvInstaller } from '../../../platform/interpreter/installer/pipEnvInstaller.node';
import * as pipEnvHelper from '../../../platform/interpreter/installer/pipenv.node';

suite('PipEnv installer', async () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let isPipenvEnvironmentRelatedToFolder: sinon.SinonStub;
    let workspaceService: TypeMoq.IMock<IWorkspaceService>;
    let interpreterService: TypeMoq.IMock<IInterpreterService>;
    let pipEnvInstaller: PipEnvInstaller;
    const interpreterPath = Uri.file('path/to/interpreter');
    const workspaceFolder = Uri.file('path/to/folder');
    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        workspaceService = TypeMoq.Mock.ofType<IWorkspaceService>();
        interpreterService = TypeMoq.Mock.ofType<IInterpreterService>();
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(IWorkspaceService)))
            .returns(() => workspaceService.object);
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(IInterpreterService)))
            .returns(() => interpreterService.object);

        isPipenvEnvironmentRelatedToFolder = sinon
            .stub(pipEnvHelper, 'isPipenvEnvironmentRelatedToFolder')
            .callsFake((interpreter: Uri, folder: Uri) => {
                return Promise.resolve(interpreterPath === interpreter && folder === workspaceFolder);
            });
        pipEnvInstaller = new PipEnvInstaller(serviceContainer.object, workspaceService.object);
    });

    teardown(() => {
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
            envType: EnvironmentType.Pipenv
        };

        const result = await pipEnvInstaller.isSupported(interpreter as any);
        expect(result).to.equal(true, 'Should be true');
    });

    test('If InterpreterUri is Python interpreter but not of type Pipenv, method isSupported() returns false', async () => {
        const interpreter = {
            envType: EnvironmentType.Conda
        };

        const result = await pipEnvInstaller.isSupported(interpreter as any);
        expect(result).to.equal(false, 'Should be false');
    });

    test('If active environment is pipenv and is related to workspace folder, return true', async () => {
        const resource = Uri.parse('a');

        interpreterService
            .setup((p) => p.getActiveInterpreter(resource))
            .returns(() => Promise.resolve({ envType: EnvironmentType.Pipenv, uri: interpreterPath } as any));

        workspaceService.setup((w) => w.getWorkspaceFolder(resource)).returns(() => ({ uri: workspaceFolder }) as any);
        const result = await pipEnvInstaller.isSupported(resource);
        expect(result).to.equal(true, 'Should be true');
    });

    test('If active environment is not pipenv, return false', async () => {
        const resource = Uri.parse('a');
        interpreterService
            .setup((p) => p.getActiveInterpreter(resource))
            .returns(() => Promise.resolve({ envType: EnvironmentType.Conda, uri: interpreterPath } as any));

        workspaceService
            .setup((w) => w.getWorkspaceFolder(resource))
            .returns(() => ({ uri: { fsPath: workspaceFolder } }) as any);
        const result = await pipEnvInstaller.isSupported(resource);
        expect(result).to.equal(false, 'Should be false');
    });

    test('If active environment is pipenv but not related to workspace folder, return false', async () => {
        const resource = Uri.parse('a');
        interpreterService
            .setup((p) => p.getActiveInterpreter(resource))
            .returns(() => Promise.resolve({ envType: EnvironmentType.Pipenv, uri: 'some random path' } as any));

        workspaceService
            .setup((w) => w.getWorkspaceFolder(resource))
            .returns(() => ({ uri: { fsPath: workspaceFolder } }) as any);
        const result = await pipEnvInstaller.isSupported(resource);
        expect(result).to.equal(false, 'Should be false');
    });
});
