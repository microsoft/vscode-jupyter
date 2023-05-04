// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import * as vscode from 'vscode';
import { PythonExtensionChecker } from '../../../platform/api/pythonApi';
import { IJupyterKernelConnectionSession, KernelConnectionMetadata } from '../../types';
import { DisplayOptions } from '../../displayOptions';
import { IJupyterNotebookProvider, IJupyterSessionManagerFactory } from '../types';
import { IRawKernelConnectionSessionCreator } from '../../raw/types';
import { IAsyncDisposableRegistry, IDisposable } from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { KernelConnectionSessionCreator } from './kernelConnectionSessionCreator';
import { JupyterKernelConnectionSessionCreator } from './jupyterKernelConnectionSessionCreator';
import { JupyterConnection } from '../connection/jupyterConnection';
import { AsyncDisposableRegistry } from '../../../platform/common/asyncDisposableRegistry';

function Uri(filename: string): vscode.Uri {
    return vscode.Uri.file(filename);
}

/* eslint-disable  */
suite('NotebookProvider', () => {
    let kernelConnectionSessionCreator: KernelConnectionSessionCreator;
    let jupyterNotebookProvider: IJupyterNotebookProvider;
    let rawKernelSessionCreator: IRawKernelConnectionSessionCreator;
    let cancelToken: vscode.CancellationTokenSource;
    const disposables: IDisposable[] = [];
    let asyncDisposables: IAsyncDisposableRegistry;
    setup(() => {
        jupyterNotebookProvider = mock<IJupyterNotebookProvider>();
        rawKernelSessionCreator = mock<IRawKernelConnectionSessionCreator>();
        cancelToken = new vscode.CancellationTokenSource();
        disposables.push(cancelToken);
        when(rawKernelSessionCreator.isSupported).thenReturn(false);
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        const onDidChangeEvent = new vscode.EventEmitter<void>();
        disposables.push(onDidChangeEvent);
        const sessionManagerFactory = mock<IJupyterSessionManagerFactory>();
        const jupyterSessionCreator = mock<JupyterKernelConnectionSessionCreator>();
        const jupyterConnection = mock<JupyterConnection>();
        asyncDisposables = new AsyncDisposableRegistry();
        kernelConnectionSessionCreator = new KernelConnectionSessionCreator(
            instance(rawKernelSessionCreator),
            instance(jupyterNotebookProvider),
            instance(sessionManagerFactory),
            instance(jupyterSessionCreator),
            instance(jupyterConnection),
            asyncDisposables
        );
    });
    teardown(async () => {
        disposeAllDisposables(disposables);
        await asyncDisposables.dispose();
    });
    test('NotebookProvider getOrCreateNotebook jupyter provider does not have notebook already', async () => {
        const mockSession = mock<IJupyterKernelConnectionSession>();
        instance(mockSession as any).then = undefined;
        when(jupyterNotebookProvider.createNotebook(anything())).thenResolve(instance(mockSession));
        when(jupyterNotebookProvider.connect(anything())).thenResolve({} as any);
        const doc = mock<vscode.NotebookDocument>();
        when(doc.uri).thenReturn(Uri('C:\\\\foo.py'));

        const session = await kernelConnectionSessionCreator.create({
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

        const session = await kernelConnectionSessionCreator.create({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token,
            creator: 'jupyterExtension'
        });
        expect(session).to.not.equal(undefined, 'Server should return a notebook');

        const session2 = await kernelConnectionSessionCreator.create({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token,
            creator: 'jupyterExtension'
        });
        expect(session2).to.equal(session);
    });
});
