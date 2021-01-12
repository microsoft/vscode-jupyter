// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-require-imports no-var-requires
// import * as path from 'path';
// import * as sinon from 'sinon';
import { assert } from 'chai';
import { Uri, NotebookContentProvider as VSCNotebookContentProvider } from 'vscode';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import { NotebookContentProvider } from '../../../client/datascience/notebook/contentProvider';
import { INotebookContentProvider } from '../../../client/datascience/notebook/types';
import { IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import { openNotebook } from '../helpers';
import {
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    executeCell,
    waitForExecutionCompletedSuccessfully
} from './helper';
import { InteractiveWindowMessages } from '../../../client/datascience/interactive-common/interactiveWindowTypes';

// tslint:disable: no-any no-invalid-this
suite('DataScience - VSCode Notebook - IPyWidget test', () => {
    // const widgetsNB = path.join(
    //     EXTENSION_ROOT_DIR_FOR_TESTS,
    //     'src',
    //     'test',
    //     'datascience',
    //     'notebook',
    //     'standard_widgets.ipynb'
    // );

    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let testWidgetNb: Uri;
    //let editorProvider: INotebookEditorProvider;
    //let languageService: NotebookCellLanguageService;
    suiteSetup(async function () {
        api = await initialize();
        if (!process.env.VSC_JUPYTER_CI_RUN_NON_PYTHON_NB_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }
        // Skip for now. Have to wait for this commit to get into insiders
        // https://github.com/microsoft/vscode/commit/2b900dcf1184ab2424f21a860179f2d97c9928a7
        // Logged this issue to fix this: https://github.com/microsoft/vscode-jupyter/issues/1103
        this.skip();
        // await trustAllNotebooks();
        // sinon.restore();
        // vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        // editorProvider = api.serviceContainer.get<INotebookEditorProvider>(VSCodeNotebookProvider);
        // languageService = api.serviceContainer.get<NotebookCellLanguageService>(NotebookCellLanguageService);
    });
    setup(async function () {
        // Skip for now. Have to wait for this commit to get into insiders
        // https://github.com/microsoft/vscode/commit/2b900dcf1184ab2424f21a860179f2d97c9928a7
        this.skip();
        // sinon.restore();
        // await closeNotebooks();
        // // Don't use same file (due to dirty handling, we might save in dirty.)
        // testWidgetNb = Uri.file(await createTemporaryNotebook(widgetsNB, disposables));
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Can run a widget notebook', async function () {
        await openNotebook(api.serviceContainer, testWidgetNb.fsPath);
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        const contentProvider = api.serviceContainer.get<VSCNotebookContentProvider>(
            INotebookContentProvider
        ) as NotebookContentProvider;

        // Content provider should have a public member that maps webviews. Listen to messages on this webview
        const webviews = contentProvider.webviews.get(cell.document.uri.toString());
        assert.equal(webviews?.length, 1, 'No webviews found in content provider');
        let loaded = false;
        if (webviews) {
            webviews[0].onDidReceiveMessage((e) => {
                if (e.type === InteractiveWindowMessages.IPyWidgetLoadSuccess) {
                    loaded = true;
                }
            });
        }

        // Execute cell. It should load and render the widget
        await executeCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        assert.ok(loaded, 'Widget did not load successfully during execution');
    });
    test('Can run a widget notebook twice', async function () {
        await openNotebook(api.serviceContainer, testWidgetNb.fsPath);
        let cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        // Execute cell. It should load and render the widget
        await executeCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        // Close notebook and open again
        closeNotebooks();

        await openNotebook(api.serviceContainer, testWidgetNb.fsPath);
        cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;

        const contentProvider = api.serviceContainer.get<VSCNotebookContentProvider>(
            INotebookContentProvider
        ) as NotebookContentProvider;

        // Content provider should have a public member that maps webviews. Listen to messages on this webview
        const webviews = contentProvider.webviews.get(cell.document.uri.toString());
        assert.equal(webviews?.length, 1, 'No webviews found in content provider');
        let loaded = false;
        if (webviews) {
            webviews[0].onDidReceiveMessage((e) => {
                if (e.type === InteractiveWindowMessages.IPyWidgetLoadSuccess) {
                    loaded = true;
                }
            });
        }

        // Execute cell. It should load and render the widget
        await executeCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        assert.ok(loaded, 'Widget did not load successfully on second execution');
    });
    test('Can run widget cells that need requireJS', async function () {
        await openNotebook(api.serviceContainer, testWidgetNb.fsPath);
        // 6th cell has code that needs requireJS
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![6]!;
        const contentProvider = api.serviceContainer.get<VSCNotebookContentProvider>(
            INotebookContentProvider
        ) as NotebookContentProvider;

        // Content provider should have a public member that maps webviews. Listen to messages on this webview
        const webviews = contentProvider.webviews.get(cell.document.uri.toString());
        assert.equal(webviews?.length, 1, 'No webviews found in content provider');
        let loaded = false;
        if (webviews) {
            webviews[0].onDidReceiveMessage((e) => {
                if (e.type === InteractiveWindowMessages.IPyWidgetLoadSuccess) {
                    loaded = true;
                }
            });
        }

        // Execute cell. It should load and render the widget
        await executeCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        assert.ok(loaded, 'Widget did not load successfully during execution');
    });
});
