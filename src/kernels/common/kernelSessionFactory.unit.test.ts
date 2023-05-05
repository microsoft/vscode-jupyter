// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IDisposable } from '@fluentui/react';
import { expect } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import * as vscode from 'vscode';
import { EventEmitter } from 'vscode';
import { PythonExtensionChecker } from '../../platform/api/pythonApi';
import { AsyncDisposableRegistry } from '../../platform/common/asyncDisposableRegistry';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IAsyncDisposableRegistry } from '../../platform/common/types';
import { DisplayOptions } from '../displayOptions';
import { JupyterConnection } from '../jupyter/connection/jupyterConnection';
import { JupyterKernelSessionFactory } from '../jupyter/session/jupyterKernelSessionFactory';
import { IJupyterServerProvider, IJupyterSessionManagerFactory } from '../jupyter/types';
import { IRawKernelSessionFactory } from '../raw/types';
import { IJupyterKernelSession, KernelConnectionMetadata } from '../types';
import { KernelSessionFactory } from './kernelSessionFactory';

function Uri(filename: string): vscode.Uri {
    return vscode.Uri.file(filename);
}

/* eslint-disable  */
suite('NotebookProvider', () => {
    let kernelConnectionSessionCreator: KernelSessionFactory;
    let jupyterNotebookProvider: IJupyterServerProvider;
    let rawKernelSessionCreator: IRawKernelSessionFactory;
    let cancelToken: vscode.CancellationTokenSource;
    const disposables: IDisposable[] = [];
    let asyncDisposables: IAsyncDisposableRegistry;
    let onDidShutdown: EventEmitter<void>;
    setup(() => {
        jupyterNotebookProvider = mock<IJupyterServerProvider>();
        rawKernelSessionCreator = mock<IRawKernelSessionFactory>();
        cancelToken = new vscode.CancellationTokenSource();
        disposables.push(cancelToken);
        when(rawKernelSessionCreator.isSupported).thenReturn(false);
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        const onDidChangeEvent = new vscode.EventEmitter<void>();
        disposables.push(onDidChangeEvent);
        onDidShutdown = new vscode.EventEmitter<void>();
        disposables.push(onDidShutdown);
        const sessionManagerFactory = mock<IJupyterSessionManagerFactory>();
        const jupyterSessionCreator = mock<JupyterKernelSessionFactory>();
        const jupyterConnection = mock<JupyterConnection>();
        when(jupyterConnection.createConnectionInfo(anything())).thenResolve({
            localLaunch: true,
            baseUrl: 'http://localhost:8888'
        } as any);
        const mockSession = mock<IJupyterKernelSession>();
        when(mockSession.onDidShutdown).thenReturn(onDidShutdown.event);
        instance(mockSession as any).then = undefined;
        when(jupyterSessionCreator.create(anything())).thenResolve(instance(mockSession));
        asyncDisposables = new AsyncDisposableRegistry();
        kernelConnectionSessionCreator = new KernelSessionFactory(
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
        when(jupyterNotebookProvider.getOrCreateServer(anything())).thenResolve({} as any);
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
        when(jupyterNotebookProvider.getOrCreateServer(anything())).thenResolve({} as any);
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
