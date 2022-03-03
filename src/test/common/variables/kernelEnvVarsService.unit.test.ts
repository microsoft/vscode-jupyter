// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable  */

import { assert, use } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import { IFileSystem } from '../../../client/common/platform/types';
import { EnvironmentVariablesService } from '../../../client/common/variables/environment';
import { IEnvironmentVariablesProvider } from '../../../client/common/variables/types';
import { KernelEnvironmentVariablesService } from '../../../client/datascience/kernel-launcher/kernelEnvVarsService';
import { IJupyterKernelSpec } from '../../../client/datascience/types';
import { IEnvironmentActivationService } from '../../../client/interpreter/activation/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { EnvironmentType, PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { anything, instance, mock, when } from 'ts-mockito';

use(chaiAsPromised);

suite('Kernel Environment Variables Service', () => {
    let fs: IFileSystem;
    let envActivation: IEnvironmentActivationService;
    let customVariablesService: IEnvironmentVariablesProvider;
    let variablesService: EnvironmentVariablesService;
    let kernelVariablesService: KernelEnvironmentVariablesService;
    let interpreterService: IInterpreterService;
    const interpreter: PythonEnvironment = {
        envType: EnvironmentType.Conda,
        path: 'foobar',
        sysPrefix: '0'
    };
    const kernelSpec: IJupyterKernelSpec = {
        name: 'kernel',
        path: 'foobar',
        display_name: 'kernel',
        interpreterPath: 'foobar',
        argv: []
    };

    setup(() => {
        fs = mock<IFileSystem>();
        envActivation = mock<IEnvironmentActivationService>();
        when(envActivation.hasActivationCommands(anything(), anything())).thenResolve(false);
        customVariablesService = mock<IEnvironmentVariablesProvider>();
        interpreterService = mock<IInterpreterService>();
        variablesService = new EnvironmentVariablesService(instance(fs));
        kernelVariablesService = new KernelEnvironmentVariablesService(
            instance(interpreterService),
            instance(envActivation),
            variablesService,
            instance(customVariablesService)
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
            assert.strictEqual(vars![processPath!], `${path.dirname(interpreter.path)}${path.delimiter}foobar`);
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
                `${path.dirname(interpreter.path)}${path.delimiter}foobar${path.delimiter}foobaz`
            );
        });

        test('KernelSpec interpreterPath used if interpreter is undefined', async () => {
            when(interpreterService.getInterpreterDetails('foobar')).thenResolve({
                envType: EnvironmentType.Conda,
                path: 'foopath',
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
                `${path.dirname(interpreter.path)}${path.delimiter}foobar${path.delimiter}foobaz`
            );
        });

        async function testPYTHONNOUSERSITE(
            envType: EnvironmentType,
            hasActivatedEnvVariables: boolean,
            hasActivationCommands: boolean
        ) {
            when(interpreterService.getInterpreterDetails('foobar')).thenResolve({
                envType,
                path: 'foopath',
                sysPrefix: 'foosysprefix'
            });
            when(envActivation.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve(
                hasActivatedEnvVariables
                    ? {
                          PATH: 'foobar'
                      }
                    : undefined
            );
            when(envActivation.hasActivationCommands(anything(), anything())).thenResolve(hasActivationCommands);
            when(customVariablesService.getCustomEnvironmentVariables(anything())).thenResolve({ PATH: 'foobaz' });

            // undefined for interpreter here, interpreterPath from the spec should be used
            const vars = await kernelVariablesService.getEnvironmentVariables(undefined, undefined, kernelSpec);
            assert.isOk(vars);

            if (hasActivatedEnvVariables && hasActivationCommands) {
                assert.isOk(vars!['PYTHONNOUSERSITE'], 'PYTHONNOUSERSITE should be set');
            } else {
                assert.isUndefined(vars!['PYTHONNOUSERSITE'], 'PYTHONNOUSERSITE should not be set');
            }
        }

        test('PYTHONNOUSERSITE should not be set for Global Interpreters', async () => {
            await testPYTHONNOUSERSITE(EnvironmentType.Global, false, false);
        });
        test('PYTHONNOUSERSITE should be set for Conda Env', async () => {
            await testPYTHONNOUSERSITE(EnvironmentType.Conda, true, true);
        });
        test('PYTHONNOUSERSITE should be set for Virtual Env', async () => {
            await testPYTHONNOUSERSITE(EnvironmentType.VirtualEnv, true, true);
        });
        test('PYTHONNOUSERSITE should not be set for Conda Env if we fail to get env variables', async () => {
            await testPYTHONNOUSERSITE(EnvironmentType.Conda, false, true);
        });
        test('PYTHONNOUSERSITE should not be set for Conda Env if we fail to get activation commands', async () => {
            await testPYTHONNOUSERSITE(EnvironmentType.Conda, true, false);
        });
    });
});
