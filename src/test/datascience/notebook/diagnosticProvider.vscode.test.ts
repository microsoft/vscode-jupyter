// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import { DataScience } from '../../../platform/common/utils/localize';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common.node';
import { initialize } from '../../initialize.node';
import { closeNotebooksAndCleanUpAfterTests, insertCodeCell, createEmptyPythonNotebook } from './helper.node';
import { NotebookDocument, Range } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { NotebookCellBangInstallDiagnosticsProvider } from '../../../standalone/intellisense/diagnosticsProvider';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('VSCode Notebook -', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let diagnosticProvider: NotebookCellBangInstallDiagnosticsProvider;
    let activeNotebook: NotebookDocument;
    setup(async function () {
        try {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            api = await initialize();
            vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
            diagnosticProvider = api.serviceContainer
                .getAll<NotebookCellBangInstallDiagnosticsProvider>(IExtensionSyncActivationService)
                .find((item) => item instanceof NotebookCellBangInstallDiagnosticsProvider)!;
            await createEmptyPythonNotebook(disposables, undefined, undefined, true);
            activeNotebook = vscodeNotebook.activeNotebookEditor!.notebook;
            assert.isOk(activeNotebook, 'No active notebook');
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this);
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    test('Show error for pip install', async () => {
        await insertCodeCell('!pip install xyz', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await waitForCondition(
            async () => (diagnosticProvider.problems.get(cell.document.uri) || []).length > 0,
            5_000,
            'No problems detected'
        );
        const problem = diagnosticProvider.problems.get(cell.document.uri)![0];
        assert.equal(problem.message, DataScience.percentPipCondaInstallInsteadOfBang().format('pip'));
        assert.isTrue(
            problem.range.isEqual(new Range(0, 0, 0, 12)),
            `Range is not as expected ${problem.range.toString()}`
        );
    });
    test('Show error for conda install', async () => {
        await insertCodeCell('!conda install xyz', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await waitForCondition(
            async () => (diagnosticProvider.problems.get(cell.document.uri) || []).length > 0,
            5_000,
            'No problems detected'
        );
        const problem = diagnosticProvider.problems.get(cell.document.uri)![0];
        assert.equal(problem.message, DataScience.percentPipCondaInstallInsteadOfBang().format('conda'));
        assert.isTrue(
            problem.range.isEqual(new Range(0, 0, 0, 14)),
            `Range is not as expected ${problem.range.toString()}`
        );
    });
});
