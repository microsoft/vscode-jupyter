// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, capture, instance, mock, verify } from 'ts-mockito';
import { Uri } from 'vscode';
import { CommandManager } from '../../../platform/common/application/commandManager';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../platform/common/application/types';
import { JupyterServerSelector } from './serverSelector';
import { Commands } from '../../../platform/common/constants';
import { JupyterServerSelectorCommand } from './serverSelectorCommand';
import { JupyterServerUriStorage } from './serverUriStorage';
import { IBrowserService } from '../../../platform/common/types';

/* eslint-disable  */
suite('Server Selector Command', () => {
    let serverSelectorCommand: JupyterServerSelectorCommand;
    let commandManager: ICommandManager;
    let serverSelector: JupyterServerSelector;

    setup(() => {
        commandManager = mock(CommandManager);
        serverSelector = mock(JupyterServerSelector);
        const appShell = mock<IApplicationShell>();
        const browser = mock<IBrowserService>();
        const notebook = mock<IVSCodeNotebook>();
        const uriStorage = mock(JupyterServerUriStorage);

        serverSelectorCommand = new JupyterServerSelectorCommand(
            instance(commandManager),
            instance(serverSelector),
            instance(uriStorage),
            instance(notebook),
            instance(appShell),
            instance(browser)
        );
    });

    test('Register Command', () => {
        serverSelectorCommand.activate();

        verify(commandManager.registerCommand(Commands.SelectJupyterURI, anything(), serverSelectorCommand)).once();
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
