// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable local-rules/dont-use-process */

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { Uri, WorkspaceConfiguration } from 'vscode';
import { IPlatformService } from '../../../../platform/common/platform/types';
import { TrustedKernelPaths } from '../../../../kernels/raw/finder/trustedKernelPaths.node';
import { ITrustedKernelPaths } from '../../../../kernels/raw/finder/types';
import { IWorkspaceService } from '../../../../platform/common/application/types';

suite('Trusted Kernel paths', () => {
    suite('Desktop', () => {
        let trustedKernelPaths: ITrustedKernelPaths;
        let jupyterConfig: WorkspaceConfiguration;
        let platform: IPlatformService;
        const oldValueForPROGRAMDATA = process.env['PROGRAMDATA'];
        setup(createTrustedPathService);
        function createTrustedPathService() {
            jupyterConfig = mock<WorkspaceConfiguration>();
            when(jupyterConfig.get('kernels.trusted', anything())).thenCall((_, defaultValue) => defaultValue);
            const workspace = mock<IWorkspaceService>();
            when(workspace.getConfiguration('jupyter', anything())).thenReturn(instance(jupyterConfig));
            platform = mock<IPlatformService>();
            trustedKernelPaths = new TrustedKernelPaths(instance(platform), instance(workspace));
        }
        teardown(() => {
            process.env['PROGRAMDATA'] = oldValueForPROGRAMDATA;
        });
        test('All paths are trusted on Mac', () => {
            when(platform.isWindows).thenReturn(false);
            when(platform.isMac).thenReturn(true);
            when(platform.isLinux).thenReturn(false);

            assert.isTrue(trustedKernelPaths.isTrusted(Uri.file('foo')));
        });
        test('All paths are trusted on Linux', () => {
            when(platform.isWindows).thenReturn(false);
            when(platform.isMac).thenReturn(false);
            when(platform.isLinux).thenReturn(true);

            assert.isTrue(trustedKernelPaths.isTrusted(Uri.file('foo')));
        });
        test('Some paths are not trusted in windows', async () => {
            process.env['PROGRAMDATA'] = 'C:/ProgramData';

            createTrustedPathService();
            when(platform.isWindows).thenReturn(true);

            assert.isTrue(trustedKernelPaths.isTrusted(Uri.file('foo')));
            assert.isTrue(trustedKernelPaths.isTrusted(Uri.file('C:/Something/venv/shared/jupyter/kernels/foo.json')));
            assert.isTrue(trustedKernelPaths.isTrusted(Uri.file('C:/Windows/venv/shared/jupyter/kernels/foo.json')));
            assert.isTrue(trustedKernelPaths.isTrusted(Uri.file('C:/Program Files/jupyter/kernels/foo.json')));

            // Untrusted paths
            assert.isFalse(trustedKernelPaths.isTrusted(Uri.file('C:/ProgramData/jupyter/kernels/a/foo.json')));
            assert.isFalse(trustedKernelPaths.isTrusted(Uri.file('C:/ProgramData/jupyter/kernels/b/foo.json')));

            // Trust and check again
            when(jupyterConfig.get('kernels.trusted', anything())).thenReturn([
                'C:/ProgramData/jupyter/kernels/a/foo.json'
            ]);
            assert.isTrue(trustedKernelPaths.isTrusted(Uri.file('C:/ProgramData/jupyter/kernels/a/foo.json')));
            assert.isFalse(trustedKernelPaths.isTrusted(Uri.file('C:/ProgramData/jupyter/kernels/b/foo.json')));

            // Trust and check again
            when(jupyterConfig.get('kernels.trusted', anything())).thenReturn([
                'C:/ProgramData/jupyter/kernels/b/foo.json',
                'C:/ProgramData/jupyter/kernels/a/foo.json'
            ]);
            assert.isTrue(trustedKernelPaths.isTrusted(Uri.file('C:/ProgramData/jupyter/kernels/a/foo.json')));
            assert.isTrue(trustedKernelPaths.isTrusted(Uri.file('C:/ProgramData/jupyter/kernels/b/foo.json')));
        });
    });
});
