// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import { when, instance, mock } from 'ts-mockito';
import { LiveKernelModel } from '../../../client/datascience/jupyter/kernels/types';
import { getControllerDisplayName } from '../../../client/datascience/notebook/notebookControllerManager';
import { IJupyterKernelSpec } from '../../../client/datascience/types';
import { EnvironmentType, PythonEnvironment } from '../../../client/pythonEnvironments/info';

suite('Notebook Controller Manager', () => {
    test('Live kernels should be prefixed with `Jupyter Kenrel`', () => {
        const name = getControllerDisplayName(
            { id: '', kind: 'connectToLiveKernel', kernelModel: instance(mock<LiveKernelModel>()) },
            'Current Name'
        );

        assert.strictEqual(name, 'Jupyter Kernel (Current Name)');
    });
    suite('Non-pyhton kernels', () => {
        test('Prefixed with `Jupyter Kernel` if language is not specified', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            when(kernelSpec.language).thenReturn();

            const name = getControllerDisplayName(
                { id: '', kind: 'startUsingKernelSpec', kernelSpec: instance(kernelSpec) },
                'Current Name'
            );

            assert.strictEqual(name, 'Jupyter Kernel (Current Name)');
        });
        test('Prefixed with `Jupyter Kernel` if language is not python', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            when(kernelSpec.language).thenReturn('abc');

            const name = getControllerDisplayName(
                { id: '', kind: 'startUsingKernelSpec', kernelSpec: instance(kernelSpec) },
                'Current Name'
            );

            assert.strictEqual(name, 'Jupyter Kernel (Current Name)');
        });
        test('Prefixed with `Jupyter Kernel` even if kernel is inside an unknown Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envType).thenReturn();

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Jupyter Kernel (Current Name)');
        });
        test('Prefixed with `Jupyter Kernel` even if kernel is inside a global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envType).thenReturn(EnvironmentType.Global);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Jupyter Kernel (Current Name)');
        });
        test('Prefixed with `<env type>` kernel is inside a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envName).thenReturn('');
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'PipEnv (Current Name)');
        });
        test('Prefixed with `<env type>` kernel is inside a non-global 64bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envName).thenReturn('');
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'PipEnv (Current Name)');
        });
        test('Prefixed with `<env type> <env name>` kernel is inside a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envName).thenReturn('.env');
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Conda);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Conda .env (Current Name)');
        });
        test('Prefixed with `<env type> <env name>` kernel is inside a non-global 64-bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn();
            when(interpreter.envName).thenReturn('.env');
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Conda);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Conda .env (Current Name)');
        });
    });
    suite('Pyhton kernels (started using kernelspec)', () => {
        test('Prefixed with `Jupyter Kernel` if language is python', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            when(kernelSpec.language).thenReturn('python');

            const name = getControllerDisplayName(
                { id: '', kind: 'startUsingKernelSpec', kernelSpec: instance(kernelSpec) },
                'Current Name'
            );

            assert.strictEqual(name, 'Jupyter Kernel (Current Name)');
        });
        test('Prefixed with `Jupyter Kernel` even if kernel is asscociated an unknown Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envType).thenReturn();

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Jupyter Kernel (Current Name)');
        });
        test('Prefixed with `Jupyter Kernel` even if kernel is associated with a global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envType).thenReturn(EnvironmentType.Global);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Jupyter Kernel (Current Name)');
        });
        test('Prefixed with `<env type>` kernel is associated with a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn();
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'PipEnv (Python)');
        });
        test('Prefixed with `<env type>` kernel is associated with a non-global 64bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn();
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'PipEnv (Python 64-bit)');
        });
        test('Prefixed with `<env type>` kernel is associated with a non-global 64bit Python environment and includes version', () => {
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

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'PipEnv (Python 9.8.7 64-bit)');
        });
        test('Prefixed with `<env type> <env name>` kernel is associated with a non-global Python environment', () => {
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

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Conda .env (Python 9.8.7)');
        });
        test('Prefixed with `<env type> <env name>` kernel is associated with a non-global 64-bit Python environment', () => {
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

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Conda .env (Python 9.8.7 64-bit)');
        });
    });
    suite('Pyhton kernels (started using interpreter)', () => {
        test('Return current label if we do nott know the type of python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envType).thenReturn();

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingPythonInterpreter',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Current Name');
        });
        test('Return current lable if this is a global python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envType).thenReturn(EnvironmentType.Global);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingPythonInterpreter',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Current Name');
        });
        test('Prefixed with `<env type>` kernel is associated with a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn();
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingPythonInterpreter',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'PipEnv (Python)');
        });
        test('Prefixed with `<env type>` kernel is associated with a non-global 64bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn();
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingPythonInterpreter',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'PipEnv (Python 64-bit)');
        });
        test('Prefixed with `<env type>` kernel is associated with a non-global 64bit Python environment and includes version', () => {
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

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingPythonInterpreter',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'PipEnv (Python 9.8.7 64-bit)');
        });
        test('Prefixed with `<env type> <env name>` kernel is associated with a non-global Python environment', () => {
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

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Conda .env (Python 9.8.7)');
        });
        test('Prefixed with `<env type> <env name>` kernel is associated with a non-global 64-bit Python environment', () => {
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

            const name = getControllerDisplayName(
                {
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                },
                'Current Name'
            );
            assert.strictEqual(name, 'Conda .env (Python 9.8.7 64-bit)');
        });
    });
});
