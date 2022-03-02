/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { assert } from 'chai';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import { PathUtils } from '../../common/platform/pathUtils';
import { IFileSystem, IPlatformService } from '../../common/platform/types';
import { LocalKernelFinder } from './localKernelFinder';
import { ILocalKernelFinder } from './types';
import { IInterpreterService } from '../../interpreter/contracts';
import { WorkspaceService } from '../../common/application/workspace';
import { EnvironmentVariablesProvider } from '../../common/variables/environmentVariablesProvider';
import { InterpreterService, PythonExtensionChecker } from '../../api/pythonApi';
import {
    createInterpreterKernelSpec,
    getDisplayNameOrNameOfKernelConnection,
    getInterpreterKernelSpecName,
    getKernelId,
    getKernelRegistrationInfo
} from '../jupyter/kernels/helpers';
import { PlatformService } from '../../common/platform/platformService';
import { EXTENSION_ROOT_DIR } from '../../constants';
import { FileSystem } from '../../common/platform/fileSystem';
import type { KernelSpec } from '@jupyterlab/services';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { IPythonExtensionChecker } from '../../api/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { arePathsSame, getOSType } from '../../../test/common';
import { EventEmitter, Memento, Uri } from 'vscode';
import { IDisposable } from '../../common/types';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder';
import { JupyterPaths } from './jupyterPaths';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder';
import {
    areInterpreterPathsSame,
    getInterpreterHash,
    getNormalizedInterpreterPath
} from '../../pythonEnvironments/info/interpreter';
import { OSType } from '../../common/utils/platform';
import { disposeAllDisposables } from '../../common/helpers';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { loadKernelSpec } from './localKernelSpecFinderBase';
import { traceInfoIfCI } from '../../common/logger';

[false, true].forEach((isWindows) => {
    suite(`Local Kernel Finder ${isWindows ? 'Windows' : 'Unix'}`, () => {
        let kernelFinder: ILocalKernelFinder;
        let interpreterService: IInterpreterService;
        let platformService: IPlatformService;
        let fs: IFileSystem;
        let extensionChecker: IPythonExtensionChecker;
        const defaultPython3Name = 'python3';
        const disposables: IDisposable[] = [];
        const pyEnvInterpreter: PythonEnvironment = {
            displayName: 'Python 3 Environment for PyEnv',
            path: '/users/username/pyenv/envs/temp/python',
            sysPrefix: 'sysPrefix_Python',
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
            sysPrefix: 'sysPrefix_Python',
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
            sysPrefix: 'sysPrefix_Python',
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
            sysPrefix: 'sysPrefix_Python',
            version: {
                major: 3,
                minor: 8,
                raw: '3.8',
                build: ['0'],
                patch: 0,
                prerelease: ['0']
            }
        };
        const python3_8_10_Interpreter: PythonEnvironment = {
            displayName: 'Python 3.8 64bit Environment',
            path: '/bin/python',
            sysPrefix: 'sysPrefix_Python',
            version: {
                major: 3,
                minor: 8,
                raw: '3.8.10',
                build: ['0'],
                patch: 10,
                prerelease: ['0']
            }
        };
        const python3_8_11_Interpreter: PythonEnvironment = {
            displayName: 'Python 3.8 64bit Environment',
            path: '/users/username/pyenv/envs/temp3/bin/python',
            sysPrefix: 'sysPrefix_Python',
            version: {
                major: 3,
                minor: 8,
                raw: '3.8.11',
                build: ['0'],
                patch: 11,
                prerelease: ['0']
            }
        };
        // This is identical to the previous one, path is different, no `/bin/` folder.
        // Only applies to unix.
        const python3_8_11_InterpreterNoBinPython: PythonEnvironment = {
            displayName: 'Python 3.8 64bit Environment',
            path: '/users/username/pyenv/envs/temp3/python',
            sysPrefix: 'sysPrefix_Python',
            version: {
                major: 3,
                minor: 8,
                raw: '3.8.11',
                build: ['0'],
                patch: 11,
                prerelease: ['0']
            }
        };
        const duplicateEnv = isWindows ? [python3_8_11_Interpreter] : [python3_8_11_InterpreterNoBinPython];
        const python3811spec: KernelSpec.ISpecModel = {
            display_name: python3_8_11_InterpreterNoBinPython.displayName!,
            name: 'python3811jvsc74a57bd06bf34dd489c90df3f2c7e4a7a969c3a519895dd38f693a4499ab76afdf92a529',
            argv: [isWindows ? python3_8_11_Interpreter.path : python3_8_11_InterpreterNoBinPython.path],
            language: 'python',
            resources: {},
            metadata: {
                interpreter: isWindows ? python3_8_11_Interpreter : python3_8_11_InterpreterNoBinPython
            }
        };
        const python2Interpreter: PythonEnvironment = {
            displayName: 'Python 2 Environment',
            path: '/usr/bin/python',
            sysPrefix: 'sysPrefix_Python',
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
            envName: 'condaEnv1',
            envType: EnvironmentType.Conda
        };
        const pyEnvPython3spec: KernelSpec.ISpecModel = {
            display_name: 'Python 3 PyEnv on Disk',
            name: 'python38664bitpyenv87d47e496650464eac2bd1421064a987',
            argv: [pyEnvInterpreter.path],
            language: 'python',
            resources: {},
            metadata: {
                interpreter: pyEnvInterpreter
            }
        };
        const pyEnvUsingNewNamesPython3spec: KernelSpec.ISpecModel = {
            display_name: 'Python 3 PyEnv on Disk with new Name',
            name: 'pythonjvsc74a57bd0857c2ac1a2d121b2884435ca7334db9e850ee37c2dd417fb5029a40e4d8390b5',
            argv: ['/users/username/pyenv/envs/temp2/python'],
            language: 'python',
            resources: {}
        };
        const python3spec: KernelSpec.ISpecModel = {
            display_name: 'Python 3',
            name: defaultPython3Name,
            argv: ['/usr/bin/python3'],
            language: 'python',
            resources: {},
            metadata: {
                interpreter: python3Interpreter
            }
        };
        const python3DupeSpec: KernelSpec.ISpecModel = {
            display_name: 'Python 3',
            name: defaultPython3Name,
            argv: ['/usr/bin/python3'],
            language: 'python',
            resources: {},
            metadata: {
                interpreter: python3Interpreter
            }
        };
        // Has a custom env, but shares python interpreter with another spec
        const python3CustomEnv: KernelSpec.ISpecModel = {
            display_name: 'Python 3 custom env',
            name: 'customPython3',
            argv: ['/usr/bin/python3'],
            language: 'python',
            resources: {},
            env: { Testing: 'Test' },
            metadata: {
                interpreter: python3Interpreter
            }
        };
        const python2spec: KernelSpec.ISpecModel = {
            display_name: 'Python 2 on Disk',
            name: 'python2',
            argv: ['/usr/bin/python'],
            language: 'python',
            resources: {}
        };
        const juliaSpec: KernelSpec.ISpecModel = {
            display_name: 'Julia on Disk',
            name: 'julia',
            argv: ['/usr/bin/julia'],
            language: 'julia',
            resources: {}
        };
        const interpreterSpec: KernelSpec.ISpecModel = {
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
            fs = mock(FileSystem);
            when(fs.deleteLocalFile(anything())).thenResolve();
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
            const event = new EventEmitter<Uri | undefined>();
            disposables.push(event);
            when(envVarsProvider.onDidEnvironmentVariablesChange).thenReturn(event.event);
            extensionChecker = mock(PythonExtensionChecker);
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

            // Setup file system to return correct values.
            when(fs.searchLocal(anything(), anything(), true)).thenCall((_p, c, _d) => {
                if (c.startsWith('sysPrefix_Python')) {
                    return Promise.resolve([['interpreter', 'interpreter.json'].join('/')]);
                }
                if (c.startsWith('conda')) {
                    return Promise.resolve([['conda', 'interpreter.json'].join('/')]);
                }
                return Promise.resolve(
                    [
                        // 'python.json',
                        'python3.json',
                        'python3dupe.json',
                        'python3custom.json',
                        'julia.json',
                        'python2.json',
                        'python3811.json'
                    ].map((name) =>
                        // Prefix with some character, else a folder of `python` is deemed a default kernelspec.
                        ['_' + path.basename(name, '.json'), name].join('/')
                    )
                );
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
                if (f.endsWith('python3custom.json')) {
                    return Promise.resolve(JSON.stringify(python3CustomEnv));
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
                if (f.endsWith('python3811.json')) {
                    return Promise.resolve(JSON.stringify(python3811spec));
                }
                throw new Error('Unavailable file');
            });
            when(fs.areLocalPathsSame(anything(), anything())).thenCall((a, b) => {
                return arePathsSame(a, b);
            });
            when(fs.localDirectoryExists(anything())).thenResolve(true);
            const memento = mock<Memento>();
            when(memento.get(anything(), anything())).thenReturn(false);
            when(memento.update(anything(), anything())).thenResolve();
            const jupyterPaths = new JupyterPaths(
                instance(platformService),
                pathUtils,
                instance(envVarsProvider),
                disposables,
                instance(memento)
            );
            const nonPythonKernelSpecFinder = new LocalKnownPathKernelSpecFinder(
                instance(fs),
                instance(workspaceService),
                jupyterPaths,
                instance(extensionChecker),
                instance(memento)
            );
            when(memento.get('LOCAL_KERNEL_SPEC_CONNECTIONS_CACHE_KEY', anything())).thenReturn([]);
            when(memento.get('JUPYTER_GLOBAL_KERNELSPECS', anything())).thenReturn([]);
            when(memento.update('JUPYTER_GLOBAL_KERNELSPECS', anything())).thenResolve();
            kernelFinder = new LocalKernelFinder(
                instance(interpreterService),
                instance(extensionChecker),
                nonPythonKernelSpecFinder,
                new LocalPythonAndRelatedNonPythonKernelSpecFinder(
                    instance(interpreterService),
                    instance(fs),
                    instance(workspaceService),
                    jupyterPaths,
                    instance(extensionChecker),
                    nonPythonKernelSpecFinder
                ),
                jupyterPaths,
                instance(memento),
                instance(fs)
            );
        });
        teardown(() => {
            disposeAllDisposables(disposables);
            sinon.restore();
        });
        test('Kernels found on disk with Python extension installed & no python intepreters discovered', async () => {
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
            when(interpreterService.getInterpreters(anything())).thenResolve([]);

            const kernels = await kernelFinder.listKernels(undefined);

            assert.isAtLeast(
                kernels.filter((k) => k.kernelSpec?.language !== PYTHON_LANGUAGE).length,
                1,
                'Must have at least 1 non-python kernel'
            );
        });
        test('Kernels found on disk with Python extension not installed', async () => {
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(false);
            const kernels = await kernelFinder.listKernels(undefined);

            assert.isAtLeast(kernels.length, 2, 'Not enough kernels returned');
            assert.ok(
                kernels.find((k) => getDisplayNameOrNameOfKernelConnection(k) === 'Python 2 on Disk'),
                'Python 2 kernel not found'
            );
            assert.ok(
                kernels.find((k) => getDisplayNameOrNameOfKernelConnection(k) === 'Julia on Disk'),
                'Julia kernel not found'
            );
        });
        test('If two kernelspecs share the same interpreter, but have different envs both should be listed.', async () => {
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
            when(interpreterService.getInterpreters(anything())).thenResolve(
                duplicateEnv.concat([
                    python3Interpreter,
                    condaEnvironment,
                    python2Interpreter,
                    condaEnvironmentBase,
                    python3_8_10_Interpreter
                ])
            );
            const kernels = await kernelFinder.listKernels(undefined);

            // Make sure our python 3 with custom env is here
            assert.ok(
                kernels.find((k) => k.kernelSpec!.name === python3CustomEnv.name),
                'Python 3 with custom env misssing.'
            );
            // Make sure we have two kernelspecs pointing at the python3 interpreter path
            assert.isAtLeast(
                kernels.filter((k) => k.interpreter?.path === '/usr/bin/python3').length,
                2,
                'Missing both python3 kernelspecs'
            );
        });
        test('If two kernelspecs share the same interpreter, but have different envs both should be listed.', async function () {
            if (isWindows) {
                return this.skip();
            }
            const globalPython3spec: KernelSpec.ISpecModel = {
                display_name: 'Python 3.7',
                name: defaultPython3Name,
                argv: ['/usr/bin/python37'],
                language: 'python',
                resources: {}
            };
            const python37Interpreter: PythonEnvironment = {
                displayName: 'Python 3.7',
                path: '/bin/python37',
                sysPrefix: 'Python37',
                version: {
                    major: 3,
                    minor: 7,
                    raw: '3.8.0',
                    build: ['0'],
                    patch: 0,
                    prerelease: ['0']
                }
            };
            const python38Interpreter: PythonEnvironment = {
                displayName: 'Python 3.8',
                path: '/bin/python3',
                sysPrefix: 'Python38',
                version: {
                    major: 3,
                    minor: 8,
                    raw: '3.8.10',
                    build: ['0'],
                    patch: 10,
                    prerelease: ['0']
                }
            };
            const python39Interpreter: PythonEnvironment = {
                displayName: 'Python 3.9',
                path: '/bin/python39',
                sysPrefix: '/usr',
                version: {
                    major: 3,
                    minor: 9,
                    raw: '3.9.10',
                    build: ['0'],
                    patch: 10,
                    prerelease: ['0']
                }
            };
            when(fs.searchLocal(anything(), anything(), true)).thenCall(async (_p, dir, _d) => {
                if (dir == '/usr/share/jupyter/kernels') {
                    return [['python3', 'globalPython3.json'].join('/')];
                }
                return [];
            });
            when(fs.readLocalFile(anything())).thenCall((f) => {
                if (f.endsWith('globalPython3.json')) {
                    return Promise.resolve(JSON.stringify(globalPython3spec));
                }
                throw new Error('Unavailable file');
            });
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
            when(interpreterService.getInterpreters(anything())).thenResolve([
                python38Interpreter,
                python37Interpreter,
                python39Interpreter
            ]);
            const kernels = await kernelFinder.listKernels(undefined);
            // We should have just 3 interpreters.
            // We have a global kernel spec that points to python 37, hence no need to display kernelspec.
            assert.lengthOf(kernels, 3, 'Incorrect number of kernels');

            // Ensure kernelspec in the kernel points to the right interpreter.
            kernels.forEach((kernel) => {
                assert.strictEqual(
                    kernel.interpreter?.path,
                    kernel.kernelSpec?.interpreterPath,
                    `kernelSpec.interpreterPath is not right for ${kernel.interpreter?.displayName}`
                );
                if (kernel.kernelSpec?.path !== 'python') {
                    assert.strictEqual(
                        kernel.interpreter?.path,
                        kernel.kernelSpec?.path,
                        `kernelSpec.path is not right for ${kernel.interpreter?.displayName}`
                    );
                }
            });
        });
        // Previously tests passed because the activeInterpreter in the tests was the first interpreter form the list.
        [
            python3Interpreter,
            condaEnvironment,
            python2Interpreter,
            condaEnvironmentBase,
            python3_8_11_Interpreter
        ].forEach((activeInterpreter) => {
            const testSuffix = `(interpreter = ${activeInterpreter.displayName})`;
            test(`No interpreters used when no python extension ${testSuffix}`, async () => {
                // Setup interpreters to match
                when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
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
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        pyEnvInterpreter,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
                when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                const kernels = await kernelFinder.listKernels(undefined);
                // All the python3 kernels should not be listed
                const python3Kernels = kernels.filter((k) => k.kernelSpec && k.kernelSpec.name === defaultPython3Name);
                assert.equal(python3Kernels.length, 0, 'python 3 kernels should not be displayed');

                // No other kernels should have the python 3 interpreter
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
                        areInterpreterPathsSame(
                            k.interpreter.path,
                            condaEnvironment.path,
                            isWindows ? OSType.Windows : OSType.Linux
                        ) &&
                        k.kind === 'startUsingPythonInterpreter'
                );
                const python2Kernel = kernels.find(
                    (k) =>
                        k.interpreter &&
                        areInterpreterPathsSame(
                            k.interpreter.path,
                            python2Interpreter.path,
                            isWindows ? OSType.Windows : OSType.Linux
                        ) &&
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
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
                when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
                const kernels = await kernelFinder.listKernels(undefined);
                const existing = new Set<string>(kernels.map((k) => k.id));
                assert.equal(existing.size, kernels.length, 'Dupe kernels found');
            });
            test('Kernel spec name should be different if from interpreter but not if normal', async () => {
                when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
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
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
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
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
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
                assert.equal(kernel?.kernelSpec?.language, 'julia', 'No julia kernel found matching notebook metadata');

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
                assert.equal(
                    kernel?.kernelSpec?.display_name,
                    'Python 2 on Disk',
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
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
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
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
                when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                // Try python
                let kernel = await kernelFinder.findKernel(Uri.file('wow.py'));
                assert.equal(
                    kernel?.kernelSpec?.language,
                    'python',
                    'No python kernel found matching notebook metadata'
                );
            });
            test(`Return active interpreter for blank notebooks (metadata only has language) ${testSuffix}`, async () => {
                when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter,
                        python3_8_11_Interpreter
                    ])
                );
                when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                // Try python
                let kernel = await kernelFinder.findKernel(Uri.file('wow.ipynb'), {
                    language_info: { name: PYTHON_LANGUAGE },
                    orig_nbformat: 2
                });
                assert.deepEqual({ ...kernel?.interpreter, path: '' }, { ...activeInterpreter, path: '' });
                traceInfoIfCI(`Is Windows = ${isWindows}`);
                traceInfoIfCI(
                    `getNormalizedInterpreterPath(kernel?.interpreter?.path, isWindows ? OSType.Windows : OSType.Linux) = ${getNormalizedInterpreterPath(
                        kernel?.interpreter?.path,
                        isWindows ? OSType.Windows : OSType.Linux
                    )}`
                );
                traceInfoIfCI(
                    `getNormalizedInterpreterPath(activeInterpreter.path, isWindows ? OSType.Windows : OSType.Linux) = ${getNormalizedInterpreterPath(
                        activeInterpreter.path,
                        isWindows ? OSType.Windows : OSType.Linux
                    )}`
                );
                traceInfoIfCI(
                    getNormalizedInterpreterPath(kernel?.interpreter?.path, isWindows ? OSType.Windows : OSType.Linux),
                    getNormalizedInterpreterPath(activeInterpreter.path, isWindows ? OSType.Windows : OSType.Linux)
                );
            });
            test('Return conda interpreter if we have conda env name as kernelspec name in notebook metadata', async () => {
                when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
                when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                let kernel = await kernelFinder.findKernel(Uri.file('wow.ipynb'), {
                    language_info: { name: PYTHON_LANGUAGE },
                    orig_nbformat: 4,
                    kernelspec: {
                        display_name: condaEnvironment.envName!,
                        name: condaEnvironment.envName!
                    }
                });
                assert.equal(
                    kernel?.kernelSpec?.language,
                    'python',
                    'No python kernel found matching notebook metadata'
                );
                assert.deepEqual(kernel?.interpreter, condaEnvironment, 'Should match conda env');
            });
            test('Can match (exactly) based on notebook metadata (metadata contains kernelspec name that we generated)', async () => {
                when(fs.searchLocal(anything(), anything(), true)).thenCall((_p, c, _d) => {
                    if (c.startsWith('sysPrefix_Python')) {
                        return Promise.resolve([['interpreter', 'interpreter.json'].join('/')]);
                    }
                    if (c.startsWith('conda')) {
                        return Promise.resolve([['conda', 'interpreter.json'].join('/')]);
                    }
                    return Promise.resolve(
                        [
                            'python.json',
                            'pythonPyEnvNew.json',
                            'python3.json',
                            'python3dupe.json',
                            'julia.json',
                            'python2.json'
                        ].map((name) =>
                            // Prefix with some character, else a folder of `python` is deemed a default kernelspec.
                            ['_' + path.basename(name, '.json'), name].join('/')
                        )
                    );
                });
                when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        pyEnvInterpreter, // Previously this would not get picked.
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
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
                    if (c.startsWith('sysPrefix_Python')) {
                        return Promise.resolve([['interpreter', 'interpreter.json'].join('/')]);
                    }
                    if (c.startsWith('conda')) {
                        return Promise.resolve([['conda', 'interpreter.json'].join('/')]);
                    }
                    return Promise.resolve(
                        [
                            'python.json',
                            'pythonPyEnvNew.json',
                            'python3.json',
                            'python3dupe.json',
                            'julia.json',
                            'python2.json'
                        ].map((name) => [path.basename(name, '.json'), name].join('/'))
                    );
                });
                when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
                when(interpreterService.getInterpreters(anything())).thenResolve(
                    duplicateEnv.concat([
                        python3Interpreter,
                        condaEnvironment,
                        python2Interpreter,
                        pyEnvInterpreter,
                        pyEnvInterpreter3, // Previously this would get picked due to the order.
                        pyEnvInterpreter2,
                        condaEnvironmentBase,
                        python3_8_10_Interpreter
                    ])
                );
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
        });
    });
});

[false, true].forEach((isWindows) => {
    suite(`Local Kernel Finder ${isWindows ? 'Windows' : 'Unix'}`, () => {
        let kernelFinder: ILocalKernelFinder;
        let interpreterService: IInterpreterService;
        let platformService: IPlatformService;
        let fs: IFileSystem;
        let extensionChecker: IPythonExtensionChecker;
        const disposables: IDisposable[] = [];
        let globalSpecPath: string;
        const pathSeparator = getOSType() === OSType.Windows ? '\\' : '/';
        type TestData = {
            interpreters?: (
                | PythonEnvironment
                | {
                      interpreter: PythonEnvironment;
                      /**
                       * These are all of the kernelspecs found within the Python environment.
                       * Could be python or non-python kernlespecs.
                       * Could be default or custom kernelspecs.
                       */
                      kernelSpecs?: KernelSpec.ISpecModel[];
                  }
            )[];
            /**
             * All of the globally installed KernelSpecs
             */
            globalKernelSpecs?: KernelSpec.ISpecModel[];
        };

        async function initialize(testData: TestData, activeInterpreter?: PythonEnvironment) {
            const getRealPathStub = sinon.stub(fsExtra, 'realpath');
            getRealPathStub.returnsArg(0);
            interpreterService = mock(InterpreterService);
            // Ensure the active Interpreter is in the list of interpreters.
            if (activeInterpreter) {
                testData.interpreters = testData.interpreters || [];
                testData.interpreters.push(activeInterpreter);
            }
            const distinctInterpreters = new Set<PythonEnvironment>();
            (testData.interpreters || []).forEach((item) =>
                'interpreter' in item ? distinctInterpreters.add(item.interpreter) : distinctInterpreters.add(item)
            );
            testData.interpreters = Array.from(distinctInterpreters);
            when(interpreterService.getInterpreters(anything())).thenResolve(Array.from(distinctInterpreters));
            when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
            when(interpreterService.getInterpreterDetails(anything())).thenResolve();
            platformService = mock(PlatformService);
            when(platformService.isWindows).thenReturn(isWindows);
            when(platformService.isLinux).thenReturn(!isWindows);
            when(platformService.isMac).thenReturn(false);
            fs = mock(FileSystem);
            when(fs.deleteLocalFile(anything())).thenResolve();
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
            const event = new EventEmitter<Uri | undefined>();
            disposables.push(event);
            when(envVarsProvider.onDidEnvironmentVariablesChange).thenReturn(event.event);
            extensionChecker = mock(PythonExtensionChecker);
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
            const memento = mock<Memento>();
            when(memento.get(anything(), anything())).thenReturn(false);
            when(memento.update(anything(), anything())).thenResolve();
            const jupyterPaths = new JupyterPaths(
                instance(platformService),
                pathUtils,
                instance(envVarsProvider),
                disposables,
                instance(memento)
            );

            const kernelSpecsBySpecFile = new Map<string, KernelSpec.ISpecModel>();
            (testData.interpreters || []).forEach((interpreter) => {
                if ('interpreter' in interpreter) {
                    (interpreter.kernelSpecs || []).forEach((kernelSpec) => {
                        const jsonFile = [
                            interpreter.interpreter.sysPrefix,
                            'share',
                            'jupyter',
                            'kernels',
                            kernelSpec.name,
                            'kernel.json'
                        ].join(pathSeparator);
                        kernelSpecsBySpecFile.set(jsonFile, kernelSpec);
                    });
                }
            });
            globalSpecPath = ((await jupyterPaths.getKernelSpecRootPath()) as unknown) as string;
            await Promise.all(
                (testData.globalKernelSpecs || []).map(async (kernelSpec) => {
                    const jsonFile = [globalSpecPath, kernelSpec.name, 'kernel.json'].join(pathSeparator);
                    kernelSpecsBySpecFile.set(jsonFile.replace(/\\/g, '/'), kernelSpec);
                })
            );
            when(fs.readLocalFile(anything())).thenCall((f) => {
                // These tests run on windows & linux, hence support both paths.
                f = f.replace(/\\/g, '/');
                return kernelSpecsBySpecFile.has(f)
                    ? Promise.resolve(JSON.stringify(kernelSpecsBySpecFile.get(f)!))
                    : Promise.reject(`File "${f}" not found.`);
            });
            when(fs.searchLocal(anything(), anything(), true)).thenCall((_p, c: string, _d) => {
                if (c === globalSpecPath) {
                    return (testData.globalKernelSpecs || []).map((kernelSpec) =>
                        [kernelSpec.name, 'kernel.json'].join(pathSeparator)
                    );
                }
                const interpreter = (testData.interpreters || []).find((item) =>
                    'interpreter' in item ? c.includes(item.interpreter.sysPrefix) : c.includes(item.sysPrefix)
                );
                if (interpreter && 'interpreter' in interpreter) {
                    return (interpreter.kernelSpecs || []).map((kernelSpec) =>
                        [kernelSpec.name, 'kernel.json'].join(pathSeparator)
                    );
                }
                return [];
            });
            when(fs.areLocalPathsSame(anything(), anything())).thenCall((a, b) => {
                return arePathsSame(a, b);
            });
            when(fs.localDirectoryExists(anything())).thenResolve(true);
            const nonPythonKernelSpecFinder = new LocalKnownPathKernelSpecFinder(
                instance(fs),
                instance(workspaceService),
                jupyterPaths,
                instance(extensionChecker),
                instance(memento)
            );
            when(memento.get('LOCAL_KERNEL_SPEC_CONNECTIONS_CACHE_KEY', anything())).thenReturn([]);
            when(memento.get('JUPYTER_GLOBAL_KERNELSPECS', anything())).thenReturn([]);
            when(memento.update('JUPYTER_GLOBAL_KERNELSPECS', anything())).thenResolve();
            kernelFinder = new LocalKernelFinder(
                instance(interpreterService),
                instance(extensionChecker),
                nonPythonKernelSpecFinder,
                new LocalPythonAndRelatedNonPythonKernelSpecFinder(
                    instance(interpreterService),
                    instance(fs),
                    instance(workspaceService),
                    jupyterPaths,
                    instance(extensionChecker),
                    nonPythonKernelSpecFinder
                ),
                jupyterPaths,
                instance(memento),
                instance(fs)
            );
        }
        teardown(() => {
            disposeAllDisposables(disposables);
            sinon.restore();
        });

        const juliaKernelSpec: KernelSpec.ISpecModel = {
            argv: ['julia', 'start', 'kernel'],
            display_name: 'Julia Kernel',
            language: 'julia',
            name: 'julia',
            resources: {}
        };
        const rKernelSpec: KernelSpec.ISpecModel = {
            argv: ['r', 'start', 'kernel'],
            display_name: 'R Kernel',
            language: 'r',
            name: 'r',
            resources: {}
        };
        const rV1KernelSpec: KernelSpec.ISpecModel = {
            argv: ['rv1', 'start', 'kernel'],
            display_name: 'R Kernel',
            language: 'r',
            name: 'rv1',
            resources: {}
        };
        const defaultPython3Kernel: KernelSpec.ISpecModel = {
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            display_name: 'Python 3',
            language: 'python',
            name: 'python3',
            resources: {}
        };
        const defaultPython3KernelWithEnvVars: KernelSpec.ISpecModel = {
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            display_name: 'Python 3',
            language: 'python',
            name: 'python3',
            resources: {},
            env: {
                HELLO: 'WORLD'
            }
        };
        const customPythonKernelWithCustomArgv: KernelSpec.ISpecModel = {
            argv: ['python', '-m', 'customKernel'],
            display_name: 'Custom Python Kernel',
            language: 'python',
            name: 'customPythonKernel',
            resources: {}
        };
        const customPythonKernelWithCustomEnv: KernelSpec.ISpecModel = {
            argv: ['python', '-m', 'ipykernel', '-f', '{connection_file}'],
            display_name: 'Custom Python Kernel with Env Vars',
            language: 'python',
            name: 'customPythonKernelWithCustomEnv',
            resources: {},
            env: {
                HELLO: 'WORLD'
            }
        };
        const python2Global: PythonEnvironment = {
            path: isWindows ? 'C:/Python/Python2/scripts/python.exe' : '/usr/bin/python27',
            sysPrefix: isWindows ? 'C:/Python/Python2' : '/usr',
            displayName: 'Python 2.7',
            envType: EnvironmentType.Global,
            sysVersion: '2.7.0',
            version: { major: 2, minor: 7, patch: 0, build: [], prerelease: [], raw: '2.7.0' }
        };
        const python36Global: PythonEnvironment = {
            path: isWindows ? 'C:/Python/Python3.6/scripts/python.exe' : '/usr/bin/python36',
            sysPrefix: isWindows ? 'C:/Python/Python3.6' : '/usr',
            displayName: 'Python 3.6',
            envType: EnvironmentType.Global,
            sysVersion: '3.6.0',
            version: { major: 3, minor: 6, patch: 0, build: [], prerelease: [], raw: '3.6.0' }
        };
        const python37Global: PythonEnvironment = {
            path: isWindows ? 'C:/Python/Python3.7/scripts/python.exe' : '/usr/bin/python37',
            sysPrefix: isWindows ? 'C:/Python/Python3.7' : '/usr',
            displayName: 'Python 3.7',
            envType: EnvironmentType.Global,
            sysVersion: '3.7.0',
            version: { major: 3, minor: 7, patch: 0, build: [], prerelease: [], raw: '3.6.0' }
        };
        const python39PyEnv_HelloWorld: PythonEnvironment = {
            path: isWindows ? 'C:/pyenv/envs/temp/scripts/python.exe' : '/users/username/pyenv/envs/temp/python',
            sysPrefix: isWindows ? 'C:/pyenv/envs/temp' : '/users/username/pyenv/envs/temp',
            displayName: 'Temporary Python 3.9',
            envName: 'temp',
            envType: EnvironmentType.Pyenv,
            sysVersion: '3.9.0',
            version: { major: 3, minor: 9, patch: 0, build: [], prerelease: [], raw: '3.9.0' }
        };
        const python38PyEnv_temp1: PythonEnvironment = {
            path: isWindows ? 'C:/pyenv/envs/temp1/scripts/python.exe' : '/users/username/pyenv/envs/temp1/bin/python',
            sysPrefix: isWindows ? 'C:/pyenv/envs/temp1' : '/users/username/pyenv/envs/temp1',
            displayName: 'Temporary Python 3.8 64bit Environment',
            envName: 'temp1',
            envType: EnvironmentType.Pyenv,
            sysVersion: '3.8.0',
            version: { major: 3, minor: 8, patch: 0, build: [], prerelease: [], raw: '3.8.0' }
        };
        const python38PyEnv_temp2_duplicateNameAsTemp1: PythonEnvironment = {
            path: isWindows ? 'C:/pyenv/envs/temp2/scripts/python.exe' : '/users/username/pyenv/envs/temp2/bin/python',
            sysPrefix: isWindows ? 'C:/pyenv/envs/temp2' : '/users/username/pyenv/envs/temp2',
            displayName: 'Temporary Python 3.8 64bit Environment',
            envName: 'temp2',
            envType: EnvironmentType.Pyenv,
            sysVersion: '3.8.0',
            version: { major: 3, minor: 8, patch: 0, build: [], prerelease: [], raw: '3.8.0' }
        };
        const python38PyEnv_temp3_duplicateNameAsTemp1: PythonEnvironment = {
            path: isWindows ? 'C:/pyenv/envs/temp3/scripts/python.exe' : '/users/username/pyenv/envs/temp3/bin/python',
            sysPrefix: isWindows ? 'C:/pyenv/envs/temp3' : '/users/username/pyenv/envs/temp3',
            displayName: 'Temporary Python 3.8 64bit Environment',
            envName: 'temp3',
            envType: EnvironmentType.Pyenv,
            sysVersion: '3.8.11',
            version: { major: 3, minor: 8, patch: 11, build: [], prerelease: [], raw: '3.8.11' }
        };
        /**
         * Identical to python38PyEnv_temp2_duplicateNameAsTemp1 & python38PyEnv_temp2_duplicateNameAsTemp2
         * Except on unix the executable is not in a bin folder.
         */
        const python38PyEnv_temp4_duplicateNameAsTemp1ButNoBin: PythonEnvironment = {
            path: isWindows ? 'C:/pyenv/envs/temp4/scripts/python.exe' : '/users/username/pyenv/envs/temp4/python',
            sysPrefix: isWindows ? 'C:/pyenv/envs/temp4' : '/users/username/pyenv/envs/temp4',
            displayName: 'Temporary Python 3.8 64bit Environment',
            envName: 'temp4',
            envType: EnvironmentType.Pyenv,
            sysVersion: '3.8.0',
            version: { major: 3, minor: 8, patch: 0, build: [], prerelease: [], raw: '3.8.0' }
        };
        const duplicate1OfPython38PyEnv_temp1 = python38PyEnv_temp1;
        const python38VenvEnv: PythonEnvironment = {
            path: isWindows ? 'C:/temp/venv/.venv/scripts/python.exe' : '/users/username/temp/.venv/bin/python',
            sysPrefix: isWindows ? 'C:/temp/venv/.venv' : '/users/username/temp/.venv',
            displayName: 'Virtual Env Python 3.8',
            envName: '.venv',
            envType: EnvironmentType.VirtualEnv,
            sysVersion: '3.8.0',
            version: { major: 3, minor: 8, patch: 0, build: [], prerelease: [], raw: '3.8.0' }
        };
        const condaEnv1: PythonEnvironment = {
            path: isWindows ? 'C:/conda/envs/env1/scripts/python.exe' : '/conda/envs/env1/bin/python',
            sysPrefix: isWindows ? 'C:/conda/envs/env1' : '/conda/envs/env1',
            envName: 'env1',
            displayName: 'Conda Env1 3.6',
            envType: EnvironmentType.Conda,
            sysVersion: '3.6.0',
            version: { major: 3, minor: 6, patch: 0, build: [], prerelease: [], raw: '3.6.0' }
        };
        const javaKernelSpec: KernelSpec.ISpecModel = {
            argv: ['java', 'xyz.jar', '{connection_file}', 'moreargs'],
            display_name: 'Java Kernel',
            language: 'java',
            name: 'javaKernelInsideConda',
            resources: {},
            env: {
                HELLO: 'Java'
            }
        };
        const python2spec: KernelSpec.ISpecModel = {
            display_name: 'Python 2 on Disk',
            name: 'python2Custom',
            argv: [python2Global.path, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            language: 'python',
            resources: {}
        };

        const fullyQualifiedPythonKernelSpec: KernelSpec.ISpecModel = {
            argv: [python38VenvEnv.path, '-m', 'ipykernel_launcher', '-f', '{connection_file}', 'moreargs'],
            display_name: 'Custom .venv Kernel',
            language: 'python',
            name: 'fullyQualifiedPythonKernelSpec',
            resources: {}
        };
        const fullyQualifiedPythonKernelSpecWithEnv: KernelSpec.ISpecModel = {
            argv: [python38VenvEnv.path, '-m', 'ipykernel_launcher', '-f', '{connection_file}', 'moreargs'],
            display_name: 'Custom .venv Kernel with Env Vars',
            language: 'python',
            name: 'fullyQualifiedPythonKernelSpecWithEnv',
            resources: {},
            env: {
                FOO: 'BAR'
            }
        };

        async function generateExpectedKernels(
            expectedGlobalKernelSpecs: KernelSpec.ISpecModel[],
            expectedInterpreterKernelSpecFiles: { interpreter: PythonEnvironment; kernelspec: KernelSpec.ISpecModel }[],
            expectedInterpreters: PythonEnvironment[]
        ) {
            const duplicates = new Set<PythonEnvironment>();
            expectedInterpreters = expectedInterpreters.filter((item) => {
                if (duplicates.has(item)) {
                    return false;
                }
                duplicates.add(item);
                return true;
            });
            const expectedKernelSpecs: KernelConnectionMetadata[] = [];
            await Promise.all(
                expectedGlobalKernelSpecs.map(async (kernelSpec) => {
                    const kernelspecFile = [globalSpecPath, kernelSpec.name, 'kernel.json'].join(pathSeparator);
                    const interpreter = expectedInterpreters.find(
                        (item) => kernelSpec.language === PYTHON_LANGUAGE && item.path === kernelSpec.argv[0]
                    );
                    const spec = await loadKernelSpec(kernelspecFile, instance(fs));
                    if (spec) {
                        expectedKernelSpecs.push(<KernelConnectionMetadata>{
                            id: getKernelId(spec!, interpreter),
                            kernelSpec: spec,
                            interpreter,
                            kind: 'startUsingLocalKernelSpec'
                        });
                    }
                })
            );
            await Promise.all(
                expectedInterpreterKernelSpecFiles.map(async ({ interpreter, kernelspec }) => {
                    const kernelSpecFile = [
                        interpreter.sysPrefix,
                        'share',
                        'jupyter',
                        'kernels',
                        kernelspec.name,
                        'kernel.json'
                    ].join(pathSeparator);
                    const spec = await loadKernelSpec(kernelSpecFile, instance(fs), interpreter);
                    if (spec) {
                        expectedKernelSpecs.push(<KernelConnectionMetadata>{
                            id: getKernelId(spec!, interpreter),
                            kernelSpec: spec,
                            interpreter: spec.language === PYTHON_LANGUAGE ? interpreter : undefined,
                            kind:
                                spec.language === PYTHON_LANGUAGE
                                    ? 'startUsingPythonInterpreter'
                                    : 'startUsingLocalKernelSpec'
                        });
                    }
                })
            );
            await Promise.all(
                expectedInterpreters.map(async (interpreter) => {
                    const spec = createInterpreterKernelSpec(interpreter, globalSpecPath);
                    expectedKernelSpecs.push(<KernelConnectionMetadata>{
                        id: getKernelId(spec!, interpreter),
                        kernelSpec: spec,
                        interpreter,
                        kind: 'startUsingPythonInterpreter'
                    });
                })
            );
            expectedKernelSpecs.sort((a, b) => a.id.localeCompare(b.id));
            return expectedKernelSpecs;
        }
        type ExpectedKernels = {
            /**
             * Expected list of global kernelspecs.
             */
            expectedGlobalKernelSpecs?: KernelSpec.ISpecModel[];
            /**
             * Expected list of kernlespecs that are associated with a Python interpreter.
             */
            expectedInterpreterKernelSpecFiles?: {
                interpreter: PythonEnvironment;
                kernelspec: KernelSpec.ISpecModel;
            }[];
            /**
             * Expected list of kernlespecs used to start Python environments.
             */
            expectedInterpreters?: PythonEnvironment[];
        };
        type ExpectedKernel =
            | {
                  /**
                   * Expected global kernelspec.
                   */
                  expectedGlobalKernelSpec: KernelSpec.ISpecModel;
              }
            /**
             * Expected list of kernlespecs that are associated with a Python interpreter.
             */
            | {
                  expectedInterpreterKernelSpecFile: {
                      interpreter: PythonEnvironment;
                      kernelspec: KernelSpec.ISpecModel;
                  };
              }
            /**
             * Expected Python environment that will be used to start the kernel.
             */
            | { expectedInterpreter: PythonEnvironment };
        /**
         * Gets the list of kernels from the kernel provider and compares them against what's expected.
         */
        async function verifyKernels(expectations: ExpectedKernels) {
            const actualKernels = await kernelFinder.listKernels(undefined);
            const expectedKernels = await generateExpectedKernels(
                expectations.expectedGlobalKernelSpecs || [],
                expectations.expectedInterpreterKernelSpecFiles || [],
                expectations.expectedInterpreters || []
            );

            assert.equal(actualKernels.length, expectedKernels.length, 'Incorrect # of kernels');
            actualKernels.sort((a, b) => a.id.localeCompare(b.id));
            expectedKernels.sort((a, b) => a.id.localeCompare(b.id));
            try {
                assert.deepEqual(actualKernels, expectedKernels, 'Incorrect kernels');
            } catch (ex) {
                // Compare them one by one for better errors.
                actualKernels.forEach((actual, index) => {
                    const expected = expectedKernels[index];
                    assert.deepEqual(actual, expected);
                });
            }
        }
        async function verifyKernel(
            actualKernel: KernelConnectionMetadata | undefined,
            expectedKernelInfo: ExpectedKernel
        ) {
            const expectedGlobalKernelSpecs =
                'expectedGlobalKernelSpec' in expectedKernelInfo ? [expectedKernelInfo.expectedGlobalKernelSpec] : [];

            const expectedKernels = await generateExpectedKernels(
                expectedGlobalKernelSpecs,
                'expectedInterpreterKernelSpecFile' in expectedKernelInfo
                    ? [expectedKernelInfo.expectedInterpreterKernelSpecFile]
                    : [],
                'expectedInterpreter' in expectedKernelInfo ? [expectedKernelInfo.expectedInterpreter] : []
            );
            const expectedKernel = expectedKernels.find((item) => {
                // if we have a global kernel, then we are expected to start a kernelspec.
                if (expectedGlobalKernelSpecs.length) {
                    return item.kind === 'startUsingLocalKernelSpec';
                }
                return item.kind === 'startUsingPythonInterpreter';
            });
            assert.deepEqual(actualKernel, expectedKernel, 'Incorrect kernels');
        }
        test('Discover global kernelspecs (without Python)', async () => {
            const testData: TestData = {
                globalKernelSpecs: [juliaKernelSpec, javaKernelSpec, fullyQualifiedPythonKernelSpec],
                interpreters: []
            };
            await initialize(testData);
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(false);

            await verifyKernels({
                expectedGlobalKernelSpecs: [juliaKernelSpec, javaKernelSpec, fullyQualifiedPythonKernelSpec]
            });
        });
        test('Discover global custom Python kernelspecs (without Python)', async () => {
            const testData: TestData = {
                globalKernelSpecs: [fullyQualifiedPythonKernelSpec],
                interpreters: []
            };
            await initialize(testData);
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(false);

            await verifyKernels({
                expectedGlobalKernelSpecs: [fullyQualifiedPythonKernelSpec],
                expectedInterpreters: []
            });
        });
        function verifyGlobalKernelSpec(actual: KernelConnectionMetadata | undefined, expected: KernelSpec.ISpecModel) {
            assert.ok(actual, `${expected.display_name} Kernelspec not found`);
            if (actual?.kind === 'connectToLiveKernel') {
                throw new Error('Incorrect value');
            }
            assert.strictEqual(actual?.kind, 'startUsingLocalKernelSpec');
            assert.strictEqual(
                actual?.kernelSpec.specFile,
                [globalSpecPath, expected.name, 'kernel.json'].join(pathSeparator)
            );
            Object.keys(expected).forEach((key) => {
                // We always mess around with the names, hence don't compare names.
                if (key === 'name') {
                    return;
                }
                const actualValue = (actual?.kernelSpec as any)[key] as any;
                if (key === 'env' || key === 'resources') {
                    assert.deepEqual(
                        actualValue || {},
                        expected[key] || {},
                        `Incorrect value for ${key} (kernel '${expected.display_name}')`
                    );
                } else {
                    assert.deepEqual(
                        actualValue,
                        expected[key],
                        `Incorrect value for ${key} (kernel '${expected.display_name}')`
                    );
                }
            });
        }
        test('Verify Global KernelSpecs', async () => {
            const testData: TestData = {
                globalKernelSpecs: [
                    juliaKernelSpec,
                    javaKernelSpec,
                    defaultPython3Kernel,
                    fullyQualifiedPythonKernelSpec
                ]
            };
            await initialize(testData);
            const kernels = await kernelFinder.listKernels(undefined);
            verifyGlobalKernelSpec(
                kernels.find((item) => item.kernelSpec.display_name === juliaKernelSpec.display_name),
                juliaKernelSpec
            );
            verifyGlobalKernelSpec(
                kernels.find((item) => item.kernelSpec.display_name === javaKernelSpec.display_name),
                javaKernelSpec
            );
            verifyGlobalKernelSpec(
                kernels.find((item) => item.kernelSpec.display_name === defaultPython3Kernel.display_name),
                defaultPython3Kernel
            );
            verifyGlobalKernelSpec(
                kernels.find((item) => item.kernelSpec.display_name === fullyQualifiedPythonKernelSpec.display_name),
                fullyQualifiedPythonKernelSpec
            );
        });
        [
            undefined,
            python2Global,
            python38VenvEnv,
            python36Global,
            python37Global,
            python39PyEnv_HelloWorld,
            condaEnv1
        ].forEach((activePythonEnv) => {
            suite(
                activePythonEnv ? `With active Python (${activePythonEnv.displayName})` : 'without active Python',
                () => {
                    test('Discover global custom Python kernelspecs', async () => {
                        const testData: TestData = {
                            globalKernelSpecs: [fullyQualifiedPythonKernelSpec],
                            interpreters: [{ interpreter: python38VenvEnv }]
                        };
                        await initialize(testData, activePythonEnv);
                        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                        await verifyKernels({
                            expectedGlobalKernelSpecs: [fullyQualifiedPythonKernelSpec],
                            expectedInterpreters: [python38VenvEnv].concat(activePythonEnv ? [activePythonEnv] : [])
                        });
                    });
                    test('Discover default Python kernelspecs with env vars', async () => {
                        const testData: TestData = {
                            interpreters: [
                                {
                                    interpreter: python38VenvEnv,
                                    kernelSpecs: [defaultPython3KernelWithEnvVars]
                                }
                            ]
                        };
                        await initialize(testData, activePythonEnv);
                        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                        await verifyKernels({
                            expectedInterpreterKernelSpecFiles: [
                                {
                                    interpreter: python38VenvEnv,
                                    kernelspec: defaultPython3KernelWithEnvVars
                                }
                            ],
                            expectedInterpreters: [python38VenvEnv].concat(activePythonEnv ? [activePythonEnv] : [])
                        });
                    });
                    test('Discover multiple global kernelspecs and a custom Python kernelspecs', async () => {
                        const testData: TestData = {
                            globalKernelSpecs: [juliaKernelSpec, javaKernelSpec, fullyQualifiedPythonKernelSpec],
                            interpreters: [{ interpreter: python38VenvEnv }]
                        };
                        await initialize(testData, activePythonEnv);
                        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                        await verifyKernels({
                            expectedGlobalKernelSpecs: [
                                juliaKernelSpec,
                                javaKernelSpec,
                                fullyQualifiedPythonKernelSpec
                            ],
                            expectedInterpreters: [python38VenvEnv].concat(activePythonEnv ? [activePythonEnv] : [])
                        });
                    });
                    test('Discover multiple global kernelspecs and a custom Python kernelspecs with env vars', async () => {
                        const testData: TestData = {
                            globalKernelSpecs: [
                                juliaKernelSpec,
                                javaKernelSpec,
                                fullyQualifiedPythonKernelSpec,
                                fullyQualifiedPythonKernelSpecWithEnv
                            ],
                            interpreters: [python38VenvEnv]
                        };
                        await initialize(testData, activePythonEnv);
                        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                        await verifyKernels({
                            expectedGlobalKernelSpecs: [
                                juliaKernelSpec,
                                javaKernelSpec,
                                fullyQualifiedPythonKernelSpec,
                                fullyQualifiedPythonKernelSpecWithEnv
                            ],
                            expectedInterpreters: [python38VenvEnv].concat(activePythonEnv ? [activePythonEnv] : [])
                        });
                    });
                    test('Default Python kernlespecs should be ignored', async () => {
                        const testData: TestData = {
                            interpreters: [
                                {
                                    interpreter: python39PyEnv_HelloWorld,
                                    kernelSpecs: [defaultPython3Kernel]
                                }
                            ]
                        };
                        await initialize(testData, activePythonEnv);
                        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                        const expectedKernels: ExpectedKernels = {
                            expectedInterpreters: [python39PyEnv_HelloWorld].concat(
                                activePythonEnv ? [activePythonEnv] : []
                            )
                        };

                        await verifyKernels(expectedKernels);
                    });
                    test('Custom Python Kernels with custom env variables are listed', async () => {
                        const testData: TestData = {
                            globalKernelSpecs: [juliaKernelSpec],
                            interpreters: [
                                {
                                    interpreter: python39PyEnv_HelloWorld,
                                    kernelSpecs: [
                                        defaultPython3Kernel,
                                        defaultPython3KernelWithEnvVars,
                                        customPythonKernelWithCustomArgv,
                                        customPythonKernelWithCustomEnv
                                    ]
                                }
                            ]
                        };
                        await initialize(testData, activePythonEnv);
                        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                        const expectedKernels: ExpectedKernels = {
                            expectedGlobalKernelSpecs: [juliaKernelSpec],
                            expectedInterpreterKernelSpecFiles: [
                                {
                                    interpreter: python39PyEnv_HelloWorld,
                                    kernelspec: defaultPython3KernelWithEnvVars
                                },
                                {
                                    interpreter: python39PyEnv_HelloWorld,
                                    kernelspec: customPythonKernelWithCustomArgv
                                },
                                {
                                    interpreter: python39PyEnv_HelloWorld,
                                    kernelspec: customPythonKernelWithCustomEnv
                                }
                            ],
                            expectedInterpreters: [python39PyEnv_HelloWorld].concat(
                                activePythonEnv ? [activePythonEnv] : []
                            )
                        };

                        await verifyKernels(expectedKernels);
                    });
                    test('Multiple global & custom Python Kernels', async () => {
                        const testData: TestData = {
                            globalKernelSpecs: [juliaKernelSpec],
                            interpreters: [
                                {
                                    interpreter: python39PyEnv_HelloWorld,
                                    kernelSpecs: [
                                        defaultPython3Kernel,
                                        defaultPython3KernelWithEnvVars,
                                        customPythonKernelWithCustomArgv,
                                        customPythonKernelWithCustomEnv
                                    ]
                                },
                                python36Global,
                                {
                                    interpreter: python37Global,
                                    kernelSpecs: [defaultPython3Kernel]
                                },
                                {
                                    interpreter: condaEnv1,
                                    kernelSpecs: [javaKernelSpec]
                                }
                            ]
                        };
                        await initialize(testData, activePythonEnv);
                        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

                        const expectedKernels: ExpectedKernels = {
                            expectedGlobalKernelSpecs: [juliaKernelSpec],
                            expectedInterpreterKernelSpecFiles: [
                                {
                                    interpreter: python39PyEnv_HelloWorld,
                                    kernelspec: defaultPython3KernelWithEnvVars
                                },
                                {
                                    interpreter: python39PyEnv_HelloWorld,
                                    kernelspec: customPythonKernelWithCustomArgv
                                },
                                {
                                    interpreter: python39PyEnv_HelloWorld,
                                    kernelspec: customPythonKernelWithCustomEnv
                                },
                                {
                                    interpreter: condaEnv1,
                                    kernelspec: javaKernelSpec
                                }
                            ],
                            expectedInterpreters: [
                                python39PyEnv_HelloWorld,
                                python36Global,
                                python37Global,
                                condaEnv1
                            ].concat(activePythonEnv ? [activePythonEnv] : [])
                        };

                        await verifyKernels(expectedKernels);
                    });
                    test('Can match based on notebook metadata', async () => {
                        const testData: TestData = {
                            globalKernelSpecs: [juliaKernelSpec, rKernelSpec, rV1KernelSpec, python2spec],
                            interpreters: [
                                {
                                    interpreter: python36Global,
                                    kernelSpecs: [defaultPython3Kernel]
                                },
                                {
                                    interpreter: python39PyEnv_HelloWorld,
                                    kernelSpecs: [
                                        defaultPython3Kernel,
                                        defaultPython3KernelWithEnvVars,
                                        customPythonKernelWithCustomArgv,
                                        customPythonKernelWithCustomEnv
                                    ]
                                },
                                {
                                    interpreter: python37Global,
                                    kernelSpecs: [defaultPython3Kernel]
                                },
                                {
                                    interpreter: condaEnv1,
                                    kernelSpecs: [javaKernelSpec]
                                },
                                {
                                    interpreter: python38PyEnv_temp1,
                                    kernelSpecs: [defaultPython3Kernel, customPythonKernelWithCustomEnv]
                                },
                                {
                                    interpreter: python38PyEnv_temp2_duplicateNameAsTemp1,
                                    kernelSpecs: [defaultPython3Kernel]
                                },
                                {
                                    interpreter: python38PyEnv_temp3_duplicateNameAsTemp1,
                                    kernelSpecs: [defaultPython3Kernel]
                                },
                                {
                                    interpreter: python38PyEnv_temp4_duplicateNameAsTemp1ButNoBin,
                                    kernelSpecs: [defaultPython3Kernel, customPythonKernelWithCustomEnv]
                                },
                                {
                                    interpreter: duplicate1OfPython38PyEnv_temp1
                                },
                                {
                                    interpreter: python2Global
                                }
                            ]
                        };
                        await initialize(testData, activePythonEnv);
                        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
                        const nbUri = Uri.file('test.ipynb');
                        let kernel: KernelConnectionMetadata | undefined;

                        // Try an empty python Notebook without any kernelspec in metadata.
                        kernel = await kernelFinder.findKernel(nbUri, {
                            language_info: { name: PYTHON_LANGUAGE },
                            orig_nbformat: 4
                        });
                        assert.equal(kernel?.kernelSpec?.language, 'python');
                        assert.strictEqual(kernel?.kind, 'startUsingPythonInterpreter');
                        assert.notStrictEqual(
                            getKernelRegistrationInfo(kernel!.kernelSpec),
                            'registeredByNewVersionOfExtForCustomKernelSpec'
                        );
                        if (activePythonEnv) {
                            await verifyKernel(kernel, { expectedInterpreter: activePythonEnv });
                        }

                        // Generic Python 3 notebooks.
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: 'Python 3',
                                name: 'python3'
                            },
                            language_info: { name: PYTHON_LANGUAGE },
                            orig_nbformat: 4
                        });
                        assert.equal(kernel?.kernelSpec?.language, 'python');
                        assert.strictEqual(kernel?.kind, 'startUsingPythonInterpreter');
                        assert.notStrictEqual(
                            getKernelRegistrationInfo(kernel!.kernelSpec),
                            'registeredByNewVersionOfExtForCustomKernelSpec'
                        );
                        if (activePythonEnv && activePythonEnv.version?.major && activePythonEnv.version?.major >= 3) {
                            await verifyKernel(kernel, { expectedInterpreter: activePythonEnv });
                        }

                        // Generic Python 3 notebooks (kernels with IpyKernel installed).
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: 'Python 3 (IPyKernel)',
                                name: 'python3'
                            },
                            language_info: { name: PYTHON_LANGUAGE },
                            orig_nbformat: 4
                        });
                        assert.equal(kernel?.kernelSpec?.language, 'python');
                        assert.strictEqual(kernel?.kind, 'startUsingPythonInterpreter');
                        assert.notStrictEqual(
                            getKernelRegistrationInfo(kernel!.kernelSpec),
                            'registeredByNewVersionOfExtForCustomKernelSpec'
                        );
                        if (activePythonEnv && activePythonEnv.version?.major && activePythonEnv.version?.major >= 3) {
                            await verifyKernel(kernel, { expectedInterpreter: activePythonEnv });
                        }

                        // Python 2
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: 'Python 2 on Disk',
                                name: 'python2'
                            },
                            language_info: { name: PYTHON_LANGUAGE },
                            orig_nbformat: 4
                        });
                        assert.equal(kernel?.kernelSpec?.display_name, 'Python 2 on Disk');
                        assert.equal(kernel?.kernelSpec?.language, 'python');
                        assert.strictEqual(kernel?.kind, 'startUsingLocalKernelSpec');
                        assert.notStrictEqual(
                            getKernelRegistrationInfo(kernel!.kernelSpec),
                            'registeredByNewVersionOfExtForCustomKernelSpec'
                        );
                        await verifyKernel(kernel, {
                            expectedGlobalKernelSpec: python2spec,
                            expectedInterpreter: python2Global
                        });

                        // Julia based on language
                        kernel = await kernelFinder.findKernel(nbUri, {
                            language_info: { name: 'julia' },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedGlobalKernelSpec: juliaKernelSpec });

                        // Julia based on kernelspec name & display name (without any language information)
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: juliaKernelSpec.display_name,
                                name: juliaKernelSpec.name
                            },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedGlobalKernelSpec: juliaKernelSpec });

                        // R (match a specific R kernel based on the display name & name)
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: rV1KernelSpec.display_name,
                                name: rV1KernelSpec.name
                            },
                            language_info: { name: 'r' },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedGlobalKernelSpec: rV1KernelSpec });

                        // R (match a specific R kernel based on the name)
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: '',
                                name: rV1KernelSpec.name
                            },
                            language_info: { name: 'r' },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedGlobalKernelSpec: rV1KernelSpec });

                        // R (match a specific R kernel based on the display_name)
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: rV1KernelSpec.display_name,
                                name: ''
                            },
                            language_info: { name: 'r' },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedGlobalKernelSpec: rV1KernelSpec });

                        // Python 2 based on name
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: 'Some unknown name for Python 2',
                                name: 'python2'
                            },
                            language_info: { name: PYTHON_LANGUAGE },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedInterpreter: python2Global });

                        // Python 2 based on display name
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: python2Global.displayName || '',
                                name: 'python2'
                            },
                            language_info: { name: PYTHON_LANGUAGE },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedInterpreter: python2Global });

                        // Match conda environment based on env display name of conda env.
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: '',
                                name: condaEnv1.envName || ''
                            },
                            language_info: { name: PYTHON_LANGUAGE },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedInterpreter: condaEnv1 });

                        // Match conda environment based on env display name of conda env.
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: condaEnv1.displayName || '',
                                name: condaEnv1.envName || ''
                            },
                            language_info: { name: PYTHON_LANGUAGE },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedInterpreter: condaEnv1 });

                        // Match conda environment based on env name of conda env (even if name doesn't match).
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: condaEnv1.displayName || '',
                                name: 'someUnknownNameThatWillNeverMatch'
                            },
                            language_info: { name: PYTHON_LANGUAGE },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedInterpreter: condaEnv1 });

                        // Match based on interpreter hash even if name and display name do not match.
                        kernel = await kernelFinder.findKernel(nbUri, {
                            kernelspec: {
                                display_name: 'Will never match',
                                name: 'someUnknownNameThatWillNeverMatch'
                            },
                            interpreter: {
                                hash: getInterpreterHash(condaEnv1)
                            },
                            language_info: { name: PYTHON_LANGUAGE },
                            orig_nbformat: 4
                        });
                        await verifyKernel(kernel, { expectedInterpreter: condaEnv1 });

                        // Unknown kernel language
                        kernel = await kernelFinder.findKernel(nbUri, {
                            language_info: { name: 'someunknownlanguage' },
                            orig_nbformat: 4
                        });
                        assert.isUndefined(kernel, 'Should not return a kernel');
                    });
                }
            );
        });
    });
});
