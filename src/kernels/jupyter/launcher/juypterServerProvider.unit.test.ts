// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import { CancellationTokenSource, Disposable, EventEmitter, Uri } from 'vscode';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { JupyterServerProvider } from './jupyterServerProvider.node';
import { DisplayOptions } from '../../displayOptions';
import { IJupyterServerHelper } from '../types';
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
suite('Jupyter Server Provider', () => {
    let serverProvider: JupyterServerProvider;
    let jupyterServerHelper: IJupyterServerHelper;
    let interpreterService: IInterpreterService;
    const workingPython: PythonEnvironment = {
        uri: Uri.file('/foo/bar/python.exe'),
        id: Uri.file('/foo/bar/python.exe').fsPath,
        sysPrefix: 'Python'
    };
    let disposables: Disposable[] = [];
    let source: CancellationTokenSource;
    setup(() => {
        jupyterServerHelper = mock<IJupyterServerHelper>();
        interpreterService = mock<IInterpreterService>();

        const eventEmitter = new EventEmitter<void>();
        disposables.push(eventEmitter);
        when((jupyterServerHelper as any).then).thenReturn(undefined);

        // Create the server provider
        serverProvider = new JupyterServerProvider(instance(jupyterServerHelper), instance(interpreterService));
        source = new CancellationTokenSource();
        disposables.push(source);
    });
    teardown(() => (disposables = dispose(disposables)));

    test('Get Or Create', async () => {
        when(jupyterServerHelper.getUsableJupyterPython()).thenResolve(workingPython);
        const connection = createTypeMoq<IJupyterConnection>('jupyter server');
        when(jupyterServerHelper.startServer(anything(), anything())).thenResolve(connection.object);

        // Disable UI just lets us skip mocking the progress reporter
        const server = await serverProvider.getOrStartServer({
            ui: new DisplayOptions(true),
            resource: undefined,
            token: source.token
        });
        expect(server).to.not.equal(undefined, 'Server expected to be defined');
    });
});
