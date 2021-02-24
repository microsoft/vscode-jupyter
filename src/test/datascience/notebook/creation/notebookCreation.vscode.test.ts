// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands } from 'vscode';
import { IApplicationShell, IVSCodeNotebook } from '../../../../client/common/application/types';
import { PYTHON_LANGUAGE } from '../../../../client/common/constants';
import { traceInfo } from '../../../../client/common/logger';
import { IDisposable } from '../../../../client/common/types';
import { Commands } from '../../../../client/datascience/constants';
import { CreationOptionService } from '../../../../client/datascience/notebook/creation/creationOptionsService';
import { IExtensionTestApi, waitForCondition } from '../../../common';
import { IS_NON_RAW_NATIVE_TEST, IS_REMOTE_NATIVE_TEST } from '../../../constants';
import { closeActiveWindows, initialize } from '../../../initialize';
import { canRunNotebookTests, closeNotebooksAndCleanUpAfterTests, ensureNewNotebooksHavePythonCells } from '../helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Creation Integration)', function () {
    this.timeout(15_000);
    let api: IExtensionTestApi;
    let vscodeNotebook: IVSCodeNotebook;
    let creationOptions: CreationOptionService;
    const disposables: IDisposable[] = [];
    suiteSetup(async function () {
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST || IS_NON_RAW_NATIVE_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }
        creationOptions = api.serviceContainer.get<CreationOptionService>(CreationOptionService);
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        creationOptions.clear();
        await ensureNewNotebooksHavePythonCells();
    });
    teardown(async () => {
        sinon.restore();
        creationOptions.clear();
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    setup(async () => {
        sinon.restore();
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    teardown(async () => closeNotebooksAndCleanUpAfterTests(disposables));
    async function createNotebookAndValidateLanguageOfFirstCell(expectedLanguage: string) {
        await commands.executeCommand(Commands.CreateNewNotebook);
        await waitForCondition(async () => !!vscodeNotebook.activeNotebookEditor, 10_000, 'New Notebook not created');
        assert.strictEqual(
            vscodeNotebook.activeNotebookEditor!.document.cells[0].language.toLowerCase(),
            expectedLanguage
        );
    }
    test('With 3rd party integration, display quick pick when selecting create blank notebook command', async function () {
        await creationOptions.registerNewNotebookContent({ defaultCellLanguage: 'julia' });
        assert.equal(creationOptions.registrations.length, 1);
        assert.isUndefined(vscodeNotebook.activeNotebookEditor);

        const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const stub = sinon.stub(appShell, 'showQuickPick').callsFake((items: any) => {
            traceInfo(`Quick Pick displayed to user`);
            assert.isAtLeast(items.length, 2);

            // If this is the first time this prompt was displayed, then select the second item (julia).
            if (stub.callCount === 1) {
                return items[1];
            }

            // Pick the first item, that will be us.
            return items[0];
        });
        disposables.push({ dispose: () => stub.restore() });

        // Create a blank notebook & we should have a julia cell.
        await createNotebookAndValidateLanguageOfFirstCell('julia');
        assert.equal(stub.callCount, 1);

        await closeActiveWindows();

        // Try again & this time select the first item from the list & we should end up with a python notebook.
        await createNotebookAndValidateLanguageOfFirstCell(PYTHON_LANGUAGE.toLowerCase());
        assert.equal(stub.callCount, 2);
    });
    test('Without 3rd party integration, do not display quick pick when selecting create blank notebook command', async function () {
        assert.equal(creationOptions.registrations.length, 0);
        assert.isUndefined(vscodeNotebook.activeNotebookEditor);

        // Create a blank notebook & it should just work.
        await createNotebookAndValidateLanguageOfFirstCell(PYTHON_LANGUAGE.toLowerCase());
    });
    test('Create Java & Julia Notebook using API', async function () {
        await api.createBlankNotebook({ defaultCellLanguage: 'java' });

        await waitForCondition(async () => !!vscodeNotebook.activeNotebookEditor, 10_000, 'New Notebook not created');
        assert.strictEqual(vscodeNotebook.activeNotebookEditor!.document.cells[0].language.toLowerCase(), 'java');

        await closeActiveWindows();

        await api.createBlankNotebook({ defaultCellLanguage: 'julia' });

        await waitForCondition(async () => !!vscodeNotebook.activeNotebookEditor, 10_000, 'New Notebook not created');
        assert.strictEqual(vscodeNotebook.activeNotebookEditor!.document.cells[0].language.toLowerCase(), 'julia');
    });
});
