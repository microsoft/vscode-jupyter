// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { when, instance, mock } from 'ts-mockito';
import { Uri } from 'vscode';
import { getDisplayNameOrNameOfKernelConnection } from '../../../kernels/helpers';
import { IJupyterKernelSpec } from '../../../kernels/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';

suite('Notebook Controller Manager', () => {
    test('Live kernels should display the name`', () => {
        const name = getDisplayNameOrNameOfKernelConnection({
            id: '',
            kind: 'connectToLiveRemoteKernel',
            interpreter: undefined,
            kernelModel: {
                model: undefined,
                lastActivityTime: new Date(),
                name: 'livexyz',
                numberOfConnections: 1
            },
            baseUrl: '',
            serverId: ''
        });

        assert.strictEqual(name, 'livexyz');
    });
    suite('Non-python kernels', () => {
        test('Display the name if language is not specified', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path'
                }
            });

            assert.strictEqual(name, 'kspecname');
        });
        test('Display the name if language is not python', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'abc'
                }
            });

            assert.strictEqual(name, 'kspecname');
        });
        test('Display the name even if kernel is inside an unknown Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix'
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name even if kernel is inside a global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envType: EnvironmentType.Global
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is inside a non-global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '',
                    displayName: 'Something',
                    envType: EnvironmentType.Pipenv
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is inside a non-global 64bit Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '',
                    displayName: 'Something 64-bit',
                    envType: EnvironmentType.Pipenv
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Prefixed with `<env name>` kernel is inside a non-global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '.env',
                    displayName: 'Something',
                    envType: EnvironmentType.Conda
                }
            });
            assert.strictEqual(name, 'kspecname (.env)');
        });
        test('Prefixed with `<env name>` kernel is inside a non-global 64-bit Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '.env',
                    displayName: 'Something 64-bit',
                    envType: EnvironmentType.Conda
                }
            });
            assert.strictEqual(name, 'kspecname (.env)');
        });
    });
    suite('Python kernels (started using kernelspec)', () => {
        test('Display name if language is python', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                }
            });

            assert.strictEqual(name, 'kspecname');
        });
        test('Display name even if kernel is associated an unknown Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '.env',
                    displayName: 'Something 64-bit'
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name even if kernel is associated with a global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '.env',
                    displayName: 'Something 64-bit',
                    envType: EnvironmentType.Global
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is associated with a non-global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '',
                    version: undefined,
                    displayName: 'Something',
                    envType: EnvironmentType.Pipenv
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is associated with a non-global 64bit Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '',
                    displayName: 'Something 64-bit',
                    envType: EnvironmentType.Pipenv
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is associated with a non-global 64bit Python environment and includes version', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '',
                    displayName: 'Something 64-bit',
                    version: {
                        build: [],
                        major: 9,
                        minor: 8,
                        patch: 1,
                        prerelease: [],
                        raw: '9.8.7.6-pre'
                    },
                    envType: EnvironmentType.Conda
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Prefixed with `<env name>` kernel is associated with a non-global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '.env',
                    displayName: 'Something 64-bit',
                    version: {
                        build: [],
                        major: 9,
                        minor: 8,
                        patch: 1,
                        prerelease: [],
                        raw: '9.8.7.6-pre'
                    },
                    envType: EnvironmentType.Conda
                }
            });
            assert.strictEqual(name, 'kspecname (Python 9.8.7)');
        });
        test('Prefixed with `<env name>` kernel is associated with a non-global 64-bit Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingLocalKernelSpec',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '.env',
                    displayName: 'Something 64-bit',
                    version: {
                        build: [],
                        major: 9,
                        minor: 8,
                        patch: 1,
                        prerelease: [],
                        raw: '9.8.7.6-pre'
                    },
                    envType: EnvironmentType.Conda
                }
            });
            assert.strictEqual(name, 'kspecname (Python 9.8.7)');
        });
    });
    suite('Python kernels (started using interpreter)', () => {
        test('Return current label if we do not know the type of python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '',
                    displayName: 'Something 64-bit'
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Return current lable if this is a global python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '',
                    displayName: 'Something 64-bit',
                    envType: EnvironmentType.Global
                }
            });
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is associated with a non-global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '',
                    displayName: 'Something',
                    envType: EnvironmentType.Pipenv
                }
            });
            assert.strictEqual(name, 'Python');
        });
        test('DIsplay name if kernel is associated with a non-global 64bit Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection({
                id: '',
                kind: 'startUsingPythonInterpreter',
                kernelSpec: {
                    argv: [],
                    display_name: 'kspecname',
                    name: 'kspec',
                    executable: 'path',
                    language: 'python'
                },
                interpreter: {
                    uri: Uri.file('pyPath'),
                    sysPrefix: 'sysPrefix',
                    envName: '',
                    displayName: 'Something 64-bit',
                    envType: EnvironmentType.Pipenv
                }
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
