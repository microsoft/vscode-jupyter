// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { anything, capture, instance, mock, verify } from 'ts-mockito';
import { Uri } from 'vscode';
import { CommandManager } from '../../../platform/common/application/commandManager.node';
import { ICommandManager } from '../../../platform/common/application/types';
import { JupyterServerSelectorCommand } from '../../../platform/commands/serverSelector.node';
import { JupyterServerSelector } from '../../../kernels/jupyter/serverSelector.node';
import { Commands } from '../../../platform/common/constants';

/* eslint-disable  */
suite('DataScience - Server Selector Command', () => {
    let serverSelectorCommand: JupyterServerSelectorCommand;
    let commandManager: ICommandManager;
    let serverSelector: JupyterServerSelector;

    setup(() => {
        commandManager = mock(CommandManager);
        serverSelector = mock(JupyterServerSelector);

        serverSelectorCommand = new JupyterServerSelectorCommand(instance(commandManager), instance(serverSelector));
    });

    test('Register Command', () => {
        serverSelectorCommand.register();

        verify(commandManager.registerCommand(Commands.SelectJupyterURI, anything(), instance(serverSelector))).once();
    });

    test('Command Handler should invoke ServerSelector', () => {
        serverSelectorCommand.register();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (capture(commandManager.registerCommand as any).first()[1] as Function).bind(
            serverSelectorCommand
        );

        handler();

        verify(serverSelector.selectJupyterURI(true, 'commandPalette')).once();
    });

    test(`Command Handler should set URI`, () => {
        serverSelectorCommand.register();
        let uri = Uri.parse('http://localhost:1234');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (capture(commandManager.registerCommand as any).first()[1] as Function).bind(
            serverSelectorCommand,
            false,
            uri
        );

        handler();

        verify(serverSelector.setJupyterURIToRemote('http://localhost:1234/')).once();
    });
});
