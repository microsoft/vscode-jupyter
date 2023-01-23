// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import * as vscode from 'vscode';
import { PythonExtensionChecker } from '../../../platform/api/pythonApi';
import { IJupyterKernelConnectionSession, KernelConnectionMetadata } from '../../../kernels/types';
import { NotebookProvider } from '../../../kernels/jupyter/launcher/notebookProvider';
import { DisplayOptions } from '../../../kernels/displayOptions';
import { IJupyterNotebookProvider, IJupyterServerUriStorage } from '../../../kernels/jupyter/types';
import { IRawNotebookProvider } from '../../../kernels/raw/types';
import { IDisposable } from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';

function Uri(filename: string): vscode.Uri {
    return vscode.Uri.file(filename);
}

/* eslint-disable  */
suite('NotebookProvider', () => {
    let notebookProvider: NotebookProvider;
    let jupyterNotebookProvider: IJupyterNotebookProvider;
    let rawNotebookProvider: IRawNotebookProvider;
    let cancelToken: vscode.CancellationTokenSource;
    const disposables: IDisposable[] = [];
    setup(() => {
        jupyterNotebookProvider = mock<IJupyterNotebookProvider>();
        rawNotebookProvider = mock<IRawNotebookProvider>();
        cancelToken = new vscode.CancellationTokenSource();
        disposables.push(cancelToken);
        when(rawNotebookProvider.isSupported).thenReturn(false);
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        const uriStorage = mock<IJupyterServerUriStorage>();
        when(uriStorage.isLocalLaunch).thenReturn(true);
        const onDidChangeEvent = new vscode.EventEmitter<void>();
        disposables.push(onDidChangeEvent);
        when(uriStorage.onDidChangeConnectionType).thenReturn(onDidChangeEvent.event);

        notebookProvider = new NotebookProvider(
            instance(rawNotebookProvider),
            instance(jupyterNotebookProvider),
            instance(extensionChecker),
            instance(uriStorage)
        );
    });
    teardown(() => disposeAllDisposables(disposables));
    test('NotebookProvider getOrCreateNotebook jupyter provider does not have notebook already', async () => {
        const mockSession = mock<IJupyterKernelConnectionSession>();
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
        const mockSession = mock<IJupyterKernelConnectionSession>();
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
