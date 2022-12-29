// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable } from 'vscode';
import { CommandManager } from '../../../../platform/common/application/commandManager';
import { ICommandManager } from '../../../../platform/common/application/types';
import { IDisposableRegistry } from '../../../../platform/common/types';
import { JupyterInterpreterSelectionCommand } from '../../../../kernels/jupyter/interpreter/jupyterInterpreterSelectionCommand.node';
import { JupyterInterpreterService } from '../../../../kernels/jupyter/interpreter/jupyterInterpreterService.node';
import { IExtensionSyncActivationService } from '../../../../platform/activation/types';

suite('Jupyter Interpreter Command', () => {
    let interpreterCommand: IExtensionSyncActivationService;
    let disposableRegistry: IDisposableRegistry;
    let commandManager: ICommandManager;
    let interpreterService: JupyterInterpreterService;
    setup(() => {
        interpreterService = mock(JupyterInterpreterService);
        commandManager = mock(CommandManager);
        disposableRegistry = [];
        when(interpreterService.selectInterpreter()).thenResolve();
        interpreterCommand = new JupyterInterpreterSelectionCommand(
            instance(interpreterService),
            instance(commandManager),
            disposableRegistry
        );
    });
    test('Activation should register command', async () => {
        const disposable = mock(Disposable);
        when(commandManager.registerCommand('jupyter.selectJupyterInterpreter', anything())).thenReturn(
            instance(disposable)
        );

        await interpreterCommand.activate();

        verify(commandManager.registerCommand('jupyter.selectJupyterInterpreter', anything())).once();
    });
    test('Command handler must be jupyter interpreter selection', async () => {
        const disposable = mock(Disposable);
        let handler: Function | undefined;
        when(commandManager.registerCommand('jupyter.selectJupyterInterpreter', anything())).thenCall(
            (_, cb: Function) => {
                handler = cb;
                return instance(disposable);
            }
        );

        await interpreterCommand.activate();

        verify(commandManager.registerCommand('jupyter.selectJupyterInterpreter', anything())).once();
        assert.isFunction(handler);

        // Invoking handler must select jupyter interpreter.
        handler!();

        verify(interpreterService.selectInterpreter()).once();
    });
});
