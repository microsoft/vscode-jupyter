// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable  */

import { assert, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as path from '../../../platform/vscode-path/path';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { EnvironmentVariablesService } from '../../../platform/common/variables/environment.node';
import { IEnvironmentVariablesProvider } from '../../../platform/common/variables/types';
import { IEnvironmentActivationService } from '../../../platform/interpreter/activation/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { anything, instance, mock, when } from 'ts-mockito';
import { KernelEnvironmentVariablesService } from '../../../kernels/raw/launcher/kernelEnvVarsService.node';
import { IJupyterKernelSpec } from '../../../kernels/types';
import { Uri } from 'vscode';
import { IConfigurationService, IWatchableJupyterSettings } from '../../../platform/common/types';
import { JupyterSettings } from '../../../platform/common/configSettings';

use(chaiAsPromised);

suite('Kernel Environment Variables Service', () => {
    let fs: IFileSystemNode;
    let envActivation: IEnvironmentActivationService;
    let customVariablesService: IEnvironmentVariablesProvider;
    let variablesService: EnvironmentVariablesService;
    let kernelVariablesService: KernelEnvironmentVariablesService;
    let interpreterService: IInterpreterService;
    let configService: IConfigurationService;
    let settings: IWatchableJupyterSettings;
    const pathFile = Uri.file('foobar');
    const interpreter: PythonEnvironment = {
        envType: EnvironmentType.Conda,
        uri: pathFile,
        sysPrefix: '0'
    };
    const kernelSpec: IJupyterKernelSpec = {
        name: 'kernel',
        executable: pathFile.fsPath,
        display_name: 'kernel',
        interpreterPath: pathFile.fsPath,
        argv: []
    };

    setup(() => {
        fs = mock<IFileSystemNode>();
        envActivation = mock<IEnvironmentActivationService>();
        when(envActivation.hasActivationCommands(anything(), anything())).thenResolve(false);
        customVariablesService = mock<IEnvironmentVariablesProvider>();
        interpreterService = mock<IInterpreterService>();
        variablesService = new EnvironmentVariablesService(instance(fs));
        configService = mock<IConfigurationService>();
        settings = mock(JupyterSettings);
        when(configService.getSettings(anything())).thenReturn(instance(settings));
        kernelVariablesService = new KernelEnvironmentVariablesService(
            instance(interpreterService),
            instance(envActivation),
            variablesService,
            instance(customVariablesService),
            instance(configService)
        );
    });

    suite(`getEnvironmentVariables()`, () => {
        test('Interpreter path trumps process', async () => {
            when(envActivation.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({
                PATH: 'foobar'
            });
            when(customVariablesService.getCustomEnvironmentVariables(anything())).thenResolve();

            const vars = await kernelVariablesService.getEnvironmentVariables(undefined, interpreter, kernelSpec);

            const processPath = Object.keys(process.env).find((k) => k.toLowerCase() == 'path');
            assert.isOk(processPath);
            assert.isOk(vars);
            assert.strictEqual(vars![processPath!], `${path.dirname(interpreter.uri.fsPath)}${path.delimiter}foobar`);
        });

        test('Paths are merged', async () => {
            when(envActivation.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({
                PATH: 'foobar'
            });
            when(customVariablesService.getCustomEnvironmentVariables(anything())).thenResolve({ PATH: 'foobaz' });

            const vars = await kernelVariablesService.getEnvironmentVariables(undefined, interpreter, kernelSpec);
            const processPath = Object.keys(process.env).find((k) => k.toLowerCase() == 'path');
            assert.isOk(processPath);
            assert.isOk(vars);
            assert.strictEqual(
                vars![processPath!],
                `${path.dirname(interpreter.uri.fsPath)}${path.delimiter}foobar${path.delimiter}foobaz`
            );
        });

        test('KernelSpec interpreterPath used if interpreter is undefined', async () => {
            when(interpreterService.getInterpreterDetails(anything())).thenResolve({
                envType: EnvironmentType.Conda,
                uri: Uri.file('foopath'),
                sysPrefix: 'foosysprefix'
            });
            when(envActivation.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({
                PATH: 'foobar'
            });
            when(customVariablesService.getCustomEnvironmentVariables(anything())).thenResolve({ PATH: 'foobaz' });

            // undefined for interpreter here, interpreterPath from the spec should be used
            const vars = await kernelVariablesService.getEnvironmentVariables(undefined, undefined, kernelSpec);
            const processPath = Object.keys(process.env).find((k) => k.toLowerCase() == 'path');
            assert.isOk(processPath);
            assert.isOk(vars);
            assert.strictEqual(
                vars![processPath!],
                `${path.dirname(interpreter.uri.fsPath)}${path.delimiter}foobar${path.delimiter}foobaz`
            );
        });

        async function testPYTHONNOUSERSITE(envType: EnvironmentType, shouldBeSet: boolean) {
            when(interpreterService.getInterpreterDetails(anything())).thenResolve({
                envType,
                uri: Uri.file('foopath'),
                sysPrefix: 'foosysprefix'
            });
            when(envActivation.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({
                PATH: 'foobar'
            });
            when(envActivation.hasActivationCommands(anything(), anything())).thenResolve(true);
            when(customVariablesService.getCustomEnvironmentVariables(anything())).thenResolve({ PATH: 'foobaz' });
            when(settings.excludeUserSitePackages).thenReturn(shouldBeSet);

            // undefined for interpreter here, interpreterPath from the spec should be used
            const vars = await kernelVariablesService.getEnvironmentVariables(undefined, undefined, kernelSpec);
            assert.isOk(vars);

            if (shouldBeSet) {
                assert.isOk(vars!['PYTHONNOUSERSITE'], 'PYTHONNOUSERSITE should be set');
            } else {
                assert.isUndefined(vars!['PYTHONNOUSERSITE'], 'PYTHONNOUSERSITE should not be set');
            }
        }

        test('PYTHONNOUSERSITE should not be set for Global Interpreters', async () => {
            await testPYTHONNOUSERSITE(EnvironmentType.Global, false);
        });
        test('PYTHONNOUSERSITE should be set for Conda Env', async () => {
            await testPYTHONNOUSERSITE(EnvironmentType.Conda, true);
        });
        test('PYTHONNOUSERSITE should be set for Virtual Env', async () => {
            await testPYTHONNOUSERSITE(EnvironmentType.VirtualEnv, true);
        });
    });
});
