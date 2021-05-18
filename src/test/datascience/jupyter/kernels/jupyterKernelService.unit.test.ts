// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, when, verify } from 'ts-mockito';
import { FileSystem } from '../../../../client/common/platform/fileSystem';
import { IFileSystem } from '../../../../client/common/platform/types';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { JupyterKernelService } from '../../../../client/datascience/jupyter/kernels/jupyterKernelService';
import { LocalKernelConnectionMetadata } from '../../../../client/datascience/jupyter/kernels/types';
import { LocalKernelFinder } from '../../../../client/datascience/kernel-launcher/localKernelFinder';
import { ILocalKernelFinder } from '../../../../client/datascience/kernel-launcher/types';
import { IEnvironmentActivationService } from '../../../../client/interpreter/activation/types';
import { IKernelDependencyService } from '../../../../client/datascience/types';
import { EnvironmentActivationService } from '../../../../client/api/pythonApi';
import { EnvironmentType } from '../../../../client/pythonEnvironments/info';
import { EXTENSION_ROOT_DIR } from '../../../../client/constants';
import * as path from 'path';
import { arePathsSame } from '../../../common';

// eslint-disable-next-line
suite('DataScience - JupyterKernelService', () => {
    let kernelService: JupyterKernelService;
    let kernelDependencyService: IKernelDependencyService;
    let fs: IFileSystem;
    let appEnv: IEnvironmentActivationService;
    let kernelFinder: ILocalKernelFinder;
    let testWorkspaceFolder: string;

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
                path: 'python',
                display_name: 'Python 3 Environment'
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                path: '/usr/bin/python3',
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
                path: 'python',
                display_name: 'Conda Environment'
            },
            interpreter: {
                displayName: 'Conda Environment',
                path: '/usr/bin/conda/python3',
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
                path: '/usr/bin/python3',
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
                path: '/usr/bin/python3',
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '2'
        },
        {
            kind: 'startUsingKernelSpec',
            kernelSpec: {
                specFile: '\\usr\\share\\jupyter\\kernels\\julia.json',
                name: 'julia',
                argv: ['/usr/bin/julia'],
                language: 'julia',
                path: '/usr/bin/julia',
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
                path: '/usr/bin/python',
                display_name: 'Python 2 on Disk'
            },
            interpreter: {
                displayName: 'Python 2 Environment',
                path: '/usr/bin/python',
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
                path: '/usr/bin/python3',
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
                path: '/usr/bin/python3',
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '5'
        },
        {
            kind: 'startUsingKernelSpec',
            kernelSpec: {
                specFile: '\\usr\\local\\share\\jupyter\\kernels\\julia.json',
                name: 'julia',
                argv: ['/usr/bin/julia'],
                language: 'julia',
                path: '/usr/bin/julia',
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
                path: '/usr/bin/python',
                display_name: 'Python 2 on Disk'
            },
            interpreter: {
                displayName: 'Python 2 Environment',
                path: '/usr/bin/python',
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
                path: '/usr/bin/python3',
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
                path: '/usr/bin/python3',
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            },
            id: '8'
        },
        {
            kind: 'startUsingKernelSpec',
            kernelSpec: {
                specFile: 'C:\\Users\\Rich\\.local\\share\\jupyter\\kernels\\julia.json',
                name: 'julia',
                argv: ['/usr/bin/julia'],
                language: 'julia',
                path: '/usr/bin/julia',
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
                path: '/usr/bin/python',
                display_name: 'Python 2 on Disk'
            },
            interpreter: {
                displayName: 'Python 2 Environment',
                path: '/usr/bin/python',
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
                path: 'python',
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
                    '/usr/share/jupyter/kernels/e10e222d04b8ec3cc7034c3de1b1269b088e2bcd875030a8acab068e59af3990/kernel.json'
            },
            interpreter: {
                displayName: 'Conda base environment',
                path: '/usr/conda/envs/base/python',
                sysPrefix: 'conda',
                envType: EnvironmentType.Conda
            },
            id: '11'
        }
    ];
    setup(() => {
        kernelDependencyService = mock(KernelDependencyService);
        fs = mock(FileSystem);
        when(fs.localFileExists(anything())).thenCall((p) => {
            const match = kernels.find((k) => p.includes(k.kernelSpec?.name));
            if (match) {
                return Promise.resolve(true);
            }
            return Promise.resolve(false);
        });
        when(fs.readLocalFile(anything())).thenCall((p) => {
            const match = kernels.find((k) => p.includes(k.kernelSpec?.name));
            if (match) {
                return Promise.resolve(JSON.stringify(match.kernelSpec));
            }
            return Promise.reject('Invalid file');
        });
        when(fs.areLocalPathsSame(anything(), anything())).thenCall((a, b) => arePathsSame(a, b));
        when(fs.searchLocal(anything(), anything())).thenResolve([]);
        appEnv = mock(EnvironmentActivationService);
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({});
        kernelFinder = mock(LocalKernelFinder);
        testWorkspaceFolder = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience');
        when(kernelFinder.getKernelSpecRootPath()).thenResolve(testWorkspaceFolder);
        kernelService = new JupyterKernelService(
            instance(kernelDependencyService),
            instance(fs),
            instance(appEnv),
            instance(kernelFinder)
        );
    });
    test('Dependencies checked on all kernels with interpreters', async () => {
        await Promise.all(
            kernels.map(async (k) => {
                await kernelService.ensureKernelIsUsable(undefined, k, undefined, true);
            })
        );
        verify(kernelDependencyService.installMissingDependencies(anything(), anything(), anything())).times(
            kernels.filter((k) => k.interpreter).length
        );
    });
    test('Kernel installed when spec comes from interpreter', async () => {
        const kernelsWithInvalidName = kernels.filter(
            (k) => k.kernelSpec?.specFile && (k.kernelSpec?.name.length || 0) > 30
        );
        assert.ok(kernelsWithInvalidName.length, 'No kernels found with invalid name');
        assert.ok(kernelsWithInvalidName[0].kernelSpec?.name, 'first kernel does not have a name');
        const kernelSpecPath = path.join(
            testWorkspaceFolder,
            kernelsWithInvalidName[0].kernelSpec?.name!,
            'kernel.json'
        );
        when(fs.localFileExists(anything())).thenResolve(false);
        await kernelService.ensureKernelIsUsable(undefined, kernelsWithInvalidName[0], undefined, true);
        verify(fs.writeLocalFile(kernelSpecPath, anything())).once();
    });

    test('Kernel environment updated with interpreter environment', async () => {
        const kernelsWithInterpreters = kernels.filter((k) => k.interpreter && k.kernelSpec?.metadata?.interpreter);
        let updateCount = 0;
        when(fs.localFileExists(anything())).thenResolve(true);
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({ foo: 'bar' });
        when(fs.writeLocalFile(anything(), anything())).thenCall((f, c) => {
            if (f.endsWith('.json')) {
                const obj = JSON.parse(c);
                if (obj.env.foo && obj.env.foo === 'bar') {
                    updateCount += 1;
                }
            }
            return Promise.resolve();
        });
        await Promise.all(
            kernelsWithInterpreters.map(async (k) => {
                await kernelService.ensureKernelIsUsable(undefined, k, undefined, true);
            })
        );
        assert.equal(updateCount, kernelsWithInterpreters.length, 'Updates to spec files did not occur');
    });
    test('Kernel environment not updated when not custom interpreter', async () => {
        const kernelsWithoutInterpreters = kernels.filter((k) => k.interpreter && !k.kernelSpec?.metadata?.interpreter);
        let updateCount = 0;
        when(appEnv.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenResolve({ foo: 'bar' });
        when(fs.localFileExists(anything())).thenResolve(true);
        when(fs.writeLocalFile(anything(), anything())).thenCall((f, c) => {
            if (f.endsWith('.json')) {
                const obj = JSON.parse(c);
                if (obj.env.foo && obj.env.foo === 'bar') {
                    updateCount += 1;
                }
            }
            return Promise.resolve();
        });
        await Promise.all(
            kernelsWithoutInterpreters.map(async (k) => {
                await kernelService.ensureKernelIsUsable(undefined, k, undefined, true);
            })
        );
        assert.equal(updateCount, 0, 'Should not have updated spec files when no interpreter metadata');
    });
});
