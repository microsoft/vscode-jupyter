// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, when, verify, capture } from 'ts-mockito';
import { FileSystem } from '../../../../platform/common/platform/fileSystem.node';
import { IFileSystemNode } from '../../../../platform/common/platform/types.node';
import { KernelDependencyService } from '../../../../kernels/kernelDependencyService.node';
import { IKernelDependencyService, LocalKernelConnectionMetadata } from '../../../../kernels/types';
import { EnvironmentType } from '../../../../platform/pythonEnvironments/info';
import { EXTENSION_ROOT_DIR } from '../../../../platform/constants.node';
import * as path from '../../../../platform/vscode-path/path';
import { CancellationTokenSource, Uri } from 'vscode';
import { JupyterKernelService } from '../../../../kernels/jupyter/jupyterKernelService.node';
import { JupyterPaths } from '../../../../kernels/raw/finder/jupyterPaths.node';
import { DisplayOptions } from '../../../../kernels/displayOptions';
import { IWatchableJupyterSettings } from '../../../../platform/common/types';
import { ConfigurationService } from '../../../../platform/common/configuration/service.node';
import { JupyterSettings } from '../../../../platform/common/configSettings';
import { uriEquals } from '../../helpers';
import { KernelEnvironmentVariablesService } from '../../../../kernels/raw/launcher/kernelEnvVarsService.node';
import { IInterpreterService } from '../../../../platform/interpreter/contracts';
import { IEnvironmentActivationService } from '../../../../platform/interpreter/activation/types';
import { ICustomEnvironmentVariablesProvider } from '../../../../platform/common/variables/types';
import { EnvironmentVariablesService } from '../../../../platform/common/variables/environment.node';
import { isWeb } from '../../../../platform/common/utils/misc';

// eslint-disable-next-line
suite('DataScience - JupyterKernelService', () => {
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
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: 'python\\share\\jupyter\\kernels\\interpreter.json',
                interpreterPath: '/usr/bin/python3',
                name: '70cbf3ad892a7619808baecec09fc6109e05177247350ed666cd97ce04371665',
                argv: ['python'],
                language: 'python',
                executable: 'python',
                display_name: 'Python 3 Environment'
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                uri: Uri.file('/usr/bin/python3'),
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '0'
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: 'conda\\share\\jupyter\\kernels\\interpreter.json',
                interpreterPath: '/usr/bin/conda/python3',
                name: '92d78b5b048d9cbeebb9834099d399dea5384db6f02b0829c247cc4679e7cb5d',
                argv: ['python'],
                language: 'python',
                executable: 'python',
                display_name: 'Conda Environment'
            },
            interpreter: {
                displayName: 'Conda Environment',
                uri: Uri.file('/usr/bin/conda/python3'),
                sysPrefix: 'conda',
                envType: EnvironmentType.Conda
            },
            id: '1'
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: '\\usr\\share\\jupyter\\kernels\\python3.json',
                name: 'python3',
                argv: ['/usr/bin/python3'],
                language: 'python',
                executable: '/usr/bin/python3',
                display_name: 'Python 3 on Disk',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path: '/usr/bin/python3',
                        sysPrefix: 'python',
                        version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
                    }
                }
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                uri: Uri.file('/usr/bin/python3'),
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '2'
        },
        {
            kind: 'startUsingLocalKernelSpec',
            kernelSpec: {
                specFile: '\\usr\\share\\jupyter\\kernels\\julia.json',
                name: 'julia',
                argv: ['/usr/bin/julia'],
                language: 'julia',
                executable: '/usr/bin/julia',
                display_name: 'Julia on Disk'
            },
            id: '3'
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: '\\usr\\share\\jupyter\\kernels\\python2.json',
                name: 'python2',
                argv: ['/usr/bin/python'],
                language: 'python',
                executable: '/usr/bin/python',
                display_name: 'Python 2 on Disk'
            },
            interpreter: {
                displayName: 'Python 2 Environment',
                uri: Uri.file('/usr/bin/python'),
                sysPrefix: 'python',
                version: { major: 2, minor: 7, raw: '2.7', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '4'
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: '\\usr\\local\\share\\jupyter\\kernels\\python3.json',
                name: 'python3',
                argv: ['/usr/bin/python3'],
                language: 'python',
                executable: '/usr/bin/python3',
                display_name: 'Python 3 on Disk',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path: '/usr/bin/python3',
                        sysPrefix: 'python',
                        version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
                    }
                }
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                uri: Uri.file('/usr/bin/python3'),
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '5'
        },
        {
            kind: 'startUsingLocalKernelSpec',
            kernelSpec: {
                specFile: '\\usr\\local\\share\\jupyter\\kernels\\julia.json',
                name: 'julia',
                argv: ['/usr/bin/julia'],
                language: 'julia',
                executable: '/usr/bin/julia',
                display_name: 'Julia on Disk'
            },
            id: '6'
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: '\\usr\\local\\share\\jupyter\\kernels\\python2.json',
                name: 'python2',
                argv: ['/usr/bin/python'],
                language: 'python',
                executable: '/usr/bin/python',
                display_name: 'Python 2 on Disk'
            },
            interpreter: {
                displayName: 'Python 2 Environment',
                uri: Uri.file('/usr/bin/python'),
                sysPrefix: 'python',
                version: { major: 2, minor: 7, raw: '2.7', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '7'
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: 'C:\\Users\\Rich\\.local\\share\\jupyter\\kernels\\python3.json',
                name: 'python3',
                argv: ['/usr/bin/python3'],
                language: 'python',
                executable: '/usr/bin/python3',
                display_name: 'Python 3 on Disk',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path: '/usr/bin/python3',
                        sysPrefix: 'python',
                        version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
                    }
                }
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                uri: Uri.file('/usr/bin/python3'),
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '8'
        },
        {
            kind: 'startUsingLocalKernelSpec',
            kernelSpec: {
                specFile: 'C:\\Users\\Rich\\.local\\share\\jupyter\\kernels\\julia.json',
                name: 'julia',
                argv: ['/usr/bin/julia'],
                language: 'julia',
                executable: '/usr/bin/julia',
                display_name: 'Julia on Disk'
            },
            id: '9'
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: 'C:\\Users\\Rich\\.local\\share\\jupyter\\kernels\\python2.json',
                name: 'python2',
                argv: ['/usr/bin/python'],
                language: 'python',
                executable: '/usr/bin/python',
                display_name: 'Python 2 on Disk'
            },
            interpreter: {
                displayName: 'Python 2 Environment',
                uri: Uri.file('/usr/bin/python'),
                sysPrefix: 'python',
                version: { major: 2, minor: 7, raw: '2.7', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '10'
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                interpreterPath: '/usr/conda/envs/base/python',
                name: 'e10e222d04b8ec3cc7034c3de1b1269b088e2bcd875030a8acab068e59af3990',
                argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
                language: 'python',
                executable: 'python',
                display_name: 'Conda base environment',
                metadata: {
                    interpreter: {
                        displayName: 'Conda base environment',
                        path: '/usr/conda/envs/base/python',
                        sysPrefix: 'conda',
                        envType: EnvironmentType.Conda
                    }
                },
                env: {},
                specFile:
                    '/usr/share../../kernels/e10e222d04b8ec3cc7034c3de1b1269b088e2bcd875030a8acab068e59af3990/kernel.json'
            },
            interpreter: {
                displayName: 'Conda base environment',
                uri: Uri.file('/usr/conda/envs/base/python'),
                sysPrefix: 'conda',
                envType: EnvironmentType.Conda
            },
            id: '11'
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: '/usr/don/home/envs/sample/share../../kernels/sampleEnv/kernel.json',
                name: 'sampleEnv',
                argv: ['/usr/don/home/envs/sample/bin/python'],
                language: 'python',
                executable: '/usr/don/home/envs/sample/bin/python',
                display_name: 'Kernel with custom env Variable',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path: '/usr/don/home/envs/sample/bin/python',
                        sysPrefix: 'python',
                        version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
                    }
                },
                env: {
                    SOME_ENV_VARIABLE: 'Hello World'
                }
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                uri: Uri.file('/usr/don/home/envs/sample/bin/python'),
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '12'
        },
        {
            kind: 'startUsingLocalKernelSpec',
            kernelSpec: {
                specFile: '/usr/don/home/envs/sample/share../../kernels/sampleEnvJulia/kernel.json',
                name: 'sampleEnvJulia',
                argv: ['/usr/don/home/envs/sample/bin/julia'],
                language: 'julia',
                executable: '/usr/don/home/envs/sample/bin/python',
                display_name: 'Julia Kernel with custom env Variable',
                metadata: {
                    interpreter: {
                        displayName: 'Python 3 Environment',
                        path: '/usr/don/home/envs/sample/bin/python',
                        sysPrefix: 'python',
                        version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
                    }
                },
                env: {
                    SOME_ENV_VARIABLE: 'Hello World'
                }
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                uri: Uri.file('/usr/don/home/envs/sample/bin/python'),
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '13'
        },
        {
            kind: 'startUsingLocalKernelSpec',
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
                        path: '/usr/don/home/envs/sample/bin/python',
                        sysPrefix: 'python',
                        version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
                    }
                },
                env: {
                    SOME_ENV_VARIABLE: 'Hello World'
                }
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                uri: Uri.file('/usr/don/home/envs/sample/bin/python'),
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '14'
        }
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
        verify(
            kernelDependencyService.installMissingDependencies(
                anything(),
                anything(),
                anything(),
                anything(),
                anything(),
                anything()
            )
        ).times(kernels.filter((k) => k.interpreter).length);
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
        // Python path must be the first in PATH env variable.
        assert.strictEqual(
            kernelJson.env[pathVariable],
            `${path.dirname(spec.interpreter!.uri.fsPath)}${path.delimiter}Path1${path.delimiter}Path2`
        );
    });
    test('Kernel environment preserves env variables from original non-python kernelspec', async () => {
        const spec: LocalKernelConnectionMetadata = kernels.find((item) => item.id === '13')!;
        when(fs.exists(anything())).thenResolve(true);
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({
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
        // Python path must be the first in PATH env variable.
        assert.strictEqual(
            kernelJson.env[pathVariable],
            `${path.dirname(spec.interpreter!.uri.fsPath)}${path.delimiter}Path1${path.delimiter}Path2`
        );
    });
    test('Verify registration of the kernelspec', async () => {
        const spec: LocalKernelConnectionMetadata = kernels.find((item) => item.id === '14')!;
        const filesCreated = new Set<string>([spec.kernelSpec.specFile!]);
        when(fs.exists(anything())).thenCall((f: Uri) => Promise.resolve(filesCreated.has(f.fsPath)));
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({
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
        assert.strictEqual(
            kernelJson.env[pathVariable],
            `${path.dirname(spec.interpreter!.uri.fsPath)}${path.delimiter}Path1${path.delimiter}Path2`
        );
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
        assert.strictEqual(
            kernelJson.env[pathVariable],
            `${path.dirname(spec.interpreter!.uri.fsPath)}${path.delimiter}Path1${path.delimiter}Path2`
        );
        // capture(fs.localFileExists)
    });
    test('Kernel environment should be updated even when there is no interpreter', async () => {
        const kernelsWithoutInterpreters = kernels.filter((k) => k.interpreter && !k.kernelSpec?.metadata?.interpreter);
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
            kernelsWithoutInterpreters.map(async (k) => {
                await kernelService.ensureKernelIsUsable(undefined, k, new DisplayOptions(true), token.token);
            })
        );
        token.dispose();
        assert.equal(updateCount, kernelsWithoutInterpreters.length);
    });
});
