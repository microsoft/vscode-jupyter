// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { JupyterInterpreterSelectionCommand } from './jupyterInterpreterSelectionCommand.node';
import { JupyterInterpreterService } from './jupyterInterpreterService.node';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../test/vscode-mock';

suite('Jupyter Interpreter Command', () => {
    let interpreterCommand: IExtensionSyncActivationService;
    let disposableRegistry: IDisposableRegistry;
    let interpreterService: JupyterInterpreterService;
    setup(() => {
        resetVSCodeMocks();
        interpreterService = mock(JupyterInterpreterService);
        disposableRegistry = [];
        when(interpreterService.selectInterpreter()).thenResolve();
        interpreterCommand = new JupyterInterpreterSelectionCommand(instance(interpreterService), disposableRegistry);
    });
    teardown(() => resetVSCodeMocks());
    test('Activation should register command', async () => {
        const disposable = mock(Disposable);
        when(
            mockedVSCodeNamespaces.commands.registerCommand('jupyter.selectJupyterInterpreter', anything())
        ).thenReturn(instance(disposable));

        await interpreterCommand.activate();

        verify(mockedVSCodeNamespaces.commands.registerCommand('jupyter.selectJupyterInterpreter', anything())).once();
    });
    test('Command handler must be jupyter interpreter selection', async () => {
        const disposable = mock(Disposable);
        let handler: Function | undefined;
        when(mockedVSCodeNamespaces.commands.registerCommand('jupyter.selectJupyterInterpreter', anything())).thenCall(
            (_, cb: Function) => {
                handler = cb;
                return instance(disposable);
            }
        );

        await interpreterCommand.activate();

        verify(mockedVSCodeNamespaces.commands.registerCommand('jupyter.selectJupyterInterpreter', anything())).once();
        assert.isFunction(handler);

        // Invoking handler must select jupyter interpreter.
        handler!();

        verify(interpreterService.selectInterpreter()).once();
    });
});
