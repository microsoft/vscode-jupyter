// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from 'assert';
import { instance, mock, when } from 'ts-mockito';
import { JupyterSettings } from '../../../platform/common/configSettings';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { CondaService } from '../../../platform/interpreter/condaService.node';
import { IConfigurationService, type IDisposable } from '../../../platform/common/types';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { CondaInstaller } from '../../../platform/interpreter/installer/condaInstaller.node';
import { ExecutionInstallArgs } from '../../../platform/interpreter/installer/moduleInstaller.node';
import { ModuleInstallFlags } from '../../../platform/interpreter/installer/types';
import { Uri } from 'vscode';
import { fileToCommandArgument } from '../../../platform/common/helpers';
import { PythonExtension } from '@vscode/python-extension';
import sinon from 'sinon';
import { resolvableInstance } from '../../../test/datascience/helpers';
import { dispose } from '../../common/utils/lifecycle';
import { setPythonApi } from '../helpers';

suite('Common - Conda Installer', () => {
    let disposables: IDisposable[] = [];
    let installer: CondaInstallerTest;
    let serviceContainer: IServiceContainer;
    let condaService: CondaService;
    let configService: IConfigurationService;
    let environments: PythonExtension['environments'];
    class CondaInstallerTest extends CondaInstaller {
        public override async getExecutionArgs(
            moduleName: string,
            interpreter: PythonEnvironment,
            flags?: ModuleInstallFlags
        ): Promise<ExecutionInstallArgs> {
            return super.getExecutionArgs(moduleName, interpreter, flags);
        }
    }
    setup(() => {
        serviceContainer = mock(ServiceContainer);
        condaService = mock(CondaService);
        configService = mock(ConfigurationService);
        when(serviceContainer.get<CondaService>(CondaService)).thenReturn(instance(condaService));
        when(serviceContainer.get<IConfigurationService>(IConfigurationService)).thenReturn(instance(configService));
        installer = new CondaInstallerTest(instance(serviceContainer));

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

    test('Name and priority', async () => {
        assert.strictEqual(installer.displayName, 'Conda');
        assert.strictEqual(installer.name, 'Conda');
        assert.strictEqual(installer.priority, 0);
    });
    test('Installer is not supported when conda is available variable is set to false', async () => {
        const interpreter: PythonEnvironment = {
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath
        };

        installer._isCondaAvailable = false;

        const supported = await installer.isSupported(interpreter);

        assert.strictEqual(supported, false);
    });
    test('Installer is not supported when conda is not available', async () => {
        const interpreter: PythonEnvironment = {
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath
        };
        when(condaService.isCondaAvailable()).thenResolve(false);

        const supported = await installer.isSupported(interpreter);

        assert.strictEqual(supported, false);
    });
    test('Installer is not supported when current env is not a conda env', async () => {
        const interpreter: PythonEnvironment = {
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath
        };
        const settings = mock(JupyterSettings);

        when(condaService.isCondaAvailable()).thenResolve(true);
        when(configService.getSettings(undefined)).thenReturn(instance(settings));

        const supported = await installer.isSupported(interpreter);

        assert.strictEqual(supported, false);
    });
    test('Installer is supported when current env is a conda env', async () => {
        const interpreter: PythonEnvironment = {
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath
        };
        when(environments.known).thenReturn([
            {
                id: interpreter.id,
                tools: [EnvironmentType.Conda]
            } as any
        ]);

        const settings = mock(JupyterSettings);

        when(condaService.isCondaAvailable()).thenResolve(true);
        when(configService.getSettings(undefined)).thenReturn(instance(settings));

        const supported = await installer.isSupported(interpreter);

        assert.strictEqual(supported, true);
    });
    test('Include name of environment', async () => {
        const interpreter: PythonEnvironment = {
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath
        };
        when(environments.known).thenReturn([
            {
                id: interpreter.id,
                executable: {
                    uri: Uri.file('foobar')
                },
                environment: {
                    name: 'baz'
                },
                tools: [EnvironmentType.Conda]
            } as any
        ]);

        const settings = mock(JupyterSettings);
        const condaPath = Uri.file('some Conda Path');

        when(configService.getSettings(undefined)).thenReturn(instance(settings));
        when(condaService.getCondaFile()).thenResolve(condaPath.fsPath);

        const execInfo = await installer.getExecutionArgs('abc', interpreter);

        assert.deepStrictEqual(execInfo, {
            args: ['install', '--name', 'baz', 'abc', '-y'],
            exe: condaPath.fsPath
        });
    });
    test('When conda exec path is conda, then do not use /conda as the executable path', async () => {
        const interpreter: PythonEnvironment = {
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath
        };
        const settings = mock(JupyterSettings);
        when(environments.known).thenReturn([
            {
                id: interpreter.id,
                executable: {
                    uri: Uri.file('foobar')
                },
                environment: {
                    name: 'baz'
                },
                tools: [EnvironmentType.Conda]
            } as any
        ]);

        when(configService.getSettings(undefined)).thenReturn(instance(settings));
        when(condaService.getCondaFile()).thenResolve('conda');

        const execInfo = await installer.getExecutionArgs('abc', interpreter);

        assert.deepStrictEqual(execInfo, {
            args: ['install', '--name', 'baz', 'abc', '-y'],
            exe: 'conda'
        });
    });
    test('Include path of environment', async () => {
        const settings = mock(JupyterSettings);
        const interpreter: PythonEnvironment = {
            uri: Uri.file('baz/foobar/python.exe'),
            id: Uri.file('baz/foobar/python.exe').fsPath
        };
        const condaPath = Uri.file('some Conda Path');

        when(configService.getSettings(undefined)).thenReturn(instance(settings));
        when(condaService.getCondaFile()).thenResolve(condaPath.fsPath);

        const execInfo = await installer.getExecutionArgs('abc', interpreter);

        assert.deepStrictEqual(execInfo, {
            args: ['install', '--prefix', fileToCommandArgument('/baz/foobar'), 'abc', '-y'],
            exe: condaPath.fsPath
        });
    });
    test('Include path of environment but skip bin', async () => {
        const settings = mock(JupyterSettings);
        const interpreter: PythonEnvironment = {
            uri: Uri.file('baz/foobar/bin/python.exe'),
            id: Uri.file('baz/foobar/bin/python.exe').fsPath
        };
        const condaPath = Uri.file('some Conda Path');

        when(configService.getSettings(undefined)).thenReturn(instance(settings));
        when(condaService.getCondaFile()).thenResolve(condaPath.fsPath);

        const execInfo = await installer.getExecutionArgs('abc', interpreter);

        assert.deepStrictEqual(execInfo, {
            args: ['install', '--prefix', fileToCommandArgument('/baz/foobar'), 'abc', '-y'],
            exe: condaPath.fsPath
        });
    });
});
