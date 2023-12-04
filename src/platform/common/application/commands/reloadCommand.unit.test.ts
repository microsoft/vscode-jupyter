// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, capture, verify, when } from 'ts-mockito';
import { ReloadVSCodeCommandHandler } from './reloadCommand.node';
import { Common } from '../../utils/localize';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../../test/vscode-mock';

// Defines a Mocha test suite to group tests of similar kind together
suite('Common Commands ReloadCommand', () => {
    let reloadCommandHandler: ReloadVSCodeCommandHandler;
    setup(async () => {
        resetVSCodeMocks();
        reloadCommandHandler = new ReloadVSCodeCommandHandler();
        when(mockedVSCodeNamespaces.commands.executeCommand(anything())).thenResolve();
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything())).thenResolve();
        await reloadCommandHandler.activate();
    });
    teardown(() => resetVSCodeMocks());

    test('Confirm command handler is added', async () => {
        verify(mockedVSCodeNamespaces.commands.registerCommand('jupyter.reloadVSCode', anything(), anything())).once();
    });
    test('Display prompt to reload VS Code with message passed into command', async () => {
        const message = 'Hello World!';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const commandHandler = capture(mockedVSCodeNamespaces.commands.registerCommand as any).first()[1] as Function;

        await commandHandler.call(reloadCommandHandler, message);

        verify(mockedVSCodeNamespaces.window.showInformationMessage(message, Common.reload)).once;
    });
    test('Do not reload VS Code if user selects `Reload` option', async () => {
        const message = 'Hello World!';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const commandHandler = capture(mockedVSCodeNamespaces.commands.registerCommand as any).first()[1] as Function;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(mockedVSCodeNamespaces.window.showInformationMessage(message, Common.reload)).thenResolve(
            Common.reload as any
        );

        await commandHandler.call(reloadCommandHandler, message);

        verify(mockedVSCodeNamespaces.window.showInformationMessage(message, Common.reload)).once;
        verify(mockedVSCodeNamespaces.commands.executeCommand('workbench.action.reloadWindow')).once();
    });
    test('Do not reload VS Code if user does not select `Reload` option', async () => {
        const message = 'Hello World!';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const commandHandler = capture(mockedVSCodeNamespaces.commands.registerCommand as any).first()[1] as Function;
        when(mockedVSCodeNamespaces.window.showInformationMessage(message, Common.reload)).thenResolve;

        await commandHandler.call(reloadCommandHandler, message);

        verify(mockedVSCodeNamespaces.window.showInformationMessage(message, Common.reload)).once;
        verify(mockedVSCodeNamespaces.commands.executeCommand('workbench.action.reloadWindow')).never();
    });
});
