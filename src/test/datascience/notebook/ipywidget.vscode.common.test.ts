// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as sinon from 'sinon';
import { assert } from 'chai';
import { NotebookDocument, Uri, window } from 'vscode';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, startJupyterServer, waitForCondition } from '../../common';
import { openNotebook } from '../helpers';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    defaultNotebookTestTimeout,
    runCell,
    waitForCellExecutionToComplete,
    waitForKernelToGetAutoSelected
} from './helper';
import { createDeferred, Deferred } from '../../../platform/common/utils/async';
import { InteractiveWindowMessages } from '../../../messageTypes';
import { initialize } from '../../initialize';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfo } from '../../../platform/logging';
import { NotebookIPyWidgetCoordinator } from '../../../notebooks/controllers/notebookIPyWidgetCoordinator';
import { IWebviewCommunication } from '../../../platform/webviews/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - Standard', function () {
    this.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let widgetCoordinator: NotebookIPyWidgetCoordinator;
    let testWidgetNb: Uri;
    suiteSetup(async function () {
        api = await initialize();
        await startJupyterServer();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        widgetCoordinator = api.serviceContainer.get<NotebookIPyWidgetCoordinator>(NotebookIPyWidgetCoordinator);
    });
    setup(async function () {
        sinon.restore();
        await closeNotebooks();
        // Don't use same file (due to dirty handling, we might save in dirty.)
        testWidgetNb = await createTemporaryNotebook(
            [
                {
                    cell_type: 'code',
                    execution_count: null,
                    metadata: {},
                    outputs: [],
                    source: ['import ipywidgets as widgets\n', 'widgets.IntSlider(value=6519, min=5555, max=7777)']
                }
            ],
            disposables
        );
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Can run a widget notebook (webview-test)', async function () {
        const { notebook, editor } = await openNotebook(testWidgetNb);
        await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE);
        const cell = notebook.cellAt(0);

        // This flag will be resolved when the widget loads
        const flag = createDeferred<boolean>();
        flagForWebviewLoad(flag, vscodeNotebook.activeNotebookEditor?.notebook!);

        // Execute cell. It should load and render the widget
        await runCell(cell);
        await waitForCellExecutionToComplete(cell);

        // Wait for the flag to be set as it may take a while
        await waitForCondition(
            () => flag.promise,
            defaultNotebookTestTimeout,
            'Widget did not load successfully during execution'
        );
    });
    test('Can run a widget notebook twice (webview-test)', async function () {
        let open = await openNotebook(testWidgetNb);
        await waitForKernelToGetAutoSelected(open.editor, PYTHON_LANGUAGE);
        let cell = open.notebook.cellAt(0);

        // Execute cell. It should load and render the widget
        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForCellExecutionToComplete(cell);

        // Close notebook and open again.
        await closeNotebooks();

        open = await openNotebook(testWidgetNb);
        await waitForKernelToGetAutoSelected(open.editor, PYTHON_LANGUAGE);
        cell = open.notebook.cellAt(0);

        // This flag will be resolved when the widget loads
        const flag = createDeferred<boolean>();
        flagForWebviewLoad(flag, vscodeNotebook.activeNotebookEditor?.notebook!);

        // Execute cell. It should load and render the widget
        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForCellExecutionToComplete(cell);
        // Wait for the flag to be set as it may take a while
        await waitForCondition(
            () => flag.promise,
            defaultNotebookTestTimeout,
            'Widget did not load successfully during execution'
        );
    });

    // Resolve a deferred when we see the target uri has an associated webview and the webview
    // loaded a widget successfully
    function flagForWebviewLoad(flag: Deferred<boolean>, targetDoc: NotebookDocument) {
        const commsList = getNotebookCommunications(targetDoc);
        assert.equal(commsList.length, 1, 'No webviews found in kernel provider');
        if (Array.isArray(commsList) && commsList.length > 0) {
            commsList[0].onDidReceiveMessage((e) => {
                if (e.type === InteractiveWindowMessages.IPyWidgetLoadSuccess) {
                    flag.resolve(true);
                }
            });
        }
    }
    function getNotebookCommunications(notebook: NotebookDocument) {
        const items: IWebviewCommunication[] = [];
        window.visibleNotebookEditors.forEach((editor) => {
            if (editor.notebook !== notebook) {
                return;
            }
            const comm = widgetCoordinator.notebookCommunications.get(editor);
            if (comm) {
                items.push(comm);
            }
        });
        return items;
    }
});
