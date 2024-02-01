// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as os from 'os';
import { anything, instance, mock, when, verify, capture } from 'ts-mockito';
import { FileSystem } from '../../../platform/common/platform/fileSystem.node';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { KernelDependencyService } from '../../kernelDependencyService.node';
import {
    IKernelDependencyService,
    LocalKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../types';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { EXTENSION_ROOT_DIR } from '../../../platform/constants.node';
import * as path from '../../../platform/vscode-path/path';
import { CancellationTokenSource, Uri } from 'vscode';
import { JupyterKernelService } from './jupyterKernelService.node';
import { JupyterPaths } from '../../raw/finder/jupyterPaths.node';
import { DisplayOptions } from '../../displayOptions';
import { IWatchableJupyterSettings } from '../../../platform/common/types';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { JupyterSettings } from '../../../platform/common/configSettings';
import { uriEquals } from '../../../test/datascience/helpers';
import { KernelEnvironmentVariablesService } from '../../raw/launcher/kernelEnvVarsService.node';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { IEnvironmentActivationService } from '../../../platform/interpreter/activation/types';
import { ICustomEnvironmentVariablesProvider } from '../../../platform/common/variables/types';
import { EnvironmentVariablesService } from '../../../platform/common/variables/environment.node';
import { isWeb } from '../../../platform/common/utils/misc';
import { isPythonKernelConnection } from '../../helpers';

// eslint-disable-next-line
suite('JupyterKernelService', () => {
    let kernelService: JupyterKernelService;
    let kernelDependencyService: IKernelDependencyService;
    let appEnv: IEnvironmentActivationService;
    let settings: IWatchableJupyterSettings;
    let fs: IFileSystemNode;
    let testWorkspaceFolder: Uri;
    // PATH variable is forced upper case on Windows
    const pathVariable =
        // eslint-disable-next-line local-rules/dont-use-process
        process.platform === 'win32' ? 'PATH' : Object.keys(process.env).find((k) => k.toLowerCase() == 'path')!;

    // Set of kernels. Generated this by running the localKernelFinder unit test and stringifying
    // the results returned.
    const kernels: LocalKernelConnectionMetadata[] = [
        PythonKernelConnectionMetadata.create({
            kernelSpec: {
                specFile: 'python\\share\\jupyter\\kernels\\interpreter.json',
                interpreterPath: '/usr/bin/python3',
                name: '70cbf3ad892a7619808baecec09fc6109e05177247350ed666cd97ce04371665',
                argv: [
                    os.platform() === 'win32' ? 'python.exe' : 'python',
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ],
                language: 'python',
                executable: os.platform() === 'win32' ? 'python.exe' : 'python',
                display_name: 'Python 3 Environment'
            },
            interpreter: {
                id: '/usr/bin/python3',
                displayName: 'Python 3 Environment',
                uri: Uri.file(os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3')
            },
            id: '0'
        }),
        PythonKernelConnectionMetadata.create({
            kernelSpec: {
                specFile: 'conda\\share\\jupyter\\kernels\\interpreter.json',
                interpreterPath: '/usr/bin/conda/python3',
                name: '92d78b5b048d9cbeebb9834099d399dea5384db6f02b0829c247cc4679e7cb5d',
                argv: [
                    os.platform() === 'win32' ? 'python.exe' : 'python',
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ],
                language: 'python',
                executable: os.platform() === 'win32' ? 'python.exe' : 'python',
                display_name: 'Conda Environment'
            },
            interpreter: {
                id: '/usr/bin/conda/python3',
                displayName: 'Conda Environment',
                uri: Uri.file(os.platform() === 'win32' ? '/usr/bin/conda/python3.exe' : '/usr/bin/conda/python3'),
                envType: EnvironmentType.Conda
            },
            id: '1'
        }),
        PythonKernelConnectionMetadata.create({
            kernelSpec: {
                specFile: '\\usr\\share\\jupyter\\kernels\\python3.json',
                name: 'python3',
                argv: [
                    os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3',
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ],
                language: 'python',
                executable: os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3',
                display_name: 'Python 3 on Disk',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path: os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3',
                        version: { major: 3, minor: 8, raw: '3.8', patch: 0 }
                    }
                }
            },
            interpreter: {
                id: '/usr/bin/python3',
                displayName: 'Python 3 Environment',
                uri: Uri.file(os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3')
            },
            id: '2'
        }),
        LocalKernelSpecConnectionMetadata.create({
            kernelSpec: {
                specFile: '\\usr\\share\\jupyter\\kernels\\julia.json',
                name: 'julia',
                argv: ['/usr/bin/julia'],
                language: 'julia',
                executable: '/usr/bin/julia',
                display_name: 'Julia on Disk'
            },
            id: '3'
        }),
        PythonKernelConnectionMetadata.create({
            kernelSpec: {
                specFile: '\\usr\\share\\jupyter\\kernels\\python2.json',
                name: 'python2',
                argv: [
                    os.platform() === 'win32' ? '/usr/bin/python.exe' : '/usr/bin/python',
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ],
                language: 'python',
                executable: os.platform() === 'win32' ? '/usr/bin/python.exe' : '/usr/bin/python',
                display_name: 'Python 2 on Disk'
            },
            interpreter: {
                id: '/usr/bin/python',
                displayName: 'Python 2 Environment',
                uri: Uri.file(os.platform() === 'win32' ? '/usr/bin/python.exe' : '/usr/bin/python')
            },
            id: '4'
        }),
        PythonKernelConnectionMetadata.create({
            kernelSpec: {
                specFile: '\\usr\\local\\share\\jupyter\\kernels\\python3.json',
                name: 'python3',
                argv: [
                    os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3',
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ],
                language: 'python',
                executable: os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3',
                display_name: 'Python 3 on Disk',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path: os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3',
                        version: { major: 3, minor: 8, raw: '3.8', patch: 0 }
                    }
                }
            },
            interpreter: {
                id: '/usr/bin/python3',
                displayName: 'Python 3 Environment',
                uri: Uri.file(os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3')
            },
            id: '5'
        }),
        LocalKernelSpecConnectionMetadata.create({
            kernelSpec: {
                specFile: '\\usr\\local\\share\\jupyter\\kernels\\julia.json',
                name: 'julia',
                argv: ['/usr/bin/julia'],
                language: 'julia',
                executable: '/usr/bin/julia',
                display_name: 'Julia on Disk'
            },
            id: '6'
        }),
        PythonKernelConnectionMetadata.create({
            kernelSpec: {
                specFile: '\\usr\\local\\share\\jupyter\\kernels\\python2.json',
                name: 'python2',
                argv: [
                    os.platform() === 'win32' ? '/usr/bin/python.exe' : '/usr/bin/python',
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ],
                language: 'python',
                executable: os.platform() === 'win32' ? '/usr/bin/python.exe' : '/usr/bin/python',
                display_name: 'Python 2 on Disk'
            },
            interpreter: {
                id: '/usr/bin/python',
                displayName: 'Python 2 Environment',
                uri: Uri.file(os.platform() === 'win32' ? '/usr/bin/python.exe' : '/usr/bin/python')
            },
            id: '7'
        }),
        PythonKernelConnectionMetadata.create({
            kernelSpec: {
                specFile: 'C:\\Users\\Rich\\.local\\share\\jupyter\\kernels\\python3.json',
                name: 'python3',
                argv: [
                    os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3',
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ],
                language: 'python',
                executable: os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3',
                display_name: 'Python 3 on Disk',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path: os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3',
                        version: { major: 3, minor: 8, raw: '3.8', patch: 0 }
                    }
                }
            },
            interpreter: {
                id: '/usr/bin/python3',
                displayName: 'Python 3 Environment',
                uri: Uri.file(os.platform() === 'win32' ? '/usr/bin/python3.exe' : '/usr/bin/python3')
            },
            id: '8'
        }),
        LocalKernelSpecConnectionMetadata.create({
            kernelSpec: {
                specFile: 'C:\\Users\\Rich\\.local\\share\\jupyter\\kernels\\julia.json',
                name: 'julia',
                argv: ['/usr/bin/julia'],
                language: 'julia',
                executable: '/usr/bin/julia',
                display_name: 'Julia on Disk'
            },
            id: '9'
        }),
        PythonKernelConnectionMetadata.create({
            kernelSpec: {
                specFile: 'C:\\Users\\Rich\\.local\\share\\jupyter\\kernels\\python2.json',
                name: 'python2',
                argv: [
                    os.platform() === 'win32' ? '/usr/bin/python.exe' : '/usr/bin/python',
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ],
                language: 'python',
                executable: os.platform() === 'win32' ? '/usr/bin/python.exe' : '/usr/bin/python',
                display_name: 'Python 2 on Disk'
            },
            interpreter: {
                id: '/usr/bin/python',
                displayName: 'Python 2 Environment',
                uri: Uri.file(os.platform() === 'win32' ? '/usr/bin/python.exe' : '/usr/bin/python')
            },
            id: '10'
        }),
        PythonKernelConnectionMetadata.create({
            kernelSpec: {
                interpreterPath: '/usr/conda/envs/base/python',
                name: 'e10e222d04b8ec3cc7034c3de1b1269b088e2bcd875030a8acab068e59af3990',
                argv: [
                    os.platform() === 'win32' ? 'python.exe' : 'python',
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ],
                language: 'python',
                executable: os.platform() === 'win32' ? 'python.exe' : 'python',
                display_name: 'Conda base environment',
                metadata: {
                    interpreter: {
                        displayName: 'Conda base environment',
                        path: '/usr/conda/envs/base/python',
                        envType: EnvironmentType.Conda
                    }
                },
                env: {},
                specFile:
                    '/usr/share../../kernels/e10e222d04b8ec3cc7034c3de1b1269b088e2bcd875030a8acab068e59af3990/kernel.json'
            },
            interpreter: {
                id: '/usr/conda/envs/base/python',
                displayName: 'Conda base environment',
                uri: Uri.file(
                    os.platform() === 'win32' ? '/usr/conda/envs/base/python.exe' : '/usr/conda/envs/base/python'
                ),
                envType: EnvironmentType.Conda
            },
            id: '11'
        }),
        PythonKernelConnectionMetadata.create({
            kernelSpec: {
                specFile: '/usr/don/home/envs/sample/share../../kernels/sampleEnv/kernel.json',
                name: 'sampleEnv',
                argv: [
                    os.platform() === 'win32'
                        ? '/usr/don/home/envs/sample/bin/python.exe'
                        : '/usr/don/home/envs/sample/bin/python',
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ],
                language: 'python',
                executable:
                    os.platform() === 'win32'
                        ? '/usr/don/home/envs/sample/bin/python.exe'
                        : '/usr/don/home/envs/sample/bin/python',
                display_name: 'Kernel with custom env Variable',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path:
                            os.platform() === 'win32'
                                ? '/usr/don/home/envs/sample/bin/python.exe'
                                : '/usr/don/home/envs/sample/bin/python',
                        version: { major: 3, minor: 8, raw: '3.8', patch: 0 }
                    }
                },
                env: {
                    SOME_ENV_VARIABLE: 'Hello World'
                }
            },
            interpreter: {
                id: '/usr/don/home/envs/sample/bin/python',
                displayName: 'Python 3 Environment',
                uri: Uri.file(
                    os.platform() === 'win32'
                        ? '/usr/don/home/envs/sample/bin/python.exe'
                        : '/usr/don/home/envs/sample/bin/python'
                )
            },
            id: '12'
        }),
        LocalKernelSpecConnectionMetadata.create({
            kernelSpec: {
                specFile: '/usr/don/home/envs/sample/share../../kernels/sampleEnvJulia/kernel.json',
                name: 'sampleEnvJulia',
                argv: ['/usr/don/home/envs/sample/bin/julia'],
                language: 'julia',
                executable:
                    os.platform() === 'win32'
                        ? '/usr/don/home/envs/sample/bin/julia.exe'
                        : '/usr/don/home/envs/sample/bin/julia',
                display_name: 'Julia Kernel with custom env Variable',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path:
                            os.platform() === 'win32'
                                ? '/usr/don/home/envs/sample/bin/python.exe'
                                : '/usr/don/home/envs/sample/bin/python',
                        version: { major: 3, minor: 8, raw: '3.8', patch: 0 }
                    }
                },
                env: {
                    SOME_ENV_VARIABLE: 'Hello World'
                }
            },
            interpreter: {
                id: '/usr/don/home/envs/sample/bin/python',
                displayName: 'Python 3 Environment',
                uri: Uri.file(
                    os.platform() === 'win32'
                        ? '/usr/don/home/envs/sample/bin/python.exe'
                        : '/usr/don/home/envs/sample/bin/python'
                )
            },
            id: '13'
        }),
        LocalKernelSpecConnectionMetadata.create({
            kernelSpec: {
                specFile: '/usr/don/home/envs/sample/share../../kernels/sampleEnvJulia/kernel.json',
                name: 'nameGeneratedByUsWhenRegisteringKernelSpecs',
                argv: ['/usr/don/home/envs/sample/bin/julia'],
                language: 'julia',
                executable: '/usr/don/home/envs/sample/bin/python',
                display_name: 'Julia Kernel with custom env Variable',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path:
                            os.platform() === 'win32'
                                ? '/usr/don/home/envs/sample/bin/python.exe'
                                : '/usr/don/home/envs/sample/bin/python',
                        version: { major: 3, minor: 8, raw: '3.8', patch: 0 }
                    }
                },
                env: {
                    SOME_ENV_VARIABLE: 'Hello World'
                }
            },
            interpreter: {
                id: '/usr/don/home/envs/sample/bin/python',
                displayName: 'Python 3 Environment',
                uri: Uri.file(
                    os.platform() === 'win32'
                        ? '/usr/don/home/envs/sample/bin/python.exe'
                        : '/usr/don/home/envs/sample/bin/python'
                )
            },
            id: '14'
        })
    ];
    suiteSetup(function () {
        if (isWeb()) {
            return this.skip();
        }
    });
    setup(() => {
        kernelDependencyService = mock(KernelDependencyService);
        fs = mock(FileSystem);
        when(fs.exists(anything())).thenCall((p: Uri) => {
            const match = kernels.find((k) => p.fsPath.includes(k.kernelSpec?.name));
            if (match) {
                return Promise.resolve(true);
            }
            return Promise.resolve(false);
        });
        when(fs.readFile(anything())).thenCall((p: Uri) => {
            const match = kernels.find((k) => p.fsPath.includes(k.kernelSpec?.name));
            if (match) {
                return Promise.resolve(JSON.stringify(match.kernelSpec));
            }
            return Promise.reject('Invalid file');
        });
        when(fs.searchLocal(anything(), anything())).thenResolve([]);
        const interpreterService = mock<IInterpreterService>();
        appEnv = mock<IEnvironmentActivationService>();
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({});
        const variablesService = new EnvironmentVariablesService(instance(fs));
        const customEnvVars = mock<ICustomEnvironmentVariablesProvider>();
        when(customEnvVars.getCustomEnvironmentVariables(anything(), anything())).thenResolve();
        when(customEnvVars.getCustomEnvironmentVariables(anything(), anything(), anything())).thenResolve();
        settings = mock(JupyterSettings);
        const configService = mock(ConfigurationService);
        settings = mock(JupyterSettings);
        when(configService.getSettings(anything())).thenReturn(instance(settings));
        const kernelEnvService = new KernelEnvironmentVariablesService(
            instance(interpreterService),
            instance(appEnv),
            variablesService,
            instance(customEnvVars),
            instance(configService)
        );
        testWorkspaceFolder = Uri.file(path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience'));
        const jupyterPaths = mock<JupyterPaths>();
        when(jupyterPaths.getKernelSpecTempRegistrationFolder()).thenResolve(testWorkspaceFolder);
        kernelService = new JupyterKernelService(
            instance(kernelDependencyService),
            instance(fs),
            instance(jupyterPaths),
            kernelEnvService
        );
    });
    test('Dependencies checked on all kernels with interpreters', async () => {
        const token = new CancellationTokenSource();
        await Promise.all(
            kernels.map(async (k) => {
                await kernelService.ensureKernelIsUsable(undefined, k, new DisplayOptions(true), token.token);
            })
        );
        token.dispose();
        verify(kernelDependencyService.installMissingDependencies(anything())).times(
            kernels.filter((k) => k.interpreter && isPythonKernelConnection(k)).length
        );
    });
    test('Kernel installed when spec comes from interpreter', async () => {
        const kernelsWithInvalidName = kernels.filter(
            (k) => k.kernelSpec?.specFile && (k.kernelSpec?.name.length || 0) > 30
        );
        assert.ok(kernelsWithInvalidName.length, 'No kernels found with invalid name');
        assert.ok(kernelsWithInvalidName[0].kernelSpec?.name, 'first kernel does not have a name');
        const kernelSpecPath = path.join(
            testWorkspaceFolder.fsPath,
            kernelsWithInvalidName[0].kernelSpec?.name!,
            'kernel.json'
        );
        when(fs.exists(anything())).thenResolve(false);
        const token = new CancellationTokenSource();
        await kernelService.ensureKernelIsUsable(
            undefined,
            kernelsWithInvalidName[0],
            new DisplayOptions(true),
            token.token
        );
        token.dispose();
        verify(fs.writeFile(uriEquals(kernelSpecPath), anything())).once();
    });

    test('Kernel environment updated with interpreter environment', async () => {
        const kernelsWithInterpreters = kernels.filter((k) => k.interpreter && k.kernelSpec?.metadata?.interpreter);
        let updateCount = 0;
        when(fs.exists(anything())).thenResolve(true);
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({ foo: 'bar' });
        when(fs.writeFile(anything(), anything())).thenCall((f: Uri, c) => {
            if (f.fsPath.endsWith('.json')) {
                const obj = JSON.parse(c);
                if (obj.env.foo && obj.env.foo === 'bar') {
                    updateCount += 1;
                }
            }
            return Promise.resolve();
        });
        const token = new CancellationTokenSource();
        await Promise.all(
            kernelsWithInterpreters.map(async (k) => {
                await kernelService.ensureKernelIsUsable(undefined, k, new DisplayOptions(true), token.token);
            })
        );
        token.dispose();
        assert.equal(updateCount, kernelsWithInterpreters.length, 'Updates to spec files did not occur');
    });

    test('Kernel environment preserves env variables from original Python kernelspec', async () => {
        const spec: LocalKernelConnectionMetadata = kernels.find((item) => item.id === '12')!;
        when(fs.exists(anything())).thenResolve(true);
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({
            foo: 'bar',
            [pathVariable]: `Path1${path.delimiter}Path2`
        });
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything())).thenResolve({
            foo: 'bar',
            [pathVariable]: `Path1${path.delimiter}Path2`
        });
        when(fs.writeFile(anything(), anything())).thenResolve();
        const token = new CancellationTokenSource();
        await kernelService.ensureKernelIsUsable(undefined, spec, new DisplayOptions(true), token.token);
        token.dispose();
        const kernelJson = JSON.parse(capture(fs.writeFile).last()[1].toString());
        assert.strictEqual(kernelJson.env['PYTHONNOUSERSITE'], undefined);
        // Preserve interpreter env variables.
        assert.strictEqual(kernelJson.env['foo'], 'bar');
        // Preserve kernelspec env variables.
        assert.strictEqual(kernelJson.env['SOME_ENV_VARIABLE'], 'Hello World');
        assert.strictEqual(kernelJson.env[pathVariable], `Path1${path.delimiter}Path2`);
    });
    test('Kernel environment preserves env variables from original non-python kernelspec', async () => {
        const spec: LocalKernelConnectionMetadata = kernels.find((item) => item.id === '13')!;
        when(fs.exists(anything())).thenResolve(true);
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({
            foo: 'bar',
            [pathVariable]: `Path1${path.delimiter}Path2`
        });
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything())).thenResolve({
            foo: 'bar',
            [pathVariable]: `Path1${path.delimiter}Path2`
        });
        when(fs.writeFile(anything(), anything())).thenResolve();
        const token = new CancellationTokenSource();
        await kernelService.ensureKernelIsUsable(undefined, spec, new DisplayOptions(true), token.token);
        token.dispose();
        const kernelJson = JSON.parse(capture(fs.writeFile).last()[1].toString());
        assert.strictEqual(kernelJson.env['PYTHONNOUSERSITE'], undefined);
        // Preserve interpreter env variables.
        assert.strictEqual(kernelJson.env['foo'], 'bar');
        // Preserve kernelspec env variables.
        assert.strictEqual(kernelJson.env['SOME_ENV_VARIABLE'], 'Hello World');
        assert.strictEqual(kernelJson.env[pathVariable], `Path1${path.delimiter}Path2`);
    });
    test('Verify registration of the kernelspec', async () => {
        const spec: LocalKernelConnectionMetadata = kernels.find((item) => item.id === '14')!;
        const filesCreated = new Set<string>([spec.kernelSpec.specFile!]);
        when(fs.exists(anything())).thenCall((f: Uri) => Promise.resolve(filesCreated.has(f.fsPath)));
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({
            foo: 'bar',
            [pathVariable]: `Path1${path.delimiter}Path2`
        });
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything())).thenResolve({
            foo: 'bar',
            [pathVariable]: `Path1${path.delimiter}Path2`
        });
        when(fs.writeFile(anything(), anything())).thenCall((f: Uri) => {
            filesCreated.add(f.fsPath);
            return Promise.resolve();
        });
        const token = new CancellationTokenSource();
        await kernelService.ensureKernelIsUsable(undefined, spec, new DisplayOptions(true), token.token);
        token.dispose();
        const kernelJson = JSON.parse(capture(fs.writeFile).last()[1].toString());
        assert.strictEqual(kernelJson.env['PYTHONNOUSERSITE'], undefined);
        // Preserve interpreter env variables.
        assert.strictEqual(kernelJson.env['foo'], 'bar');
        // Preserve kernelspec env variables.
        assert.strictEqual(kernelJson.env['SOME_ENV_VARIABLE'], 'Hello World');
        // Python path must be the first in PATH env variable.
        assert.strictEqual(kernelJson.env[pathVariable], `Path1${path.delimiter}Path2`);
        // capture(fs.localFileExists)
    });
    test('Verify registration of the kernelspec and value PYTHONNOUSERSITE should be true', async () => {
        const spec: LocalKernelConnectionMetadata = kernels.find((item) => item.id === '14')!;
        const filesCreated = new Set<string>([spec.kernelSpec.specFile!]);
        when(fs.exists(anything())).thenCall((f: Uri) => Promise.resolve(filesCreated.has(f.fsPath)));
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({
            foo: 'bar',
            [pathVariable]: `Path1${path.delimiter}Path2`
        });
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything())).thenResolve({
            foo: 'bar',
            [pathVariable]: `Path1${path.delimiter}Path2`
        });
        when(fs.writeFile(anything(), anything())).thenCall((f: Uri) => {
            filesCreated.add(f.fsPath);
            return Promise.resolve();
        });
        when(settings.excludeUserSitePackages).thenReturn(true);
        const token = new CancellationTokenSource();
        await kernelService.ensureKernelIsUsable(undefined, spec, new DisplayOptions(true), token.token);
        token.dispose();
        const kernelJson = JSON.parse(capture(fs.writeFile).last()[1].toString());
        assert.strictEqual(kernelJson.env['PYTHONNOUSERSITE'], 'True');
        // Preserve interpreter env variables.
        assert.strictEqual(kernelJson.env['foo'], 'bar');
        // Preserve kernelspec env variables.
        assert.strictEqual(kernelJson.env['SOME_ENV_VARIABLE'], 'Hello World');
        // Python path must be the first in PATH env variable.
        assert.strictEqual(kernelJson.env[pathVariable], `Path1${path.delimiter}Path2`);
        // capture(fs.localFileExists)
    });
    test('Kernel environment should be updated even when there is no interpreter', async () => {
        const kernelsWithoutInterpreters = kernels.filter((k) => k.interpreter && !k.kernelSpec?.metadata?.interpreter);
        let updateCount = 0;
        when(fs.exists(anything())).thenResolve(true);
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({ foo: 'bar' });
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything())).thenResolve({ foo: 'bar' });
        when(fs.writeFile(anything(), anything())).thenCall((f: Uri, c) => {
            if (f.fsPath.endsWith('.json')) {
                const obj = JSON.parse(c);
                if (obj.env.foo && obj.env.foo === 'bar') {
                    updateCount += 1;
                }
            }
            return Promise.resolve();
        });
        const token = new CancellationTokenSource();
        await Promise.all(
            kernelsWithoutInterpreters.map(async (k) => {
                await kernelService.ensureKernelIsUsable(undefined, k, new DisplayOptions(true), token.token);
            })
        );
        token.dispose();
        assert.equal(updateCount, kernelsWithoutInterpreters.length);
    });
});
