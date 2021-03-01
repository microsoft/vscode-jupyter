// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { instance, mock } from 'ts-mockito';
import { FileSystem } from '../../../../client/common/platform/fileSystem';
import { IFileSystem } from '../../../../client/common/platform/types';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { JupyterKernelService } from '../../../../client/datascience/jupyter/kernels/jupyterKernelService';
import { KernelConnectionMetadata } from '../../../../client/datascience/jupyter/kernels/types';
import { LocalKernelFinder } from '../../../../client/datascience/kernel-launcher/localKernelFinder';
import { ILocalKernelFinder } from '../../../../client/datascience/kernel-launcher/types';
import { IEnvironmentActivationService } from '../../../../client/interpreter/activation/types';
import { IKernelDependencyService } from '../../../../client/datascience/types';
import { EnvironmentActivationService } from '../../../../client/api/pythonApi';
import { EnvironmentType } from '../../../../client/pythonEnvironments/info';

// eslint-disable-next-line
suite('DataScience - KernelService', () => {
    let kernelService: JupyterKernelService;
    let kernelDependencyService: IKernelDependencyService;
    let fs: IFileSystem;
    let appEnv: IEnvironmentActivationService;
    let kernelFinder: ILocalKernelFinder;

    // Set of kernels. Generated this by running the localKernelFinder unit test and stringifying
    // the results returned.
    const kernels: KernelConnectionMetadata[] = [
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
            }
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
            }
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: '\\usr\\share\\jupyter\\kernels\\python3.json',
                name: 'python3',
                argv: ['/usr/bin/python3'],
                language: 'python',
                path: '/usr/bin/python3',
                display_name: 'Python 3 on Disk'
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                path: '/usr/bin/python3',
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            }
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
            }
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
            }
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: '\\usr\\local\\share\\jupyter\\kernels\\python3.json',
                name: 'python3',
                argv: ['/usr/bin/python3'],
                language: 'python',
                path: '/usr/bin/python3',
                display_name: 'Python 3 on Disk'
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                path: '/usr/bin/python3',
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            }
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
            }
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
            }
        },
        {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: {
                specFile: 'C:\\Users\\Rich\\.local\\share\\jupyter\\kernels\\python3.json',
                name: 'python3',
                argv: ['/usr/bin/python3'],
                language: 'python',
                path: '/usr/bin/python3',
                display_name: 'Python 3 on Disk'
            },
            interpreter: {
                displayName: 'Python 3 Environment',
                path: '/usr/bin/python3',
                sysPrefix: 'python',
                version: { major: 3, minor: 8, raw: '3.8', build: ['0'], patch: 0, prerelease: ['0'] }
            }
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
            }
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
            }
        }
    ];
    setup(() => {
        kernelDependencyService = mock(KernelDependencyService);
        fs = mock(FileSystem);
        appEnv = mock(EnvironmentActivationService);
        kernelFinder = mock(LocalKernelFinder);
        kernelService = new JupyterKernelService(
            instance(kernelDependencyService),
            instance(fs),
            instance(appEnv),
            instance(kernelFinder)
        );
    });
    test('Dependencies checked on all kernels', async () => {
        await Promise.all(
            kernels.map(async (k) => {
                await kernelService.ensureKernelIsUsable(k, undefined, true);
            })
        );
    });
    test('Kernel installed when no spec file', async () => {
        await kernelService.ensureKernelIsUsable(kernels[0], undefined, true);
    });
    test('Kernel installed when spec comes from interpreter', async () => {
        await kernelService.ensureKernelIsUsable(kernels[0], undefined, true);
    });

    test('Kernel environment updated with interpreter environment', async () => {
        await kernelService.ensureKernelIsUsable(kernels[0], undefined, true);
    });
    test('Kernel environment not updated when not custom interpreter', async () => {
        await kernelService.ensureKernelIsUsable(kernels[0], undefined, true);
    });
});
