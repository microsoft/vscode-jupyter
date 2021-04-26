// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as path from 'path';
import * as sinon from 'sinon';
import { assert } from 'chai';
import { NotebookDocument, Uri, window } from 'vscode';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import { IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import { openNotebook } from '../helpers';
import {
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    runCell,
    trustAllNotebooks,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected
} from './helper';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_WEBVIEW_BUILD_SKIPPED } from '../../constants';
import { createDeferred, Deferred } from '../../../client/common/utils/async';
import { InteractiveWindowMessages } from '../../../client/datascience/interactive-common/interactiveWindowTypes';
import { NotebookIPyWidgetCoordinator } from '../../../client/datascience/ipywidgets/notebookIPyWidgetCoordinator';
import { INotebookCommunication } from '../../../client/datascience/notebook/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - IPyWidget test', () => {
    const widgetsNB = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'standard_widgets.ipynb'
    );

    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let widgetCoordinator: NotebookIPyWidgetCoordinator;
    let testWidgetNb: Uri;
    suiteSetup(async function () {
        // We need to have webviews built to run this, so skip if we don't have them
        if (IS_WEBVIEW_BUILD_SKIPPED) {
            console.log('Widget notebook tests require webview build to be enabled');
            return this.skip();
        }

        if (!process.env.VSC_JUPYTER_RUN_NB_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }
        api = await initialize();

        await trustAllNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        widgetCoordinator = api.serviceContainer.get<NotebookIPyWidgetCoordinator>(NotebookIPyWidgetCoordinator);
    });
    setup(async function () {
        sinon.restore();
        await closeNotebooks();
        // Don't use same file (due to dirty handling, we might save in dirty.)
        testWidgetNb = Uri.file(await createTemporaryNotebook(widgetsNB, disposables));
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Can run a widget notebook (webview-test)', async function () {
        await openNotebook(api.serviceContainer, testWidgetNb.fsPath);
        await waitForKernelToGetAutoSelected();
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        // This flag will be resolved when the widget loads
        const flag = createDeferred<boolean>();
        flagForWebviewLoad(flag, vscodeNotebook.activeNotebookEditor?.document!);

        // Execute cell. It should load and render the widget
        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        assert.ok(flag.completed, 'Widget did not load successfully during execution');
    });
    test('Can run a widget notebook twice (webview-test)', async function () {
        await openNotebook(api.serviceContainer, testWidgetNb.fsPath);
        await waitForKernelToGetAutoSelected();
        let cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        // Execute cell. It should load and render the widget
        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        // Close notebook and open again
        await closeNotebooks();

        await openNotebook(api.serviceContainer, testWidgetNb.fsPath);
        await waitForKernelToGetAutoSelected();
        cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        // This flag will be resolved when the widget loads
        const flag = createDeferred<boolean>();
        flagForWebviewLoad(flag, vscodeNotebook.activeNotebookEditor?.document!);

        // Execute cell. It should load and render the widget
        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        assert.ok(flag.completed, 'Widget did not load successfully on second execution');
    });
    test('Can run widget cells that need requireJS (webview-test)', async function () {
        // Test runs locally but fails on CI, disabling to be fixed in 5265
        this.skip();
        await openNotebook(api.serviceContainer, testWidgetNb.fsPath);
        await waitForKernelToGetAutoSelected();
        // 6th cell has code that needs requireJS
        const cell = vscodeNotebook.activeNotebookEditor?.document.getCells()![6]!;

        // This flag will be resolved when the widget loads
        const flag = createDeferred<boolean>();
        flagForWebviewLoad(flag, vscodeNotebook.activeNotebookEditor?.document!);

        // Execute cell. It should load and render the widget
        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        assert.ok(flag.completed, 'Widget did not load successfully during execution');
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
        const items: INotebookCommunication[] = [];
        window.visibleNotebookEditors.forEach((editor) => {
            if (editor.document !== notebook) {
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
