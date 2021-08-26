// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as vscode from 'vscode';
import { NativeInteractiveWindow } from '../../client/datascience/interactive-window/nativeInteractiveWindow';
import { NativeInteractiveWindowProvider } from '../../client/datascience/interactive-window/nativeInteractiveWindowProvider';
import { IInteractiveWindowProvider } from '../../client/datascience/types';
import { IExtensionTestApi, waitForCondition } from '../common';
import { IS_REMOTE_NATIVE_TEST } from '../constants';
import { closeActiveWindows, initialize } from '../initialize';
import { assertHasTextOutputInVSCode } from './notebook/helper';

suite('Interactive window', async () => {
    let api: IExtensionTestApi;
    let interactiveWindowProvider: NativeInteractiveWindowProvider;

    setup(async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        api = await initialize();
        interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
    });
    teardown(async () => {
        await closeActiveWindows();
    });

    test('Execute cell from input box', async () => {
        // Create new interactive window
        const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(
            undefined
        )) as NativeInteractiveWindow;
        await activeInteractiveWindow.readyPromise;

        // Add code to the input box
        await vscode.window.activeTextEditor?.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), 'print("foo")');
        });

        // Run the code in the input box
        await vscode.commands.executeCommand('interactive.execute');

        // Inspect notebookDocument for output
        const notebook = vscode.workspace.notebookDocuments.find(
            (notebookDocument) => notebookDocument.uri.toString() === activeInteractiveWindow.notebookUri?.toString()
        );
        assert.ok(notebook !== undefined, 'No interactive window found');
        const index = notebook!.cellCount - 1;
        const cell = notebook!.cellAt(index);
        await waitForCondition(async () => assertHasTextOutputInVSCode(cell, 'foo'), 15_000, 'Incorrect output');
    });
});
