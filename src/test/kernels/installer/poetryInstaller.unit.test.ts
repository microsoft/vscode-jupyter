// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as sinon from 'sinon';
import * as path from '../../../platform/vscode-path/path';
import assert from 'assert';
import { expect } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { WorkspaceService } from '../../../platform/common/application/workspace.node';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { ExecutionResult, ShellOptions } from '../../../platform/common/process/types.node';
import { IConfigurationService } from '../../../platform/common/types';
import { ServiceContainer } from '../../../platform/ioc/container';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { TEST_LAYOUT_ROOT } from '../../../test/pythonEnvironments/constants';
import * as fileUtils from '../../../platform/common/platform/fileUtils.node';
import { JupyterSettings } from '../../../platform/common/configSettings';
import { PoetryInstaller } from '../../../kernels/installer/poetryInstaller.node';
import { ExecutionInstallArgs } from '../../../kernels/installer/moduleInstaller.node';
import { ModuleInstallFlags } from '../../../kernels/installer/types';

suite('Module Installer - Poetry', () => {
    class TestInstaller extends PoetryInstaller {
        public override async getExecutionArgs(
            moduleName: string,
            interpreter: PythonEnvironment,
            _flags?: ModuleInstallFlags
        ): Promise<ExecutionInstallArgs> {
            return super.getExecutionArgs(moduleName, interpreter);
        }
    }
    const testPoetryDir = path.join(TEST_LAYOUT_ROOT, 'poetry');
    const project1 = path.join(testPoetryDir, 'project1');
    let poetryInstaller: TestInstaller;
    let workspaceService: IWorkspaceService;
    let configurationService: IConfigurationService;
    let serviceContainer: ServiceContainer;
    let shellExecute: sinon.SinonStub;

    setup(() => {
        serviceContainer = mock(ServiceContainer);
        workspaceService = mock(WorkspaceService);
        configurationService = mock(ConfigurationService);

        shellExecute = sinon.stub(fileUtils, 'shellExecute');
        shellExecute.callsFake((command: string, options: ShellOptions) => {
            // eslint-disable-next-line default-case
            switch (command) {
                case 'poetry env list --full-path':
                    return Promise.resolve<ExecutionResult<string>>({ stdout: '' });
                case 'poetry env info -p':
                    if (options.cwd && fileUtils.arePathsSame(options.cwd.toString(), project1)) {
                        return Promise.resolve<ExecutionResult<string>>({
                            stdout: `${path.join(project1, '.venv')} \n`
                        });
                    }
            }
            return Promise.reject(new Error('Command failed'));
        });

        poetryInstaller = new TestInstaller(
            instance(serviceContainer),
            instance(workspaceService),
            instance(configurationService)
        );
    });

    teardown(() => {
        shellExecute?.restore();
    });

    test('Installer name is poetry', () => {
        expect(poetryInstaller.name).to.equal('poetry');
    });

    test('Installer priority is 10', () => {
        expect(poetryInstaller.priority).to.equal(10);
    });

    test('Installer display name is poetry', () => {
        expect(poetryInstaller.displayName).to.equal('poetry');
    });

    test('Is not supported when there is no workspace', async () => {
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Poetry,
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath,
            sysPrefix: '0'
        };

        when(workspaceService.getWorkspaceFolder(anything())).thenReturn();

        const supported = await poetryInstaller.isSupported(interpreter);

        assert.strictEqual(supported, false);
    });
    test('Get Executable info', async () => {
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Poetry,
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath,
            sysPrefix: '0'
        };
        const settings = mock(JupyterSettings);

        when(configurationService.getSettings(undefined)).thenReturn(instance(settings));
        when(settings.poetryPath).thenReturn('poetry path');

        const info = await poetryInstaller.getExecutionArgs('something', interpreter);

        assert.deepEqual(info, { args: ['poetry path', 'add', '--dev', 'something'], cwd: null, useShellExec: true });
    });
    test('Is supported returns true if selected interpreter is related to the workspace', async () => {
        const uri = Uri.file(project1);
        const settings = mock(JupyterSettings);
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Poetry,
            uri: Uri.file(path.join(project1, '.venv', 'scripts', 'python.exe')),
            id: Uri.file(path.join(project1, '.venv', 'scripts', 'python.exe')).fsPath,
            sysPrefix: '0'
        };

        when(configurationService.getSettings(anything())).thenReturn(instance(settings));
        when(settings.poetryPath).thenReturn('poetry');
        when(workspaceService.getWorkspaceFolder(anything())).thenReturn({ uri, name: '', index: 0 });

        const supported = await poetryInstaller.isSupported(interpreter);

        assert.strictEqual(supported, true);
    });

    test('Is supported returns false if selected interpreter is not related to the workspace', async () => {
        const uri = Uri.file(project1);
        const settings = mock(JupyterSettings);
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Poetry,
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath,
            sysPrefix: '0'
        };

        when(configurationService.getSettings(anything())).thenReturn(instance(settings));
        when(settings.poetryPath).thenReturn('poetry');
        when(workspaceService.getWorkspaceFolder(anything())).thenReturn({ uri, name: '', index: 0 });

        const supported = await poetryInstaller.isSupported(interpreter);

        assert.strictEqual(supported, false);
    });

    test('Is supported returns false if selected interpreter is not of Poetry type', async () => {
        const uri = Uri.file(project1);
        const settings = mock(JupyterSettings);
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Conda,
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath,
            sysPrefix: '0'
        };

        when(configurationService.getSettings(anything())).thenReturn(instance(settings));
        when(settings.poetryPath).thenReturn('poetry');
        when(workspaceService.getWorkspaceFolder(anything())).thenReturn({ uri, name: '', index: 0 });

        const supported = await poetryInstaller.isSupported(interpreter);

        assert.strictEqual(supported, false);
    });
});
