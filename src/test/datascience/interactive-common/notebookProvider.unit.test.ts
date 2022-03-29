// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { expect } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import * as vscode from 'vscode';
import { PythonExtensionChecker } from '../../../platform/api/pythonApi';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { ConfigurationService } from '../../../platform/common/configuration/service';
import { IJupyterSettings } from '../../../platform/common/types';
import { DisplayOptions } from '../../../platform/datascience/displayOptions';
import { KernelConnectionMetadata } from '../../../platform/../kernels/types';
import { IJupyterNotebookProvider, INotebook, IRawNotebookProvider } from '../../../platform/datascience/types';
import { NotebookProvider } from '../../../kernels/jupyter/launcher/notebookProvider';

function Uri(filename: string): vscode.Uri {
    return vscode.Uri.file(filename);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function createTypeMoq<T>(tag: string): typemoq.IMock<T> {
    // Use typemoqs for those things that are resolved as promises. mockito doesn't allow nesting of mocks. ES6 Proxy class
    // is the problem. We still need to make it thenable though. See this issue: https://github.com/florinn/typemoq/issues/67
    const result = typemoq.Mock.ofType<T>();
    (result as any).tag = tag;
    result.setup((x: any) => x.then).returns(() => undefined);
    return result;
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
        const notebookMock = createTypeMoq<INotebook>('jupyter notebook');
        when(jupyterNotebookProvider.createNotebook(anything())).thenResolve(notebookMock.object);
        when(jupyterNotebookProvider.connect(anything())).thenResolve({} as any);
        const doc = mock<vscode.NotebookDocument>();
        when(doc.uri).thenReturn(Uri('C:\\\\foo.py'));

        const notebook = await notebookProvider.createNotebook({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token
        });
        expect(notebook).to.not.equal(undefined, 'Provider should return a notebook');
    });

    test('NotebookProvider getOrCreateNotebook second request should return the notebook already cached', async () => {
        const notebookMock = createTypeMoq<INotebook>('jupyter notebook');
        when(jupyterNotebookProvider.createNotebook(anything())).thenResolve(notebookMock.object);
        when(jupyterNotebookProvider.connect(anything())).thenResolve({} as any);
        const doc = mock<vscode.NotebookDocument>();
        when(doc.uri).thenReturn(Uri('C:\\\\foo.py'));

        const notebook = await notebookProvider.createNotebook({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token
        });
        expect(notebook).to.not.equal(undefined, 'Server should return a notebook');

        const notebook2 = await notebookProvider.createNotebook({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token
        });
        expect(notebook2).to.equal(notebook);
    });
});
