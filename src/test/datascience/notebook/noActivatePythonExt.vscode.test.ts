// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { commands, Uri, workspace } from 'vscode';
import { traceInfo } from '../../../client/common/logger';
import { IDisposable, IExtensions } from '../../../client/common/types';
import { createEventHandler, IExtensionTestApi, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../initialize';
import { canRunNotebookTests, closeNotebooksAndCleanUpAfterTests, createTemporaryNotebook } from './helper';
import { PythonExtension } from '../../../client/datascience/constants';
import { JupyterNotebookView } from '../../../client/datascience/notebook/constants';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite.only('DataScience - VSCode Notebook - (Python Ext Activation)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let extensions: IExtensions;
    const templateNbPath = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'simpleCSharp.ipynb'
    );

    this.timeout(120_000);
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize(false);
        if (!(await canRunNotebookTests(false))) {
            return this.skip();
        }
        if (process.env.VSC_JUPYTER_CI_TEST_ACTIVATE_PYTHON_EXT !== 'true') {
            return this.skip();
        }
        sinon.restore();
        extensions = api.serviceContainer.get<IExtensions>(IExtensions);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        sinon.restore();
        // await createEmptyPythonNotebook(disposables);
        traceInfo(`Start Test & completed ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    test('Do not activate Python Extension', async () => {
        // Ensure Python extnsion has not been activated
        assert.isFalse(extensions.getExtension(PythonExtension)?.isActive, 'Python extnsion already activated');

        const orderOrEvents: ('gotExtension' | 'openedNotebook')[] = [];
        workspace.onDidOpenNotebookDocument(() => {
            orderOrEvents.push('openedNotebook');
        }, disposables);
        const stub = sinon.stub(extensions, 'getExtension').callsFake((extId: string) => {
            traceInfo(`get extension '${extId}'`);
            if (extId.toLowerCase() === PythonExtension.toLowerCase()) {
                orderOrEvents.push('gotExtension');
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (extensions.getExtension as any).wrappedMethod.apply(extensions, arguments);
        });
        disposables.push({ dispose: () => stub.restore() });
        const nbOpened = createEventHandler(workspace, 'onDidOpenNotebookDocument', disposables);

        // Open a C# notebook.
        const nbUri = Uri.file(await createTemporaryNotebook(templateNbPath, disposables));
        await commands.executeCommand('vscode.openWith', nbUri, JupyterNotebookView);

        await waitForCondition(async () => nbOpened.fired, 10_000, 'Notebook not opened');

        // Verify we got the onDidOpeNotebookDocument first (before we actiavte the python extension).
        assert.equal(
            orderOrEvents[0],
            'openedNotebook',
            `Should have opened notebook first, instead event order is ${orderOrEvents.join(',')}`
        );
    });
});
