// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import { when, instance, mock } from 'ts-mockito';
import { getDisplayNameOrNameOfKernelConnection } from '../../../client/datascience/jupyter/kernels/helpers';
import { IJupyterKernelSpec } from '../../../client/datascience/types';
import { EnvironmentType, PythonEnvironment } from '../../../client/pythonEnvironments/info';

suite.only('Notebook Controller Manager', () => {
    test('Live kernels should display the name`', () => {
        const name = getDisplayNameOrNameOfKernelConnection({
            id: '',
            kind: 'connectToLiveKernel',
            interpreter: undefined,
            kernelModel: {
                model: undefined,
                lastActivityTime: new Date(),
                name: 'livexyz',
                numberOfConnections: 1
            }
        });

        assert.strictEqual(name, 'livexyz');
    });
    suite('Non-python kernels', () => {
        test('Display the name if language is not specified', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: {
                    argv:[],
                    display_name:'kspecname',
                    name:'kspec',
                    path:'path'
                }
            });

            assert.strictEqual(name, 'livexyz');
        });
        test('Display the name if language is not python', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            when(kernelSpec.language).thenReturn('abc');

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec)
            });

            assert.strictEqual(name, 'Current Name');
        });
        test('Display the name even if kernel is inside an unknown Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envType).thenReturn();

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Display name even if kernel is inside a global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envType).thenReturn(EnvironmentType.Global);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Display name if kernel is inside a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envName).thenReturn('');
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Display name if kernel is inside a non-global 64bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envName).thenReturn('');
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Prefixed with `<env name>` kernel is inside a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envName).thenReturn('.env');
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Conda);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name (.env)');
        });
        test('Prefixed with `<env name>` kernel is inside a non-global 64-bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envName).thenReturn('.env');
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Conda);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name (.env)');
        });
    });
    suite('Python kernels (started using kernelspec)', () => {
        test('Display name if language is python', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            when(kernelSpec.language).thenReturn('python');

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec)
            });

            assert.strictEqual(name, 'Current Name');
        });
        test('Display name even if kernel is associated an unknown Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envType).thenReturn();

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Display name even if kernel is associated with a global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envType).thenReturn(EnvironmentType.Global);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Display name if kernel is associated with a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn();
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Display name if kernel is associated with a non-global 64bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn();
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Display name if kernel is associated with a non-global 64bit Python environment and includes version', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn({
                build: [],
                major: 9,
                minor: 8,
                patch: 1,
                prerelease: [],
                raw: '9.8.7.6-pre'
            });
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Prefixed with `<env name>` kernel is associated with a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('.env');
            when(interpreter.version).thenReturn({
                build: [],
                major: 9,
                minor: 8,
                patch: 1,
                prerelease: [],
                raw: '9.8.7.6-pre'
            });
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Conda);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name (Python 9.8.7)');
        });
        test('Prefixed with `<env name>` kernel is associated with a non-global 64-bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('.env');
            when(interpreter.version).thenReturn({
                build: [],
                major: 9,
                minor: 8,
                patch: 1,
                prerelease: [],
                raw: '9.8.7.6-pre'
            });
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Conda);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingKernelSpec',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name (Python 9.8.7)');
        });
    });
    suite('Python kernels (started using interpreter)', () => {
        test('Return current label if we do not know the type of python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envType).thenReturn();

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Return current lable if this is a global python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envType).thenReturn(EnvironmentType.Global);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Current Name');
        });
        test('Display name if kernel is associated with a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn();
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Python');
        });
        test('DIsplay name if kernel is associated with a non-global 64bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn();
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Python');
        });
        test('Display name if kernel is associated with a non-global 64bit Python environment and includes version', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn({
                build: [],
                major: 9,
                minor: 8,
                patch: 1,
                prerelease: [],
                raw: '9.8.7.6-pre'
            });
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, 'Python 9.8.7');
        });
        test('Prefixed with `<env name>` kernel is associated with a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('.env');
            when(interpreter.version).thenReturn({
                build: [],
                major: 9,
                minor: 8,
                patch: 1,
                prerelease: [],
                raw: '9.8.7.6-pre'
            });
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Conda);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, '.env (Python 9.8.7)');
        });
        test('Prefixed with `<env name>` kernel is associated with a non-global 64-bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('.env');
            when(interpreter.version).thenReturn({
                build: [],
                major: 9,
                minor: 8,
                patch: 1,
                prerelease: [],
                raw: '9.8.7.6-pre'
            });
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Conda);

            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: instance(kernelSpec),
                interpreter: instance(interpreter)
            });
            assert.strictEqual(name, '.env (Python 9.8.7)');
        });
    });
});
