// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, capture, instance, mock, verify, when } from 'ts-mockito';
import { CommandManager } from '../commandManager';
import { ReloadVSCodeCommandHandler } from './reloadCommand.node';
import { ICommandManager } from '../types';
import { Common } from '../../utils/localize';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../../test/vscode-mock';

// Defines a Mocha test suite to group tests of similar kind together
suite('Common Commands ReloadCommand', () => {
    let reloadCommandHandler: ReloadVSCodeCommandHandler;
    let cmdManager: ICommandManager;
    setup(async () => {
        resetVSCodeMocks();
        cmdManager = mock(CommandManager);
        reloadCommandHandler = new ReloadVSCodeCommandHandler(instance(cmdManager));
        when(cmdManager.executeCommand(anything())).thenResolve();
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything())).thenResolve();
        await reloadCommandHandler.activate();
    });
    teardown(() => resetVSCodeMocks());

    test('Confirm command handler is added', async () => {
        verify(cmdManager.registerCommand('jupyter.reloadVSCode', anything(), anything())).once();
    });
    test('Display prompt to reload VS Code with message passed into command', async () => {
        const message = 'Hello World!';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const commandHandler = capture(cmdManager.registerCommand as any).first()[1] as Function;

        await commandHandler.call(reloadCommandHandler, message);

        verify(mockedVSCodeNamespaces.window.showInformationMessage(message, Common.reload)).once;
    });
    test('Do not reload VS Code if user selects `Reload` option', async () => {
        const message = 'Hello World!';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const commandHandler = capture(cmdManager.registerCommand as any).first()[1] as Function;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(mockedVSCodeNamespaces.window.showInformationMessage(message, Common.reload)).thenResolve(
            Common.reload as any
        );

        await commandHandler.call(reloadCommandHandler, message);

        verify(mockedVSCodeNamespaces.window.showInformationMessage(message, Common.reload)).once;
        verify(cmdManager.executeCommand('workbench.action.reloadWindow')).once();
    });
    test('Do not reload VS Code if user does not select `Reload` option', async () => {
        const message = 'Hello World!';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const commandHandler = capture(cmdManager.registerCommand as any).first()[1] as Function;
        when(mockedVSCodeNamespaces.window.showInformationMessage(message, Common.reload)).thenResolve;

        await commandHandler.call(reloadCommandHandler, message);

        verify(mockedVSCodeNamespaces.window.showInformationMessage(message, Common.reload)).once;
        verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
    });
});
