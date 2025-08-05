// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { NotebookEditor, window, commands } from 'vscode';
import { logger } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { startJupyterServer } from '../../common';
import { initialize } from '../../initialize';
import {
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    prewarmNotebooks,
    selectDefaultController
} from '../notebook/helper';
import { hideOutputPanel, initializeWidgetComms, Utils } from './commUtils';
import { IS_REMOTE_NATIVE_TEST } from '../../constants';
import { initializeNotebookForWidgetTest, executeCellAndWaitForOutput, assertOutputContainsHtml } from './standardWidgets.vscode.common.test';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Output Widget append_display_data Tests', function () {
    this.timeout(120_000);
    let editor: NotebookEditor;
    let comms: Utils;
    const disposables: IDisposable[] = [];
    suiteSetup(async function () {
        this.timeout(120_000);
        logger.info('Suite Setup VS Code Notebook - OutputWidget append_display_data Tests');
        await initialize();
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        editor = (await createEmptyPythonNotebook(disposables, undefined, true)).editor;
        await selectDefaultController(editor);
        await hideOutputPanel();
        await commands.executeCommand('workbench.action.maximizeEditorHideSidebar');
        comms = await initializeWidgetComms(disposables);

        logger.info('Suite Setup (completed)');
    });
    setup(async function () {
        logger.info(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        logger.info(`Start Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    test('Synchronous append_display_data should work', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        
        await initializeNotebookForWidgetTest(
            disposables,
            { templateFile: 'append_display_data_test.ipynb' },
            editor
        );
        
        const [cell1, cell2, cell3] = window.activeNotebookEditor!.notebook.getCells();
        
        // Execute first cell - create async outputs
        await executeCellAndWaitForOutput(cell1, comms);
        
        // Execute second cell - create sync outputs
        await executeCellAndWaitForOutput(cell2, comms);
        
        // Execute third cell - append synchronously
        await executeCellAndWaitForOutput(cell3, comms);
        
        // Check if synchronous content appears
        await assertOutputContainsHtml(cell2, comms, ['Sync Content 0', 'Sync Content 1'], '.widget-output');
    });

    test('Asynchronous append_display_data should work', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        
        await initializeNotebookForWidgetTest(
            disposables,
            { templateFile: 'append_display_data_test.ipynb' },
            editor
        );
        
        const [cell1] = window.activeNotebookEditor!.notebook.getCells();
        
        // Execute first cell - this contains async append_display_data
        await executeCellAndWaitForOutput(cell1, comms);
        
        // Wait a bit for the async operations to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check if async content appears - this should work but currently fails
        await assertOutputContainsHtml(cell1, comms, ['Content 0', 'Content 1', 'Content 2'], '.widget-output');
    });
});