// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import { DataScience } from '../../../client/common/utils/localize';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IDisposable } from '../../../client/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common';
import { initialize } from '../../initialize';
import {
    closeNotebooksAndCleanUpAfterTests,
    insertCodeCell,
    createEmptyPythonNotebook,
    workAroundVSCodeNotebookStartPages
} from './helper';
import { NotebookCellBangInstallDiagnosticsProvider } from '../../../client/datascience/notebook/diagnosticsProvider';
import { NotebookDocument, Range } from 'vscode';
import { IExtensionSyncActivationService } from '../../../client/activation/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Execution) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let diagnosticProvider: NotebookCellBangInstallDiagnosticsProvider;
    let activeNotebook: NotebookDocument;
    setup(async function () {
        try {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            api = await initialize();
            await workAroundVSCodeNotebookStartPages();
            vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
            diagnosticProvider = api.serviceContainer
                .getAll<NotebookCellBangInstallDiagnosticsProvider>(IExtensionSyncActivationService)
                .find((item) => item instanceof NotebookCellBangInstallDiagnosticsProvider)!;
            await createEmptyPythonNotebook(disposables);
            activeNotebook = vscodeNotebook.activeNotebookEditor!.document;
            assert.isOk(activeNotebook, 'No active notebook');
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this.currentTest?.title || 'unknown');
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
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

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
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

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
