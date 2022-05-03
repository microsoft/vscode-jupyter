// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { expect } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import * as vscode from 'vscode';
import { PythonExtensionChecker } from '../../../platform/api/pythonApi';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { IJupyterSettings } from '../../../platform/common/types';
import { IJupyterSession, KernelConnectionMetadata } from '../../../platform/../kernels/types';
import { NotebookProvider } from '../../../kernels/jupyter/launcher/notebookProvider';
import { DisplayOptions } from '../../../kernels/displayOptions';
import { IJupyterNotebookProvider } from '../../../kernels/jupyter/types';
import { IRawNotebookProvider } from '../../../kernels/raw/types';

function Uri(filename: string): vscode.Uri {
    return vscode.Uri.file(filename);
}

/* eslint-disable  */
suite('DataScience - NotebookProvider', () => {
    let notebookProvider: NotebookProvider;
    let jupyterNotebookProvider: IJupyterNotebookProvider;
    let rawNotebookProvider: IRawNotebookProvider;
    let dataScienceSettings: IJupyterSettings;
    let cancelToken: vscode.CancellationTokenSource;
    setup(() => {
        jupyterNotebookProvider = mock<IJupyterNotebookProvider>();
        rawNotebookProvider = mock<IRawNotebookProvider>();
        const workspaceService = mock<IWorkspaceService>();
        const configService = mock<ConfigurationService>();
        cancelToken = new vscode.CancellationTokenSource();
        // Set up our settings
        dataScienceSettings = mock<IJupyterSettings>();
        when(workspaceService.hasWorkspaceFolders).thenReturn(false);
        when(dataScienceSettings.jupyterServerType).thenReturn('local');
        when(dataScienceSettings.useDefaultConfigForJupyter).thenReturn(true);
        when(rawNotebookProvider.isSupported).thenReturn(false);
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(configService.getSettings(anything())).thenReturn(instance(dataScienceSettings) as any);

        notebookProvider = new NotebookProvider(
            instance(rawNotebookProvider),
            instance(jupyterNotebookProvider),
            instance(extensionChecker),
            instance(configService)
        );
    });
    teardown(() => cancelToken.dispose());
    test('NotebookProvider getOrCreateNotebook jupyter provider does not have notebook already', async () => {
        const mockSession = mock<IJupyterSession>();
        instance(mockSession as any).then = undefined;
        when(jupyterNotebookProvider.createNotebook(anything())).thenResolve(instance(mockSession));
        when(jupyterNotebookProvider.connect(anything())).thenResolve({} as any);
        const doc = mock<vscode.NotebookDocument>();
        when(doc.uri).thenReturn(Uri('C:\\\\foo.py'));

        const session = await notebookProvider.create({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token,
            creator: 'jupyterExtension'
        });
        expect(session).to.not.equal(undefined, 'Provider should return a notebook');
    });

    test('NotebookProvider getOrCreateNotebook second request should return the notebook already cached', async () => {
        const mockSession = mock<IJupyterSession>();
        instance(mockSession as any).then = undefined;
        when(jupyterNotebookProvider.createNotebook(anything())).thenResolve(instance(mockSession));
        when(jupyterNotebookProvider.connect(anything())).thenResolve({} as any);
        const doc = mock<vscode.NotebookDocument>();
        when(doc.uri).thenReturn(Uri('C:\\\\foo.py'));

        const session = await notebookProvider.create({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token,
            creator: 'jupyterExtension'
        });
        expect(session).to.not.equal(undefined, 'Server should return a notebook');

        const session2 = await notebookProvider.create({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token,
            creator: 'jupyterExtension'
        });
        expect(session2).to.equal(session);
    });
});
