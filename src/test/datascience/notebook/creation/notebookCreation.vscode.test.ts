// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands, window } from 'vscode';
import { IApplicationShell } from '../../../../client/common/application/types';
import { PYTHON_LANGUAGE } from '../../../../client/common/constants';
import { traceInfo } from '../../../../client/common/logger';
import { IDisposable } from '../../../../client/common/types';
import { Commands } from '../../../../client/datascience/constants';
import { CreationOptionService } from '../../../../client/datascience/notebook/creation/creationOptionsService';
import { IExtensionTestApi, waitForCondition } from '../../../common';
import { IS_3RD_PARTY_INTEGRATION_TEST, IS_NON_RAW_NATIVE_TEST, IS_REMOTE_NATIVE_TEST } from '../../../constants';
import { initialize } from '../../../initialize';
import { canRunNotebookTests, closeNotebooksAndCleanUpAfterTests, ensureNewNotebooksHavePythonCells } from '../helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Creation Integration)', function () {
    this.timeout(15_000);
    let api: IExtensionTestApi;
    let creationOptions: CreationOptionService;
    const disposables: IDisposable[] = [];
    suiteSetup(async function () {
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST || IS_NON_RAW_NATIVE_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }
        creationOptions = api.serviceContainer.get<CreationOptionService>(CreationOptionService);
        await ensureNewNotebooksHavePythonCells();
    });
    teardown(async () => {
        sinon.restore();
        await closeNotebooksAndCleanUpAfterTests();
    });
    setup(() => sinon.restore());
    teardown(async () => closeNotebooksAndCleanUpAfterTests(disposables));
    test.only('Third party extension has registered its provider', async function () {
        if (!IS_3RD_PARTY_INTEGRATION_TEST) {
            return this.skip();
        }
        assert.ok(creationOptions.registrations.length);
        assert.ok(creationOptions.registrations.find((item) => item.extensionId === 'ms-toolsai.ms-toolsai-test'));
    });
    test.only('With 3rd party integration, display quick pick when selecting create blank notebook command', async function () {
        if (IS_3RD_PARTY_INTEGRATION_TEST) {
            return this.skip();
        }
        // In this case we don't expect other extensions to be installed that would register themselves with us.
        assert.equal(creationOptions.registrations.length, 0);
        assert.isUndefined(window.activeNotebookEditor);

        const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const stub = sinon.stub(appShell, 'showQuickPick').callsFake((items: any) => {
            traceInfo(`Quick Pick displayed to user`);
            assert.isAtLeast(items.length, 2);

            // If this is the first time this prompt was displayed, then select the second item (julia).
            // Adde by sample extension (here src/test/datascience/extensionapi/exampleextension/ms-ai-tools-test/src/extension.ts).
            if ((stub.callCount = 0)) {
                return items[1];
            }

            // Pick the first item, that will be us.
            return items[1];
        });

        // Create a blank notebook & we should have a julia cell.
        await createNotebookAndValidateLanguageOfFirstCell(PYTHON_LANGUAGE.toLowerCase());
        assert.equal(stub.callCount, 1);

        await closeNotebooksAndCleanUpAfterTests();

        // Try again & this time select the first item from the list & we should end up with a python notebook.
        await createNotebookAndValidateLanguageOfFirstCell(PYTHON_LANGUAGE.toLowerCase());
        assert.equal(stub.callCount, 2);
    });
    async function createNotebookAndValidateLanguageOfFirstCell(expectedLanguage: string) {
        await commands.executeCommand(Commands.CreateNewNotebook);
        await waitForCondition(async () => !!window.activeNotebookEditor, 10_000, 'New Notebook not created');
        assert.equal(window.activeNotebookEditor!.document.cells[0].language.toLowerCase(), expectedLanguage);
    }
    test.only('Without 3rd party integration, do not display quick pick when selecting create blank notebook command', async function () {
        if (IS_3RD_PARTY_INTEGRATION_TEST) {
            return this.skip();
        }
        // In this case we don't expect other extensions to be installed that would register themselves with us.
        assert.equal(creationOptions.registrations.length, 0);
        assert.isUndefined(window.activeNotebookEditor);

        // Create a blank notebook & it should just work.
        await createNotebookAndValidateLanguageOfFirstCell(PYTHON_LANGUAGE.toLowerCase());
    });
});
