// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IDisposable } from '@fluentui/react';
import { expect } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import * as vscode from 'vscode';
import { EventEmitter } from 'vscode';
import { PythonExtensionChecker } from '../../../platform/api/pythonApi';
import { AsyncDisposableRegistry } from '../../../platform/common/asyncDisposableRegistry';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IAsyncDisposableRegistry, IConfigurationService } from '../../../platform/common/types';
import { DisplayOptions } from '../../displayOptions';
import { JupyterConnection } from '../connection/jupyterConnection';
import { JupyterKernelSessionFactory } from './jupyterKernelSessionFactory';
import { IJupyterKernelService, IJupyterRequestCreator, IJupyterServerProvider } from '../types';
import { IJupyterKernelSession, KernelConnectionMetadata } from '../../types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { JupyterLabHelper } from './jupyterLabHelper';

function Uri(filename: string): vscode.Uri {
    return vscode.Uri.file(filename);
}

/* eslint-disable  */
suite('NotebookProvider', () => {
    let jupyterKernelSessionFactory: JupyterKernelSessionFactory;
    let jupyterNotebookProvider: IJupyterServerProvider;
    let cancelToken: vscode.CancellationTokenSource;
    const disposables: IDisposable[] = [];
    let asyncDisposables: IAsyncDisposableRegistry;
    let onDidShutdown: EventEmitter<void>;
    let configService: IConfigurationService;
    let kernelService: IJupyterKernelService;
    let requestCreator: IJupyterRequestCreator;
    setup(() => {
        jupyterNotebookProvider = mock<IJupyterServerProvider>();
        cancelToken = new vscode.CancellationTokenSource();
        disposables.push(cancelToken);
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        const onDidChangeEvent = new vscode.EventEmitter<void>();
        disposables.push(onDidChangeEvent);
        onDidShutdown = new vscode.EventEmitter<void>();
        disposables.push(onDidShutdown);
        const mockSession = mock<IJupyterKernelSession>();
        when(mockSession.onDidShutdown).thenReturn(onDidShutdown.event);
        instance(mockSession as any).then = undefined;
        const jupyterSessionManager = mock<JupyterLabHelper>();
        instance(jupyterSessionManager as any).then = undefined;
        when(jupyterSessionManager.isDisposed).thenReturn(false);
        const jupyterConnection = mock<JupyterConnection>();
        when(jupyterConnection.createRemoveConnectionInfo(anything())).thenResolve({
            localLaunch: true,
            baseUrl: 'http://localhost:8888'
        } as any);
        when(jupyterNotebookProvider.getOrStartServer(anything())).thenResolve({
            localLaunch: true,
            baseUrl: 'http://localhost:8888'
        } as any);
        asyncDisposables = new AsyncDisposableRegistry();
        const workspace = mock<IWorkspaceService>();
        when(workspace.computeWorkingDirectory(anything())).thenResolve('');
        configService = mock<IConfigurationService>();
        kernelService = mock<IJupyterKernelService>();
        requestCreator = mock<IJupyterRequestCreator>();
        jupyterKernelSessionFactory = new JupyterKernelSessionFactory(
            instance(jupyterNotebookProvider),
            instance(jupyterConnection),
            asyncDisposables,
            instance(workspace),
            instance(configService),
            instance(kernelService),
            instance(requestCreator)
        );
    });
    teardown(async () => {
        disposeAllDisposables(disposables);
        await asyncDisposables.dispose();
    });
    test('NotebookProvider getOrCreateNotebook jupyter provider does not have notebook already', async () => {
        when(jupyterNotebookProvider.getOrStartServer(anything())).thenResolve({} as any);
        const doc = mock<vscode.NotebookDocument>();
        when(doc.uri).thenReturn(Uri('C:\\\\foo.py'));
        const session = await jupyterKernelSessionFactory.create({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token,
            creator: 'jupyterExtension'
        });
        expect(session).to.not.equal(undefined, 'Provider should return a notebook');
    });

    test('NotebookProvider getOrCreateNotebook second request should return the notebook already cached', async () => {
        when(jupyterNotebookProvider.getOrStartServer(anything())).thenResolve({} as any);
        const doc = mock<vscode.NotebookDocument>();
        when(doc.uri).thenReturn(Uri('C:\\\\foo.py'));

        const session = await jupyterKernelSessionFactory.create({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token,
            creator: 'jupyterExtension'
        });
        expect(session).to.not.equal(undefined, 'Server should return a notebook');

        const session2 = await jupyterKernelSessionFactory.create({
            resource: Uri('C:\\\\foo.py'),
            kernelConnection: instance(mock<KernelConnectionMetadata>()),
            ui: new DisplayOptions(false),
            token: cancelToken.token,
            creator: 'jupyterExtension'
        });
        expect(session2).to.equal(session);
    });
});
