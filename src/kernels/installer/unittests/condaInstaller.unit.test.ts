// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as assert from 'assert';
import { instance, mock, when } from 'ts-mockito';
import { JupyterSettings } from '../../../client/common/configSettings';
import { ConfigurationService } from '../../../client/common/configuration/service';
import { CondaService } from '../../../client/common/process/condaService';
import { IConfigurationService } from '../../../client/common/types';
import { ServiceContainer } from '../../../client/ioc/container';
import { IServiceContainer } from '../../../client/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { CondaInstaller } from '../condaInstaller';
import { ExecutionInstallArgs } from '../moduleInstaller';
import { ModuleInstallFlags } from '../types';

suite('Common - Conda Installer', () => {
    let installer: CondaInstallerTest;
    let serviceContainer: IServiceContainer;
    let condaService: CondaService;
    let configService: IConfigurationService;
    class CondaInstallerTest extends CondaInstaller {
        public async getExecutionArgs(
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
    });
    test('Name and priority', async () => {
        assert.strictEqual(installer.displayName, 'Conda');
        assert.strictEqual(installer.name, 'Conda');
        assert.strictEqual(installer.priority, 0);
    });
    test('Installer is not supported when conda is available variable is set to false', async () => {
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Conda,
            path: 'foobar',
            sysPrefix: '0'
        };

        installer._isCondaAvailable = false;

        const supported = await installer.isSupported(interpreter);

        assert.strictEqual(supported, false);
    });
    test('Installer is not supported when conda is not available', async () => {
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Conda,
            path: 'foobar',
            sysPrefix: '0'
        };
        when(condaService.isCondaAvailable()).thenResolve(false);

        const supported = await installer.isSupported(interpreter);

        assert.strictEqual(supported, false);
    });
    test('Installer is not supported when current env is not a conda env', async () => {
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Global,
            path: 'foobar',
            sysPrefix: '0'
        };
        const settings = mock(JupyterSettings);

        when(condaService.isCondaAvailable()).thenResolve(true);
        when(configService.getSettings(undefined)).thenReturn(instance(settings));

        const supported = await installer.isSupported(interpreter);

        assert.strictEqual(supported, false);
    });
    test('Installer is supported when current env is a conda env', async () => {
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Conda,
            path: 'foobar',
            sysPrefix: '0'
        };
        const settings = mock(JupyterSettings);

        when(condaService.isCondaAvailable()).thenResolve(true);
        when(configService.getSettings(undefined)).thenReturn(instance(settings));

        const supported = await installer.isSupported(interpreter);

        assert.strictEqual(supported, true);
    });
    test('Include name of environment', async () => {
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Conda,
            path: 'foobar',
            sysPrefix: '0',
            envName: 'baz'
        };
        const settings = mock(JupyterSettings);
        const condaPath = 'some Conda Path';

        when(configService.getSettings(undefined)).thenReturn(instance(settings));
        when(condaService.getCondaFile()).thenResolve(condaPath);

        const execInfo = await installer.getExecutionArgs('abc', interpreter);

        assert.deepEqual(execInfo, { args: ['install', '--name', interpreter.envName, 'abc', '-y'], exe: condaPath });
    });
    test('Include path of environment', async () => {
        const settings = mock(JupyterSettings);
        const interpreter: PythonEnvironment = {
            envType: EnvironmentType.Conda,
            path: 'foobar',
            sysPrefix: '0',
            envName: 'baz'
        };
        const condaPath = 'some Conda Path';

        when(configService.getSettings(undefined)).thenReturn(instance(settings));
        when(condaService.getCondaFile()).thenResolve(condaPath);

        const execInfo = await installer.getExecutionArgs('abc', interpreter);

        assert.deepEqual(execInfo, {
            args: ['install', '--prefix', interpreter.path.fileToCommandArgument(), 'abc', '-y'],
            exe: condaPath
        });
    });
});
