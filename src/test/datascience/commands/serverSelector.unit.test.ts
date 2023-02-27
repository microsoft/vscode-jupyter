// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, capture, instance, mock, verify } from 'ts-mockito';
import { Uri } from 'vscode';
import { CommandManager } from '../../../platform/common/application/commandManager';
import { ICommandManager } from '../../../platform/common/application/types';
import { JupyterServerSelector } from '../../../kernels/jupyter/connection/serverSelector';
import { Commands } from '../../../platform/common/constants';
import { JupyterServerSelectorCommand } from '../../../notebooks/serverSelectorCommand';
import { JupyterServerUriStorage } from '../../../kernels/jupyter/connection/serverUriStorage';

/* eslint-disable  */
suite('Server Selector Command', () => {
    let serverSelectorCommand: JupyterServerSelectorCommand;
    let commandManager: ICommandManager;
    let serverSelector: JupyterServerSelector;

    setup(() => {
        commandManager = mock(CommandManager);
        serverSelector = mock(JupyterServerSelector);
        const uriStorage = mock(JupyterServerUriStorage);

        serverSelectorCommand = new JupyterServerSelectorCommand(
            instance(commandManager),
            instance(serverSelector),
            instance(uriStorage)
        );
    });

    test('Register Command', () => {
        serverSelectorCommand.activate();

        verify(commandManager.registerCommand(Commands.SelectJupyterURI, anything(), serverSelectorCommand)).once();
    });

    test('Command Handler should invoke ServerSelector', () => {
        serverSelectorCommand.activate();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (capture(commandManager.registerCommand as any).first()[1] as Function).bind(
            serverSelectorCommand
        );

        handler();

        verify(serverSelector.selectJupyterURI('commandPalette')).once();
    });

    test(`Command Handler should set URI`, () => {
        serverSelectorCommand.activate();
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
