// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as path from '../platform/vscode-path/path';
import { anything, instance, mock, when } from 'ts-mockito';
import { Uri, WorkspaceFolder } from 'vscode';
import { IWorkspaceService } from '../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../platform/common/constants';
import { IFileSystem } from '../platform/common/platform/types';
import { IConfigurationService, IWatchableJupyterSettings } from '../platform/common/types';
import { uriEquals } from '../test/datascience/helpers';
import { KernelWorkingFolder } from './kernelWorkingFolder.node';
import {
    IJupyterKernelSpec,
    IKernel,
    KernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from './types';

suite('KernelWorkingFolder', function () {
    let configService: IConfigurationService;
    let fs: IFileSystem;
    let workspace: IWorkspaceService;
    let kernelWorkingFolder: KernelWorkingFolder;
    let kernel: IKernel;
    let connectionMetadata: KernelConnectionMetadata;
    let kernelSpec: IJupyterKernelSpec;
    let settings: IWatchableJupyterSettings;
    let workspaceFolder: WorkspaceFolder;
    setup(() => {
        configService = mock<IConfigurationService>();
        settings = mock<IWatchableJupyterSettings>();
        fs = mock<IFileSystem>();
        workspace = mock<IWorkspaceService>();
        kernelWorkingFolder = new KernelWorkingFolder(instance(configService), instance(fs), instance(workspace));
        kernel = mock<IKernel>();
        connectionMetadata = mock<KernelConnectionMetadata>();
        kernelSpec = mock<IJupyterKernelSpec>();
        when(configService.getSettings(anything())).thenReturn(instance(settings));
        when(kernel.kernelConnectionMetadata).thenReturn(instance(connectionMetadata));
    });
    test('No working folder for Remote Kernel Specs', async () => {
        when(connectionMetadata.kind).thenReturn('startUsingRemoteKernelSpec');
        assert.isUndefined(await kernelWorkingFolder.getWorkingDirectory(instance(kernel)));
    });
    test('No working folder for Remote Kernel', async () => {
        when(connectionMetadata.kind).thenReturn('connectToLiveRemoteKernel');
        assert.isUndefined(await kernelWorkingFolder.getWorkingDirectory(instance(kernel)));
    });
    test('No working folder for Non-Python Local Kernelspec', async () => {
        let localKernelSpec = connectionMetadata as LocalKernelSpecConnectionMetadata;
        when(localKernelSpec.kind).thenReturn('startUsingLocalKernelSpec');
        when(localKernelSpec.kernelSpec).thenReturn(instance(kernelSpec));
        when(kernelSpec.language).thenReturn('Java');
        assert.isUndefined(await kernelWorkingFolder.getWorkingDirectory(instance(kernel)));
    });
    const connectionType: ['startUsingLocalKernelSpec', 'startUsingPythonInterpreter'] = [
        'startUsingLocalKernelSpec',
        'startUsingPythonInterpreter'
    ];
    connectionType.forEach((item) => {
        workspaceFolder = { index: 0, name: 'one', uri: Uri.file(__dirname) };
        suite(`Python Kernels for ${item}`, () => {
            setup(() => {
                if (item === 'startUsingLocalKernelSpec') {
                    let localKernelSpec = connectionMetadata as LocalKernelSpecConnectionMetadata;
                    when(localKernelSpec.kind).thenReturn(item);
                    when(localKernelSpec.kernelSpec).thenReturn(instance(kernelSpec));
                    when(kernelSpec.language).thenReturn(PYTHON_LANGUAGE);
                } else {
                    let pythonKernel = connectionMetadata as PythonKernelConnectionMetadata;
                    when(pythonKernel.kind).thenReturn('startUsingPythonInterpreter');
                }
                when(fs.exists(uriEquals(__dirname))).thenResolve(true);
            });
            test(`Has working folder`, async () => {
                when(settings.notebookFileRoot).thenReturn(__dirname);
                when(workspace.hasWorkspaceFolders).thenReturn(true);
                when(workspace.workspaceFolders).thenReturn([workspaceFolder]);

                const uri = await kernelWorkingFolder.getWorkingDirectory(instance(kernel));

                assert.strictEqual(uri?.toString(), Uri.file(__dirname).toString());
            });
            test('No working folder if setting `notebookFileRoot` is invalid', async () => {
                when(settings.notebookFileRoot).thenReturn('bogus value');
                when(workspace.hasWorkspaceFolders).thenReturn(true);
                when(workspace.workspaceFolders).thenReturn([workspaceFolder]);
                when(fs.exists(anything())).thenResolve(false);

                assert.isUndefined(await kernelWorkingFolder.getWorkingDirectory(instance(kernel)));
            });
            test('Has working folder and points to first workspace folder if setting `notebookFileRoot` points to non-existent path', async () => {
                when(settings.notebookFileRoot).thenReturn(path.join(__dirname, 'xyz1234'));
                when(workspace.hasWorkspaceFolders).thenReturn(true);
                when(workspace.workspaceFolders).thenReturn([workspaceFolder]);
                when(fs.exists(anything())).thenResolve(false);
                when(fs.exists(uriEquals(__dirname))).thenResolve(true);

                const uri = await kernelWorkingFolder.getWorkingDirectory(instance(kernel));

                assert.strictEqual(uri?.toString(), workspaceFolder.uri.toString());
            });
            test('Has working folder and points to folder of kernel resource when there are no workspace folders', async () => {
                when(settings.notebookFileRoot).thenReturn(path.join(__dirname, 'xyz1234'));
                when(workspace.hasWorkspaceFolders).thenReturn(false);
                when(workspace.workspaceFolders).thenReturn([]);
                when(fs.exists(anything())).thenResolve(false);
                when(fs.exists(uriEquals(__dirname))).thenResolve(false);
                const kernelResourceUri = Uri.file(path.join(__dirname, 'dev', 'kernel.ipynb'));
                when(kernel.resourceUri).thenReturn(kernelResourceUri);
                when(fs.exists(uriEquals(kernelResourceUri))).thenResolve(true);
                when(fs.exists(uriEquals(path.join(__dirname, 'dev')))).thenResolve(true);

                const uri = await kernelWorkingFolder.getWorkingDirectory(instance(kernel));

                assert.strictEqual(uri?.toString(), Uri.file(path.join(__dirname, 'dev')).toString());
            });
            test('No working folder if no workspace folders', async () => {
                when(settings.notebookFileRoot).thenReturn(__dirname);
                when(workspace.hasWorkspaceFolders).thenReturn(false);
                when(workspace.workspaceFolders).thenReturn([]);
                when(fs.exists(anything())).thenResolve(false);

                assert.isUndefined(await kernelWorkingFolder.getWorkingDirectory(instance(kernel)));
            });
        });
    });
});
