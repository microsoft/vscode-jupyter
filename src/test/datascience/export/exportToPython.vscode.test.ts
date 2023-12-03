// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import * as path from '../../../platform/vscode-path/path';
import { CancellationTokenSource, Uri, workspace } from 'vscode';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { ExportInterpreterFinder } from '../../../notebooks/export/exportInterpreterFinder.node';
import { IExtensionTestApi } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants.node';
import { closeActiveWindows, initialize } from '../../initialize.node';
import { ExportToPython } from '../../../notebooks/export/exportToPython';

suite('Export Python @export', function () {
    let api: IExtensionTestApi;
    this.timeout(10_000);
    suiteSetup(async function () {
        api = await initialize();
    });
    teardown(closeActiveWindows);
    suiteTeardown(closeActiveWindows);
    test('Export To Python', async () => {
        const fileSystem = api.serviceContainer.get<IFileSystemNode>(IFileSystemNode);
        const exportToPython = new ExportToPython();
        const target = Uri.file((await fileSystem.createTemporaryLocalFile('.py')).filePath);
        const token = new CancellationTokenSource();
        const exportInterpreterFinder = api.serviceContainer.get<ExportInterpreterFinder>(ExportInterpreterFinder);
        const interpreter = await exportInterpreterFinder.getExportInterpreter();
        const document = await workspace.openNotebookDocument(
            Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'export', 'test.ipynb'))
        );
        await exportToPython.export(document, target, interpreter, token.token);
        assert.exists(target);
        const targetDocument = await workspace.openTextDocument(target!);
        assert.include(targetDocument.getText(), 'tim = 1');
    });
});
