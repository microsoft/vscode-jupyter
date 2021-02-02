// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { expect } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import * as vscode from 'vscode';
import { PythonExtensionChecker } from '../../../client/api/pythonApi';
import { IWorkspaceService } from '../../../client/common/application/types';
import { ConfigurationService } from '../../../client/common/configuration/service';
import { IDisposableRegistry, IJupyterSettings } from '../../../client/common/types';
import { NotebookProvider } from '../../../client/datascience/interactive-common/notebookProvider';
import { IJupyterNotebookProvider, INotebook, IRawNotebookProvider } from '../../../client/datascience/types';

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
    let disposableRegistry: IDisposableRegistry;
    let jupyterNotebookProvider: IJupyterNotebookProvider;
    let rawNotebookProvider: IRawNotebookProvider;
    let dataScienceSettings: IJupyterSettings;

    setup(() => {
        disposableRegistry = mock<IDisposableRegistry>();
        jupyterNotebookProvider = mock<IJupyterNotebookProvider>();
        rawNotebookProvider = mock<IRawNotebookProvider>();
        const workspaceService = mock<IWorkspaceService>();
        const configService = mock<ConfigurationService>();

        // Set up our settings
        dataScienceSettings = mock<IJupyterSettings>();
        when(workspaceService.hasWorkspaceFolders).thenReturn(false);
        when(dataScienceSettings.jupyterServerType).thenReturn('local');
        when(dataScienceSettings.useDefaultConfigForJupyter).thenReturn(true);
        when(rawNotebookProvider.supported).thenReturn(() => Promise.resolve(false));
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(configService.getSettings(anything())).thenReturn(instance(dataScienceSettings) as any);

        notebookProvider = new NotebookProvider(
            instance(disposableRegistry),
            instance(rawNotebookProvider),
            instance(jupyterNotebookProvider),
            instance(workspaceService),
            instance(extensionChecker),
            instance(configService)
        );
    });

    test('NotebookProvider getOrCreateNotebook jupyter provider has notebook already', async () => {
        const notebookMock = createTypeMoq<INotebook>('jupyter notebook');
        when(jupyterNotebookProvider.getNotebook(anything())).thenResolve(notebookMock.object);

        const notebook = await notebookProvider.getOrCreateNotebook({ identity: Uri('C:\\\\foo.py') });
        expect(notebook).to.not.equal(undefined, 'Provider should return a notebook');
    });

    test('NotebookProvider getOrCreateNotebook jupyter provider does not have notebook already', async () => {
        const notebookMock = createTypeMoq<INotebook>('jupyter notebook');
        when(jupyterNotebookProvider.getNotebook(anything())).thenResolve(undefined);
        when(jupyterNotebookProvider.createNotebook(anything())).thenResolve(notebookMock.object);
        when(jupyterNotebookProvider.connect(anything())).thenResolve({} as any);

        const notebook = await notebookProvider.getOrCreateNotebook({ identity: Uri('C:\\\\foo.py') });
        expect(notebook).to.not.equal(undefined, 'Provider should return a notebook');
    });

    test('NotebookProvider getOrCreateNotebook second request should return the notebook already cached', async () => {
        const notebookMock = createTypeMoq<INotebook>('jupyter notebook');
        when(jupyterNotebookProvider.getNotebook(anything())).thenResolve(undefined);
        when(jupyterNotebookProvider.createNotebook(anything())).thenResolve(notebookMock.object);
        when(jupyterNotebookProvider.connect(anything())).thenResolve({} as any);

        const notebook = await notebookProvider.getOrCreateNotebook({ identity: Uri('C:\\\\foo.py') });
        expect(notebook).to.not.equal(undefined, 'Server should return a notebook');

        const notebook2 = await notebookProvider.getOrCreateNotebook({ identity: Uri('C:\\\\foo.py') });
        expect(notebook2).to.equal(notebook);
    });
});
