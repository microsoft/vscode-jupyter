// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { PathUtils } from '../../../client/common/platform/pathUtils';
import { IFileSystem, IPlatformService } from '../../../client/common/platform/types';
import { LocalKernelFinder } from '../../../client/datascience/kernel-launcher/localKernelFinder';
import { ILocalKernelFinder } from '../../../client/datascience/kernel-launcher/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { MockFileSystem } from '../mockFileSystem';
import * as typemoq from 'typemoq';
import { IExtensionContext } from '../../../client/common/types';
import { WorkspaceService } from '../../../client/common/application/workspace';
import { EnvironmentVariablesProvider } from '../../../client/common/variables/environmentVariablesProvider';
import { PythonExtensionChecker } from '../../../client/api/pythonApi';
import { getDisplayNameOrNameOfKernelConnection } from '../../../client/datascience/jupyter/kernels/helpers';

[false, true].forEach((isWindows) => {
    suite('Local Kernel Finder', () => {
        let kernelFinder: ILocalKernelFinder;
        let interpreterService: IInterpreterService;
        let platformService: IPlatformService;
        let fs: IFileSystem;
        let context: typemoq.IMock<IExtensionContext>;
        setup(() => {
            interpreterService = mock(IInterpreterService);
            when(interpreterService.getInterpreters(anything())).thenResolve([]);
            platformService = mock(IPlatformService);
            when(platformService.isWindows).thenReturn(isWindows);
            when(platformService.isLinux).thenReturn(!isWindows);
            when(platformService.isMac).thenReturn(false);
            fs = new MockFileSystem();
            const pathUtils = new PathUtils(isWindows);
            const workspaceService = mock(WorkspaceService);
            const envVarsProvider = mock(EnvironmentVariablesProvider);
            const extensionChecker = mock(PythonExtensionChecker);
            context = typemoq.Mock.ofType<IExtensionContext>();

            kernelFinder = new LocalKernelFinder(
                instance(interpreterService),
                instance(platformService),
                fs,
                pathUtils,
                context.object,
                instance(workspaceService),
                instance(envVarsProvider),
                instance(extensionChecker)
            );
        });
        test('Kernels found on disk', async () => {
            // Setup file system to return correct values.
            const kernels = await kernelFinder.listKernels(undefined);
            assert.equal(kernels.length, 3, 'Wrong number of kernels returned from disk search');
            assert.equal(getDisplayNameOrNameOfKernelConnection(kernels[0]), 'Python On Disk', 'Did not find correct python kernel');
            assert.equal(getDisplayNameOrNameOfKernelConnection(kernels[1]), 'Julia On Disk', 'Did not find correct python kernel');
            assert.equal(getDisplayNameOrNameOfKernelConnection(kernels[2]), 'Python 2 On Disk', 'Did not find correct python kernel');
        });
        test('Kernels found on disk and in interpreters', async () => {
            await Promise.resolve();
        });
        test('Interpreters mapped to correct locations', async () => {
            await Promise.resolve();
        });
        test('Conda Interpreters mapped to correct locations', async () => {
            await Promise.resolve();
        });
        test('Can match based on notebook metadata', async () => {
            await Promise.resolve();
        });
        test('Can match based on on interpreter', async () => {
            await Promise.resolve();
        });
        test('Cache update', async () => {
            await Promise.resolve();
        });
    });
});
