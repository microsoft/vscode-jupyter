// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { SemVer } from 'semver';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import { CancellationTokenSource, Disposable, EventEmitter, Uri } from 'vscode';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { NotebookServerProvider } from '../../../kernels/jupyter/launcher/notebookServerProvider';
import { JupyterServerUriStorage } from '../../../kernels/jupyter/connection/serverUriStorage';
import { DisplayOptions } from '../../../kernels/displayOptions';
import { IJupyterExecution } from '../../../kernels/jupyter/types';
import { IJupyterConnection } from '../../types';

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
suite('NotebookServerProvider', () => {
    let serverProvider: NotebookServerProvider;
    let jupyterExecution: IJupyterExecution;
    let interpreterService: IInterpreterService;
    const workingPython: PythonEnvironment = {
        uri: Uri.file('/foo/bar/python.exe'),
        id: Uri.file('/foo/bar/python.exe').fsPath,
        version: new SemVer('3.6.6-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python'
    };
    const disposables: Disposable[] = [];
    let source: CancellationTokenSource;
    setup(() => {
        jupyterExecution = mock<IJupyterExecution>();
        interpreterService = mock<IInterpreterService>();

        const serverStorage = mock(JupyterServerUriStorage);
        when(serverStorage.getUri()).thenResolve({ uri: 'local', time: Date.now(), serverId: 'local' });
        when(serverStorage.getRemoteUri()).thenResolve();
        const eventEmitter = new EventEmitter<void>();
        disposables.push(eventEmitter);
        when(serverStorage.onDidChangeUri).thenReturn(eventEmitter.event);
        when((jupyterExecution as any).then).thenReturn(undefined);
        when((serverStorage as any).then).thenReturn(undefined);

        // Create the server provider
        serverProvider = new NotebookServerProvider(
            instance(jupyterExecution),
            instance(interpreterService),
            instance(serverStorage),
            disposables
        );
        source = new CancellationTokenSource();
        disposables.push(source);
    });
    teardown(() => disposeAllDisposables(disposables));
    test('NotebookServerProvider - Get Only - server', async () => {
        const connection = mock<IJupyterConnection>();
        when((connection as any).then).thenReturn(undefined);
        when(jupyterExecution.getServer(anything())).thenResolve(instance(connection));

        const server = await serverProvider.getOrCreateServer({
            resource: undefined,
            ui: new DisplayOptions(false),
            token: source.token
        });
        expect(server).to.not.equal(undefined, 'Server expected to be defined');
        verify(jupyterExecution.getServer(anything())).once();
    });

    test('NotebookServerProvider - Get Or Create', async () => {
        when(jupyterExecution.getUsableJupyterPython()).thenResolve(workingPython);
        const connection = createTypeMoq<IJupyterConnection>('jupyter server');
        when(jupyterExecution.connectToNotebookServer(anything(), anything())).thenResolve(connection.object);

        // Disable UI just lets us skip mocking the progress reporter
        const server = await serverProvider.getOrCreateServer({
            ui: new DisplayOptions(true),
            resource: undefined,
            token: source.token
        });
        expect(server).to.not.equal(undefined, 'Server expected to be defined');
    });
});
