// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as vscode from 'vscode';
import { IPythonApiProvider } from '../../../client/api/types';
import { PYTHON_LANGUAGE } from '../../../client/common/constants';
import { NativeInteractiveWindow } from '../../../client/datascience/interactive-window/nativeInteractiveWindow';
import { NativeInteractiveWindowProvider } from '../../../client/datascience/interactive-window/nativeInteractiveWindowProvider';
import { IInteractiveWindowProvider } from '../../../client/datascience/types';
import { IExtensionTestApi, sleep } from '../../common';
import { closeActiveWindows, initialize } from '../../initialize';
import { assertHasTextOutputInVSCode } from '../notebook/helper';

suite('Native interactive window', () => {
    let api: IExtensionTestApi;
    let interactiveWindowProvider: NativeInteractiveWindowProvider;

    setup(async () => {
        api = await initialize();
        interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
    });
    teardown(async () => {
        await closeActiveWindows();
    });

    test('Open window and execute a cell', async () => {
        const untitledPythonFile = await vscode.workspace.openTextDocument({ language: PYTHON_LANGUAGE });
        const activeInteractiveWindow = await interactiveWindowProvider.getOrCreate(untitledPythonFile.uri) as NativeInteractiveWindow;
        await activeInteractiveWindow.readyPromise;
        const source = 'print(42)';
        await activeInteractiveWindow.addCode(source, untitledPythonFile.uri, 0);
        const notebookDocument = vscode.workspace.notebookDocuments.find((doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString());

        // Ensure we picked up the active interpreter for use as the kernel
        const activeInterpreter = await (await api.serviceManager.get<IPythonApiProvider>(IPythonApiProvider).getApi()).getActiveInterpreter();
        assert.equal(activeInteractiveWindow.notebookController?.connection.interpreter?.path, activeInterpreter?.path, 'Controller does not match active interpreter');
        assert.equal(activeInteractiveWindow.notebookController?.connection.interpreter?.envName, activeInterpreter?.envName, 'Controller does not match active interpreter');

        // Verify sys info cell
        const firstCell = notebookDocument?.cellAt(0);
        assert.ok(firstCell?.metadata.isInteractiveWindowMessageCell, 'First cell should be sys info cell');
        assert.equal(firstCell?.kind, vscode.NotebookCellKind.Markup, 'First cell should be markdown cell');

        // Verify executed cell input and output
        const secondCell = notebookDocument?.cellAt(1);
        const actualSource = secondCell?.document.getText();
        assert.equal(actualSource, source, `Executed cell has unexpected source code`);
        await sleep(5000); // todo@joyceerhl verify execution completed a different way
        assertHasTextOutputInVSCode(secondCell!, '42');
    });
});
