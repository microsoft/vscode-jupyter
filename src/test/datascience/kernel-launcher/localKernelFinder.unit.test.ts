/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { assert } from 'chai';
import * as path from 'path';
import { anything, instance, mock, when } from 'ts-mockito';
import { PathUtils } from '../../../client/common/platform/pathUtils';
import { IFileSystem, IPlatformService } from '../../../client/common/platform/types';
import { LocalKernelFinder } from '../../../client/datascience/kernel-launcher/localKernelFinder';
import { ILocalKernelFinder } from '../../../client/datascience/kernel-launcher/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import * as typemoq from 'typemoq';
import { IExtensionContext } from '../../../client/common/types';
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

[false, true].forEach((isWindows) => {
    suite(`Local Kernel Finder ${isWindows ? 'Windows' : 'Unix'}`, () => {
        let kernelFinder: ILocalKernelFinder;
        let interpreterService: IInterpreterService;
        let platformService: IPlatformService;
        let fs: IFileSystem;
        let context: typemoq.IMock<IExtensionContext>;
        let extensionChecker: IPythonExtensionChecker;
        const defaultPython3Name = 'python3';
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
        const activeInterpreter = python3Interpreter;
        const condaEnvironment: PythonEnvironment = {
            displayName: 'Conda Environment',
            path: '/usr/bin/conda/python3',
            sysPrefix: 'conda',
            envType: EnvironmentType.Conda
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
            interpreterService = mock(InterpreterService);
            when(interpreterService.getInterpreters(anything())).thenResolve([]);
            platformService = mock(PlatformService);
            when(platformService.isWindows).thenReturn(isWindows);
            when(platformService.isLinux).thenReturn(!isWindows);
            when(platformService.isMac).thenReturn(false);
            fs = mock(FileSystem);
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
            context = typemoq.Mock.ofType<IExtensionContext>();

            // Setup file system to return correct values.
            when(fs.searchLocal(anything(), anything(), true)).thenCall((_p, c, _d) => {
                if (c.startsWith('python')) {
                    return Promise.resolve(['interpreter.json']);
                }
                if (c.startsWith('conda')) {
                    return Promise.resolve(['interpreter.json']);
                }
                return Promise.resolve(['python3.json', 'python3dupe.json', 'julia.json', 'python2.json']);
            });
            when(fs.readLocalFile(anything())).thenCall((f) => {
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

            kernelFinder = new LocalKernelFinder(
                instance(interpreterService),
                instance(platformService),
                instance(fs),
                pathUtils,
                context.object,
                instance(workspaceService),
                instance(envVarsProvider),
                instance(extensionChecker)
            );
        });
        test('Kernels found on disk', async () => {
            const kernels = await kernelFinder.listKernels(undefined);
            assert.ok(kernels.length >= 3, 'Not enough kernels returned');
            assert.equal(
                getDisplayNameOrNameOfKernelConnection(kernels[0]),
                'Python 3 on Disk',
                'Did not find correct python kernel'
            );
            assert.equal(
                getDisplayNameOrNameOfKernelConnection(kernels[1]),
                'Julia on Disk',
                'Did not find correct julia kernel'
            );
            assert.equal(
                getDisplayNameOrNameOfKernelConnection(kernels[2]),
                'Python 2 on Disk',
                'Did not find correct python 2 kernel'
            );
        });
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
                condaEnvironmentBase
            ]);
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);

            const kernels = await kernelFinder.listKernels(undefined);

            // All the python3 kernels should have the intepreter
            const python3Kernels = kernels.filter((k) => k.kernelSpec && k.kernelSpec.name === defaultPython3Name);
            const interpreterKernels = python3Kernels.filter((k) => k.interpreter);
            assert.ok(python3Kernels.length > 0, 'No python 3 kernels');
            assert.equal(interpreterKernels.length, python3Kernels.length, 'Interpreter kernels not found');
            assert.notOk(
                interpreterKernels.find((k) => k.interpreter !== python3Interpreter),
                'Interpreter kernels should all be python 3 interpreter'
            );

            // No other kernels should have the python 3 inteprreter
            const nonPython3Kernels = kernels.filter((k) => k.kernelSpec && k.kernelSpec.name !== defaultPython3Name);
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

            // Try python
            let kernel = await kernelFinder.findKernel(undefined, {
                language_info: { name: PYTHON_LANGUAGE },
                orig_nbformat: 4
            });
            assert.ok(kernel, 'No python kernel found matching notebook metadata');

            // Julia
            kernel = await kernelFinder.findKernel(undefined, {
                language_info: { name: 'julia' },
                orig_nbformat: 4
            });
            assert.ok(kernel, 'No julia kernel found matching notebook metadata');

            // Python 2
            kernel = await kernelFinder.findKernel(undefined, {
                kernelspec: {
                    display_name: 'Python 2 on Disk',
                    name: 'python2'
                },
                language_info: { name: PYTHON_LANGUAGE },
                orig_nbformat: 4
            });
            assert.ok(kernel, 'No python2 kernel found matching notebook metadata');

            // Interpreter name
            kernel = await kernelFinder.findKernel(undefined, {
                kernelspec: {
                    display_name: 'Some oddball kernel',
                    name: getInterpreterKernelSpecName(condaEnvironment)
                },
                language_info: { name: PYTHON_LANGUAGE },
                orig_nbformat: 4
            });
            assert.ok(kernel, 'No interpreter kernel found matching notebook metadata');

            // Generic python 3
            kernel = await kernelFinder.findKernel(undefined, {
                kernelspec: {
                    display_name: 'Python 3',
                    name: defaultPython3Name
                },
                language_info: { name: PYTHON_LANGUAGE },
                orig_nbformat: 4
            });
            assert.ok(kernel, 'No kernel found matching default notebook metadata');

            // Unknown case (same as using active interpreter)
            kernel = await kernelFinder.findKernel(undefined, {
                kernelspec: {
                    display_name: 'notagoodname',
                    name: 'notagoodname'
                },
                language_info: { name: 'unknown' },
                orig_nbformat: 4
            });
            const activeKernel = await kernelFinder.findKernel(undefined, activeInterpreter);
            assert.deepEqual(kernel, activeKernel, 'Active kernel not found');
        });
        test('Can match based on interpreter', async () => {
            when(interpreterService.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
            when(interpreterService.getInterpreters(anything())).thenResolve([
                python3Interpreter,
                condaEnvironment,
                python2Interpreter,
                condaEnvironmentBase
            ]);
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
            let kernel = await kernelFinder.findKernel(undefined, python3Interpreter);
            assert.ok(kernel, 'No python 3 kernel found matching interpreter');
            assert.equal(
                kernel?.kernelSpec?.display_name,
                python3Interpreter.displayName,
                'Kernel found does not match python 3 interpreter name'
            );
            assert.ok(kernel?.interpreter, 'No interpreter for matching based on interpreter');
            kernel = await kernelFinder.findKernel(undefined, python2Interpreter);
            assert.ok(kernel, 'No python 2 kernel found matching interpreter');
            assert.equal(
                kernel?.interpreter?.path,
                python2Interpreter.path,
                'Kernel found does not match python 2 path'
            );
            kernel = await kernelFinder.findKernel(undefined, condaEnvironment);
            assert.ok(kernel, 'No conda kernel found matching interpreter');
            assert.equal(
                kernel?.kernelSpec?.display_name,
                condaEnvironment.displayName,
                'Kernel found does not match conda interpreter name'
            );
        });
    });
});
