/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { assert } from 'chai';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import { PathUtils } from '../../../client/common/platform/pathUtils';
import { IFileSystem, IPlatformService } from '../../../client/common/platform/types';
import { LocalKernelFinder } from '../../../client/datascience/kernel-launcher/localKernelFinder';
import { ILocalKernelFinder } from '../../../client/datascience/kernel-launcher/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { WorkspaceService } from '../../../client/common/application/workspace';
import { EnvironmentVariablesProvider } from '../../../client/common/variables/environmentVariablesProvider';
import { InterpreterService, PythonExtensionChecker } from '../../../client/api/pythonApi';
import {
    getDisplayNameOrNameOfKernelConnection,
    getInterpreterKernelSpecName
} from '../../../client/datascience/jupyter/kernels/helpers';
import { PlatformService } from '../../../client/common/platform/platformService';
import { EXTENSION_ROOT_DIR } from '../../../client/constants';
import { FileSystem } from '../../../client/common/platform/fileSystem';
import type { Kernel } from '@jupyterlab/services';
import { EnvironmentType, PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { IPythonExtensionChecker } from '../../../client/api/types';
import { PYTHON_LANGUAGE } from '../../../client/common/constants';
import { arePathsSame } from '../../common';
import { Uri } from 'vscode';
import { getInterpreterHash } from '../../../client/pythonEnvironments/info/interpreter';
import { IExtensions } from '../../../client/common/types';

[false, true].forEach((isWindows) => {
    suite(`Local Kernel Finder ${isWindows ? 'Windows' : 'Unix'}`, () => {
        let kernelFinder: ILocalKernelFinder;
        let interpreterService: IInterpreterService;
        let platformService: IPlatformService;
        let fs: IFileSystem;
        let extensionChecker: IPythonExtensionChecker;
        let extensions: IExtensions;
        const defaultPython3Name = 'python3';
        const pyEnvInterpreter: PythonEnvironment = {
            displayName: 'Python 3 Environment for PyEnv',
            path: '/users/username/pyenv/envs/temp/python',
            sysPrefix: 'python',
            version: {
                major: 3,
                minor: 8,
                raw: '3.8',
                build: ['0'],
                patch: 0,
                prerelease: ['0']
            }
        };
        const pyEnvInterpreter2: PythonEnvironment = {
            displayName: 'Python 3 Environment for PyEnv',
            path: '/users/username/pyenv/envs/temp2/python',
            sysPrefix: 'python',
            version: {
                major: 3,
                minor: 8,
                raw: '3.8',
                build: ['0'],
                patch: 0,
                prerelease: ['0']
            }
        };
        const pyEnvInterpreter3: PythonEnvironment = {
            displayName: 'Python 3 on Disk',
            path: '/users/username/pyenv/envs/temp3/python',
            sysPrefix: 'python',
            version: {
                major: 3,
                minor: 8,
                raw: '3.8',
                build: ['0'],
                patch: 0,
                prerelease: ['0']
            }
        };
        const python3Interpreter: PythonEnvironment = {
            displayName: 'Python 3 Environment',
            path: '/usr/bin/python3',
            sysPrefix: 'python',
            version: {
                major: 3,
                minor: 8,
                raw: '3.8',
                build: ['0'],
                patch: 0,
                prerelease: ['0']
            }
        };
        const python2Interpreter: PythonEnvironment = {
            displayName: 'Python 2 Environment',
            path: '/usr/bin/python',
            sysPrefix: 'python',
            version: {
                major: 2,
                minor: 7,
                raw: '2.7',
                build: ['0'],
                patch: 0,
                prerelease: ['0']
            }
        };
        const condaEnvironment: PythonEnvironment = {
            displayName: 'Conda Environment',
            path: '/usr/bin/conda/python3',
            sysPrefix: 'conda',
            envType: EnvironmentType.Conda
        };
        const pyEnvPython3spec: Kernel.ISpecModel = {
            display_name: 'Python 3 on Disk',
            name: 'python38664bitpyenv87d47e496650464eac2bd1421064a987',
            argv: ['/users/username/pyenv/envs/temp/python'],
            language: 'python',
            resources: {},
            metadata: {
                interpreter: pyEnvInterpreter
            }
        };
        const pyEnvUsingNewNamesPython3spec: Kernel.ISpecModel = {
            display_name: 'Python 3 on Disk',
            name: 'pythonjvsc74a57bd0857c2ac1a2d121b2884435ca7334db9e850ee37c2dd417fb5029a40e4d8390b5',
            argv: ['/users/username/pyenv/envs/temp2/python'],
            language: 'python',
            resources: {}
        };
        const python3spec: Kernel.ISpecModel = {
            display_name: 'Python 3 on Disk',
            name: defaultPython3Name,
            argv: ['/usr/bin/python3'],
            language: 'python',
            resources: {},
            metadata: {
                interpreter: python3Interpreter
            }
        };
        const python3DupeSpec: Kernel.ISpecModel = {
            display_name: 'Python 3 on Disk',
            name: defaultPython3Name,
            argv: ['/usr/bin/python3'],
            language: 'python',
            resources: {},
            metadata: {
                interpreter: python3Interpreter
            }
        };
        const python2spec: Kernel.ISpecModel = {
            display_name: 'Python 2 on Disk',
            name: 'python2',
            argv: ['/usr/bin/python'],
            language: 'python',
            resources: {}
        };
        const juliaSpec: Kernel.ISpecModel = {
            display_name: 'Julia on Disk',
            name: 'julia',
            argv: ['/usr/bin/julia'],
            language: 'julia',
            resources: {}
        };
        const interpreterSpec: Kernel.ISpecModel = {
            display_name: 'Conda interpreter kernel',
            name: defaultPython3Name,
            argv: ['python'],
            language: 'python',
            resources: {}
        };
        const condaEnvironmentBase: PythonEnvironment = {
            displayName: 'Conda base environment',
            path: '/usr/conda/envs/base/python',
            sysPrefix: 'conda',
            envType: EnvironmentType.Conda
        };

        setup(() => {
            const getRealPathStub = sinon.stub(fsExtra, 'realpath');
            getRealPathStub.returnsArg(0);
            interpreterService = mock(InterpreterService);
            when(interpreterService.getInterpreters(anything())).thenResolve([]);
            when(interpreterService.getInterpreterDetails(anything())).thenResolve();
            platformService = mock(PlatformService);
            when(platformService.isWindows).thenReturn(isWindows);
            when(platformService.isLinux).thenReturn(!isWindows);
            when(platformService.isMac).thenReturn(false);
            extensions = mock<IExtensions>();
            when(extensions.getExtension(anything())).thenReturn();
            fs = mock(FileSystem);
            when(fs.localFileExists(anything())).thenResolve(true);
            const pathUtils = new PathUtils(isWindows);
            const workspaceService = mock(WorkspaceService);
            const testWorkspaceFolder = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience');

            when(workspaceService.getWorkspaceFolderIdentifier(anything(), anything())).thenCall((_a, b) => {
                return Promise.resolve(b);
            });
            when(workspaceService.rootPath).thenReturn(testWorkspaceFolder);
            const envVarsProvider = mock(EnvironmentVariablesProvider);
            when(envVarsProvider.getEnvironmentVariables()).thenResolve({});
            extensionChecker = mock(PythonExtensionChecker);

            // Setup file system to return correct values.
            when(fs.searchLocal(anything(), anything(), true)).thenCall((_p, c, _d) => {
                if (c.startsWith('python')) {
                    return Promise.resolve(['interpreter.json']);
                }
                if (c.startsWith('conda')) {
                    return Promise.resolve(['interpreter.json']);
                }
                return Promise.resolve([
                    // 'python.json',
                    'python3.json',
                    'python3dupe.json',
                    'julia.json',
                    'python2.json'
                ]);
            });
            when(fs.readLocalFile(anything())).thenCall((f) => {
                if (f.endsWith('python.json')) {
                    return Promise.resolve(JSON.stringify(pyEnvPython3spec));
                }
                if (f.endsWith('pythonPyEnvNew.json')) {
                    return Promise.resolve(JSON.stringify(pyEnvUsingNewNamesPython3spec));
                }
                if (f.endsWith('python3.json')) {
                    return Promise.resolve(JSON.stringify(python3spec));
                }
                if (f.endsWith('python3dupe.json')) {
                    return Promise.resolve(JSON.stringify(python3DupeSpec));
                }
                if (f.endsWith('julia.json')) {
                    return Promise.resolve(JSON.stringify(juliaSpec));
                }
                if (f.endsWith('python2.json')) {
                    return Promise.resolve(JSON.stringify(python2spec));
                }
                if (f.endsWith('interpreter.json')) {
                    return Promise.resolve(JSON.stringify(interpreterSpec));
                }
                throw new Error('Unavailable file');
            });
            when(fs.areLocalPathsSame(anything(), anything())).thenCall((a, b) => {
                return arePathsSame(a, b);
            });
            when(fs.localDirectoryExists(anything())).thenResolve(true);

            kernelFinder = new LocalKernelFinder(
                instance(interpreterService),
                instance(platformService),
                instance(fs),
                pathUtils,
                instance(workspaceService),
                instance(envVarsProvider),
                instance(extensionChecker),
                instance(extensions)
            );
        });
        teardown(() => {
            sinon.restore();
        });
        test('Kernels found on disk', async () => {
            const kernels = await kernelFinder.listKernels(undefined);
            assert.ok(kernels.length >= 3, 'Not enough kernels returned');
            assert.ok(
                kernels.find((k) => getDisplayNameOrNameOfKernelConnection(k) === 'Python 3 on Disk'),
                'Python 3 kernel not found'
            );
            assert.ok(
                kernels.find((k) => getDisplayNameOrNameOfKernelConnection(k) === 'Python 2 on Disk'),
                'Python 2 kernel not found'
            );
            assert.ok(
                kernels.find((k) => getDisplayNameOrNameOfKernelConnection(k) === 'Julia on Disk'),
                'Julia kernel not found'
            );
        });
        // Previously tests passed because the activeInterpreter in the tests was the first interpreter form the list.
        [python3Interpreter, condaEnvironment, python2Interpreter, condaEnvironmentBase].forEach(
            (activeInterpreter) => {
                test('No interpreters used when no python extension', async () => {
                    // Setup interpreters to match
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(false);
                    const kernels = await kernelFinder.listKernels(undefined);
                    const interpreterKernels = kernels.filter((k) => k.interpreter);
                    assert.ok(kernels.length, 'Kernels not found with no python extension');
                    assert.equal(
                        interpreterKernels.length,
                        0,
                        'Interpreter kernels should not be possible without python extension'
                    );
                });

                test('Kernels found on disk and in interpreters', async () => {
                    // Setup interpreters to match
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        pyEnvInterpreter,
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                    const kernels = await kernelFinder.listKernels(undefined);

                    // All the python3 kernels should not be listed
                    const python3Kernels = kernels.filter(
                        (k) => k.kernelSpec && k.kernelSpec.name === defaultPython3Name
                    );
                    assert.equal(python3Kernels.length, 0, 'python 3 kernels should not be displayed');

                    // No other kernels should have the python 3 inteprreter
                    const nonPython3Kernels = kernels.filter(
                        (k) => k.kernelSpec && k.kernelSpec.name !== defaultPython3Name
                    );
                    assert.equal(
                        nonPython3Kernels.length + python3Kernels.length,
                        kernels.length,
                        'Some kernels came back that are pointing to python3 when they shouldnt'
                    );

                    // Should be two non kernel spec kernels
                    const condaKernel = kernels.find(
                        (k) =>
                            k.interpreter &&
                            k.interpreter.path === condaEnvironment.path &&
                            k.kind === 'startUsingPythonInterpreter'
                    );
                    const python2Kernel = kernels.find(
                        (k) =>
                            k.interpreter &&
                            k.interpreter.path === python2Interpreter.path &&
                            k.kind === 'startUsingPythonInterpreter'
                    );
                    assert.ok(condaKernel, 'Conda kernel not returned by itself');
                    assert.ok(python2Kernel, 'Python 2 kernel not returned');

                    // Both of these kernels should be using default kernel spec
                    assert.ok((condaKernel as any).kernelSpec, 'No kernel spec on conda kernel');
                    assert.ok((python2Kernel as any).kernelSpec, 'No kernel spec on python 2 kernel');

                    // Non python 3 kernels should include other kernels too (julia and python 2)
                    assert.ok(nonPython3Kernels.length - 2 > 0, 'No other kernelspec kernels besides python 3 ones');
                });
                test('No kernels with same id', async () => {
                    // Setup interpreters to match
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
                    const kernels = await kernelFinder.listKernels(undefined);
                    const existing = new Set<string>(kernels.map((k) => k.id));
                    assert.equal(existing.size, kernels.length, 'Dupe kernels found');
                });
                test('Kernel spec name should be different if from interpreter but not if normal', async () => {
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                    const kernels = await kernelFinder.listKernels(undefined);

                    // Kernels without interpreters should have a short name
                    const nonInterpreterKernels = kernels.filter(
                        (k) => !k.interpreter && (k.kernelSpec?.name.length || 0) < 30
                    );
                    assert.ok(nonInterpreterKernels.length, 'No non interpreter kernels with short names');

                    // Kernels with interpreters that match should have also have short names
                    const interpretersKernelsThatMatched = kernels.filter(
                        (k) =>
                            k.interpreter &&
                            k.kernelSpec?.specFile &&
                            !k.kernelSpec?.specFile?.endsWith('interpreter.json') &&
                            (k.kernelSpec?.name.length || 0 < 30)
                    );
                    assert.ok(
                        interpretersKernelsThatMatched.length,
                        'No kernels that matched interpreters should have their name changed'
                    );

                    // Kernels from interpreter paths should have a long name
                    const interpretersKernels = kernels.filter(
                        (k) =>
                            k.interpreter &&
                            k.kernelSpec?.specFile &&
                            k.kernelSpec?.specFile?.endsWith('interpreter.json') &&
                            (k.kernelSpec?.name.length || 0) > 30
                    );
                    assert.ok(
                        interpretersKernels.length,
                        'Kernels from interpreter paths should have their name changed (so jupyter can create a spec for them)'
                    );
                });
                test('All kernels have a spec file', async () => {
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
                    const kernels = await kernelFinder.listKernels(undefined);
                    const kernelsWithoutSpec = kernels.filter((k) => !k.kernelSpec?.specFile);
                    assert.equal(
                        kernelsWithoutSpec.length,
                        0,
                        'All kernels should have a spec file (otherwise spec file would make them mutable)'
                    );
                });
                test('Can match based on notebook metadata', async () => {
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
                    const nbUri = Uri.file('test.ipynb');

                    // Try python
                    let kernel = await kernelFinder.findKernel(nbUri, {
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4
                    });
                    assert.equal(
                        kernel?.kernelSpec?.language,
                        'python',
                        'No python kernel found matching notebook metadata'
                    );

                    // Julia
                    kernel = await kernelFinder.findKernel(nbUri, {
                        language_info: { name: 'julia' },
                        orig_nbformat: 4
                    });
                    assert.equal(
                        kernel?.kernelSpec?.language,
                        'julia',
                        'No julia kernel found matching notebook metadata'
                    );

                    // Python 2
                    kernel = await kernelFinder.findKernel(nbUri, {
                        kernelspec: {
                            display_name: 'Python 2 on Disk',
                            name: 'python2'
                        },
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4
                    });
                    assert.equal(
                        kernel?.kernelSpec?.language,
                        'python',
                        'No python2 kernel found matching notebook metadata'
                    );

                    // Interpreter name
                    kernel = await kernelFinder.findKernel(nbUri, {
                        kernelspec: {
                            display_name: 'Some oddball kernel',
                            name: getInterpreterKernelSpecName(condaEnvironment)
                        },
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4
                    });
                    assert.ok(kernel, 'No interpreter kernel found matching notebook metadata');

                    // Generic python 3
                    kernel = await kernelFinder.findKernel(nbUri, {
                        kernelspec: {
                            display_name: 'Python 3',
                            name: defaultPython3Name
                        },
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4
                    });
                    assert.equal(
                        kernel?.kernelSpec?.language,
                        'python',
                        'No kernel found matching default notebook metadata'
                    );
                });
                test('Return active interpreter for interactive window', async () => {
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                    // Try python
                    let kernel = await kernelFinder.findKernel(Uri.file('wow.py'), {
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4
                    });
                    assert.equal(
                        kernel?.kernelSpec?.language,
                        'python',
                        'No python kernel found matching notebook metadata'
                    );
                });
                test('Return active interpreter for interactive window (without passing any metadata)', async () => {
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                    // Try python
                    let kernel = await kernelFinder.findKernel(Uri.file('wow.py'));
                    assert.equal(
                        kernel?.kernelSpec?.language,
                        'python',
                        'No python kernel found matching notebook metadata'
                    );
                });
                test('Return active interpreter for blank notebooks (metadata only has language)', async () => {
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                    // Try python
                    let kernel = await kernelFinder.findKernel(Uri.file('wow.ipynb'), {
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 2
                    });
                    assert.equal(kernel?.interpreter, activeInterpreter);
                });
                test('Can match (exactly) based on notebook metadata (metadata contains kernelspec name that we generated)', async () => {
                    when(fs.searchLocal(anything(), anything(), true)).thenCall((_p, c, _d) => {
                        if (c.startsWith('python')) {
                            return Promise.resolve(['interpreter.json']);
                        }
                        if (c.startsWith('conda')) {
                            return Promise.resolve(['interpreter.json']);
                        }
                        return Promise.resolve([
                            'python.json',
                            'pythonPyEnvNew.json',
                            'python3.json',
                            'python3dupe.json',
                            'julia.json',
                            'python2.json'
                        ]);
                    });
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        pyEnvInterpreter, // Previously this would not get picked.
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                    // Generic python 3
                    let kernel = await kernelFinder.findKernel(Uri.file('test.ipynb'), {
                        kernelspec: {
                            display_name: pyEnvPython3spec.display_name,
                            // Use a kernelspec name that we generate.
                            name: pyEnvPython3spec.name
                        },
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4
                    });
                    assert.equal(
                        kernel?.kernelSpec?.language,
                        'python',
                        'No kernel found matching default notebook metadata'
                    );
                    assert.equal(kernel?.kind, 'startUsingPythonInterpreter', 'Should start using Python');
                    assert.deepEqual(kernel?.interpreter, pyEnvInterpreter, 'Should start using PyEnv');

                    // Find based on interpreter hash in metadata
                    kernel = await kernelFinder.findKernel(Uri.file('test.ipynb'), {
                        kernelspec: {
                            display_name: 'Something',
                            name: 'python3'
                        },
                        interpreter: {
                            hash: getInterpreterHash({ path: condaEnvironmentBase.path })
                        },
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4
                    });
                    assert.equal(
                        kernel?.kernelSpec?.language,
                        'python',
                        'No kernel found matching default notebook metadata'
                    );
                    assert.equal(kernel?.kind, 'startUsingPythonInterpreter', 'Should start using Python');
                    assert.deepEqual(kernel?.interpreter, condaEnvironmentBase, 'Should start using PyEnv');
                });
                test('Can match (exactly) based on notebook metadata (metadata contains kernelspec name that we generated using the new algorightm)', async () => {
                    when(fs.searchLocal(anything(), anything(), true)).thenCall((_p, c, _d) => {
                        if (c.startsWith('python')) {
                            return Promise.resolve(['interpreter.json']);
                        }
                        if (c.startsWith('conda')) {
                            return Promise.resolve(['interpreter.json']);
                        }
                        return Promise.resolve([
                            'python.json',
                            'pythonPyEnvNew.json',
                            'python3.json',
                            'python3dupe.json',
                            'julia.json',
                            'python2.json'
                        ]);
                    });
                    when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                    when(interpreterService.getInterpreters(anything())).thenResolve([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        pyEnvInterpreter,
                        pyEnvInterpreter3, // Previously this would get picked due to the order.
                        pyEnvInterpreter2,
                        condaEnvironmentBase
                    ]);
                    when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                    // Generic python 3
                    const kernel = await kernelFinder.findKernel(Uri.file('test.ipynb'), {
                        kernelspec: {
                            display_name: pyEnvUsingNewNamesPython3spec.display_name,
                            // Use a kernelspec name that we generate.
                            name: pyEnvUsingNewNamesPython3spec.name
                        },
                        language_info: { name: PYTHON_LANGUAGE },
                        orig_nbformat: 4
                    });
                    assert.equal(
                        kernel?.kernelSpec?.language,
                        'python',
                        'No kernel found matching default notebook metadata'
                    );
                    assert.equal(kernel?.kind, 'startUsingPythonInterpreter', 'Should start using Python');
                    assert.deepEqual(kernel?.interpreter, pyEnvInterpreter2, 'Should start using PyEnv');
                });
            }
        );
    });
});
