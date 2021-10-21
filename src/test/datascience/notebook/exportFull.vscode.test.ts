// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { Common } from '../../../client/common/utils/localize';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IDisposable, Product } from '../../../client/common/types';
import { captureScreenShot, IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import { ProductNames } from '../../../client/common/installer/productNames';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    hijackPrompt,
    insertCodeCell,
    insertMarkdownCell,
    startJupyterServer,
    workAroundVSCodeNotebookStartPages
} from './helper';
import { commands, window, workspace } from 'vscode';
import { createDeferred } from '../../../client/common/utils/async';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const expectedPromptMessageSuffix = `requires ${ProductNames.get(Product.ipykernel)!} to be installed.`;

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('IANHU DataScience - VSCode Notebook - (Export) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;

    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup');
        this.timeout(120_000);
        try {
            api = await initialize();
            if (!(await canRunNotebookTests())) {
                return this.skip();
            }
            await workAroundVSCodeNotebookStartPages();
            await hijackPrompt(
                'showErrorMessage',
                { endsWith: expectedPromptMessageSuffix },
                { text: Common.install(), clickImmediately: true },
                disposables
            );

            sinon.restore();
            vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            await captureScreenShot('export-suite');
            throw e;
        }
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        try {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            sinon.restore();
            await startJupyterServer();
            await createEmptyPythonNotebook(disposables);
            assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this.currentTest?.title || 'unknown');
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this.currentTest?.title);
        }
        // Added temporarily to identify why tests are failing.
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Export a basic notebook document', async () => {
        await insertCodeCell('print("Hello World")', { index: 0 });
        await insertMarkdownCell('# Markdown Header\nmarkdown string', { index: 1 });
        await insertCodeCell('%whos', { index: 2 });

        const deferred = createDeferred<any>();
        const onDidChangeDispose = window.onDidChangeActiveTextEditor((te) => {
            if (te) {
                // Make sure we have a new editor (not undefined)
                deferred.resolve();
            }
        });

        // Execute our export command
        await commands.executeCommand('jupyter.exportAsPythonScript');

        // Wait until our active document changes
        await deferred;

        assert(window.activeTextEditor?.document.languageId === 'python', 'Document opened by export was not python');

        const text = window.activeTextEditor?.document.getText();

        // Verify text content
        assert(
            text ===
                `# %%\nprint("Hello World")\n# %% [markdown]\n# # Markdown Header\n# markdown string\n# %%\n%whos\n`,
            'Exported text does not match'
        );

        // Clean up dispose
        onDidChangeDispose.dispose();
    });
    test('Export a basic notebook document with magics commented out', async () => {
        await insertCodeCell('print("Hello World")', { index: 0 });
        await insertMarkdownCell('# Markdown Header\nmarkdown string', { index: 1 });
        await insertCodeCell('%whos', { index: 2 });

        const deferred = createDeferred<any>();
        const onDidChangeDispose = window.onDidChangeActiveTextEditor((_te) => {
            deferred.resolve();
        });

        const settings = workspace.getConfiguration('jupyter', null);
        await settings.update('commentMagicCommandsOnExport', true);

        // Execute our export command
        await commands.executeCommand('jupyter.exportAsPythonScript');

        // Wait until our active document changes
        await deferred;

        assert(window.activeTextEditor?.document.languageId === 'python', 'Document opened by export was not python');

        const text = window.activeTextEditor?.document.getText();

        // Verify text content
        assert(
            text ===
                `# %%\nprint("Hello World")\n# %% [markdown]\n# # Markdown Header\n# markdown string\n# %%\n# %whos\n`,
            'Exported text does not match'
        );

        // Clean up dispose
        onDidChangeDispose.dispose();

        // Revert back our settings
        await settings.update('commentMagicCommandsOnExport', false);
    });
});
