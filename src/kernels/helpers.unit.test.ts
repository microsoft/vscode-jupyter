// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { assert } from 'chai';
import { when, instance, mock } from 'ts-mockito';
import { Uri } from 'vscode';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import {
    IJupyterKernelSpec,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from './types';
import { EnvironmentType, PythonEnvironment } from '../platform/pythonEnvironments/info';
import { PythonExtension } from '@vscode/python-extension';
import { resolvableInstance } from '../test/datascience/helpers';
import { dispose } from '../platform/common/utils/lifecycle';
import { setPythonApi } from '../platform/interpreter/helpers';

suite('Kernel Connection Helpers', () => {
    let environments: PythonExtension['environments'];
    let disposables: { dispose: () => void }[] = [];
    setup(() => {
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
    });
    test('Live kernels should display the name`', () => {
        const name = getDisplayNameOrNameOfKernelConnection(
            LiveRemoteKernelConnectionMetadata.create({
                id: '',
                interpreter: undefined,
                kernelModel: {
                    model: undefined,
                    lastActivityTime: new Date(),
                    name: 'livexyz',
                    numberOfConnections: 1
                },
                baseUrl: '',
                serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
            })
        );

        assert.strictEqual(name, 'livexyz');
    });
    suite('Non-python kernels', () => {
        test('Display the name if language is not specified', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path'
                    }
                })
            );

            assert.strictEqual(name, 'kspecname');
        });
        test('Display the name if language is not python', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'abc'
                    }
                })
            );

            assert.strictEqual(name, 'kspecname');
        });
        test('Display the name even if kernel is inside an unknown Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix'
                    }
                })
            );
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name even if kernel is inside a global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envType: EnvironmentType.Unknown
                    }
                })
            );
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is inside a non-global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '',
                        displayName: 'Something',
                        envType: EnvironmentType.Pipenv
                    }
                })
            );
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is inside a non-global 64bit Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '',
                        displayName: 'Something 64-bit',
                        envType: EnvironmentType.Pipenv
                    }
                })
            );
            assert.strictEqual(name, 'kspecname');
        });
        test('Prefixed with `<env name>` kernel is inside a non-global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '.env',
                        displayName: 'Something',
                        envType: EnvironmentType.Conda
                    }
                })
            );
            assert.strictEqual(name, 'kspecname (.env)');
        });
        test('Prefixed with `<env name>` kernel is inside a non-global 64-bit Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '.env',
                        displayName: 'Something 64-bit',
                        envType: EnvironmentType.Conda
                    }
                })
            );
            assert.strictEqual(name, 'kspecname (.env)');
        });
    });
    suite('Python kernels (started using kernelspec)', () => {
        test('Display name if language is python', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    }
                })
            );

            assert.strictEqual(name, 'kspecname');
        });
        test('Display name even if kernel is associated an unknown Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '.env',
                        displayName: 'Something 64-bit'
                    }
                })
            );
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name even if kernel is associated with a global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '.env',
                        displayName: 'Something 64-bit',
                        envType: EnvironmentType.Unknown
                    }
                })
            );
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is associated with a non-global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '1',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '',
                        version: undefined,
                        displayName: 'Something',
                        envType: EnvironmentType.Pipenv
                    }
                })
            );
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is associated with a non-global 64bit Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '',
                        displayName: 'Something 64-bit',
                        envType: EnvironmentType.Pipenv
                    }
                })
            );
            assert.strictEqual(name, 'kspecname');
        });
        test('Display name if kernel is associated with a non-global 64bit Python environment and includes version', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '',
                        displayName: 'Something 64-bit',
                        version: {
                            major: 9,
                            minor: 8,
                            patch: 1,
                            raw: '9.8.7.6-pre'
                        },
                        envType: EnvironmentType.Conda
                    }
                })
            );
            assert.strictEqual(name, 'kspecname');
        });
        test('Prefixed with `<env name>` kernel is associated with a non-global Python environment', () => {
            when(environments.known).thenReturn([
                {
                    id: Uri.file('pyPath').fsPath,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7.6-pre'
                    }
                } as any
            ]);
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '.env',
                        displayName: 'Something 64-bit',
                        version: {
                            major: 9,
                            minor: 8,
                            patch: 7,
                            raw: '9.8.7.6-pre'
                        },
                        envType: EnvironmentType.Conda
                    }
                })
            );
            assert.strictEqual(name, 'kspecname (Python 9.8.7)');
        });
        test('Prefixed with `<env name>` kernel is associated with a non-global 64-bit Python environment', () => {
            when(environments.known).thenReturn([
                {
                    id: Uri.file('pyPath').fsPath,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7'
                    }
                } as any
            ]);
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '.env',
                        displayName: 'Something 64-bit',
                        version: {
                            major: 9,
                            minor: 8,
                            patch: 7,
                            raw: '9.8.7.6-pre'
                        },
                        envType: EnvironmentType.Conda
                    }
                })
            );
            assert.strictEqual(name, 'kspecname (Python 9.8.7)');
        });
    });
    suite('Python kernels (started using interpreter)', () => {
        test('Return current label if we do not know the type of python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '',
                        displayName: 'Something 64-bit'
                    }
                })
            );
            assert.strictEqual(name, 'kspecname');
        });
        test('Return Python Version for global python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                PythonKernelConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '',
                        displayName: 'Something 64-bit',
                        envType: EnvironmentType.Unknown
                    }
                })
            );
            assert.strictEqual(name, 'Python');
        });
        test('Return Python Version for global python environment with a version', () => {
            when(environments.known).thenReturn([
                {
                    id: Uri.file('pyPath').fsPath,
                    version: {
                        major: 1,
                        minor: 2,
                        micro: 3,
                        release: undefined,
                        sysVersion: '1.2.3'
                    }
                } as any
            ]);
            const name = getDisplayNameOrNameOfKernelConnection(
                PythonKernelConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '',
                        version: { major: 1, minor: 2, patch: 3, raw: '1.2.3' },
                        displayName: 'Something 64-bit',
                        envType: EnvironmentType.Unknown
                    }
                })
            );
            assert.strictEqual(name, 'Python 1.2.3');
        });
        test('Display name if kernel is associated with a non-global Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                PythonKernelConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '',
                        displayName: 'Something',
                        envType: EnvironmentType.Pipenv
                    }
                })
            );
            assert.strictEqual(name, 'Python');
        });
        test('DIsplay name if kernel is associated with a non-global 64bit Python environment', () => {
            const name = getDisplayNameOrNameOfKernelConnection(
                PythonKernelConnectionMetadata.create({
                    id: '',
                    kernelSpec: {
                        argv: [],
                        display_name: 'kspecname',
                        name: 'kspec',
                        executable: 'path',
                        language: 'python'
                    },
                    interpreter: {
                        uri: Uri.file('pyPath'),
                        id: Uri.file('pyPath').fsPath,
                        sysPrefix: 'sysPrefix',
                        envName: '',
                        displayName: 'Something 64-bit',
                        envType: EnvironmentType.Pipenv
                    }
                })
            );
            assert.strictEqual(name, 'Python');
        });
        test('Display name if kernel is associated with a non-global 64bit Python environment and includes version', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.id).thenReturn('xyz');
            when(interpreter.envName).thenReturn('');
            when(interpreter.version).thenReturn({
                major: 9,
                minor: 8,
                patch: 1,
                raw: '9.8.7.6-pre'
            });
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Pipenv);
            when(environments.known).thenReturn([
                {
                    id: instance(interpreter).id,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7.6-pre'
                    }
                } as any
            ]);

            const name = getDisplayNameOrNameOfKernelConnection(
                PythonKernelConnectionMetadata.create({
                    id: '',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                })
            );
            assert.strictEqual(name, 'Python 9.8.7');
        });
        test('Prefixed with `<env name>` kernel is associated with a non-global Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.id).thenReturn('xyz');
            when(interpreter.envName).thenReturn('.env');
            when(interpreter.version).thenReturn({
                major: 9,
                minor: 8,
                patch: 7,
                raw: '9.8.7.6-pre'
            });
            when(interpreter.displayName).thenReturn('Something');
            when(interpreter.envType).thenReturn(EnvironmentType.Conda);
            when(environments.known).thenReturn([
                {
                    id: instance(interpreter).id,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7.6-pre'
                    }
                } as any
            ]);

            const name = getDisplayNameOrNameOfKernelConnection(
                PythonKernelConnectionMetadata.create({
                    id: '',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                })
            );
            assert.strictEqual(name, '.env (Python 9.8.7)');
        });
        test('Prefixed with `<env name>` kernel is associated with a non-global 64-bit Python environment', () => {
            const kernelSpec = mock<IJupyterKernelSpec>();
            const interpreter = mock<PythonEnvironment>();
            when(kernelSpec.language).thenReturn('python');
            when(interpreter.id).thenReturn('xyz');
            when(interpreter.envName).thenReturn('.env');
            when(interpreter.version).thenReturn({
                major: 9,
                minor: 8,
                patch: 7,
                raw: '9.8.7.6-pre'
            });
            when(interpreter.displayName).thenReturn('Something 64-bit');
            when(interpreter.envType).thenReturn(EnvironmentType.Conda);
            when(environments.known).thenReturn([
                {
                    id: instance(interpreter).id,
                    version: {
                        major: 9,
                        minor: 8,
                        micro: 7,
                        release: undefined,
                        sysVersion: '9.8.7.6-pre'
                    }
                } as any
            ]);

            const name = getDisplayNameOrNameOfKernelConnection(
                PythonKernelConnectionMetadata.create({
                    id: '',
                    kernelSpec: instance(kernelSpec),
                    interpreter: instance(interpreter)
                })
            );
            assert.strictEqual(name, '.env (Python 9.8.7)');
        });
    });
});
