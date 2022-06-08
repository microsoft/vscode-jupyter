// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { anything, capture, instance, mock, verify } from 'ts-mockito';
import { Uri } from 'vscode';
import { CommandManager } from '../../../platform/common/application/commandManager';
import { ICommandManager } from '../../../platform/common/application/types';
import { JupyterServerSelector } from '../../../kernels/jupyter/serverSelector';
import { Commands } from '../../../platform/common/constants';
import { INotebookControllerManager } from '../../../notebooks/types';
import { JupyterServerSelectorCommand } from '../../../notebooks/serverSelector';
import { JupyterServerUriStorage } from '../../../kernels/jupyter/launcher/serverUriStorage';

/* eslint-disable  */
suite('DataScience - Server Selector Command', () => {
    let serverSelectorCommand: JupyterServerSelectorCommand;
    let commandManager: ICommandManager;
    let serverSelector: JupyterServerSelector;
    let controllerManager: INotebookControllerManager;

    setup(() => {
        commandManager = mock(CommandManager);
        serverSelector = mock(JupyterServerSelector);
        controllerManager = mock(controllerManager);
        const uriStorage = mock(JupyterServerUriStorage);

        serverSelectorCommand = new JupyterServerSelectorCommand(
            instance(commandManager),
            instance(serverSelector),
            instance(uriStorage),
            instance(controllerManager)
        );
    });

    test('Register Command', () => {
        serverSelectorCommand.register();

        verify(commandManager.registerCommand(Commands.SelectJupyterURI, anything(), serverSelectorCommand)).once();
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
