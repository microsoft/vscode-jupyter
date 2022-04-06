// Licensed under the MIT License.
// Copyright (c) Microsoft Corporation. All rights reserved.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import * as path from '../../../platform/vscode-path/path';
import { CancellationTokenSource, Uri } from 'vscode';
import { IDocumentManager } from '../../../platform/common/application/types';
import { IFileSystem } from '../../../platform/common/platform/types.node';
import { ExportInterpreterFinder } from '../../../platform/export/exportInterpreterFinder.node';
import { INbConvertExport, ExportFormat } from '../../../platform/export/types';
import { IExtensionTestApi } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants.node';
import { closeActiveWindows, initialize } from '../../initialize.node';

suite('DataScience - Export Python', function () {
    let api: IExtensionTestApi;
    this.timeout(10_000);
    suiteSetup(async function () {
        api = await initialize();
    });
    teardown(closeActiveWindows);
    suiteTeardown(closeActiveWindows);
    test('Export To Python', async () => {
        const fileSystem = api.serviceContainer.get<IFileSystem>(IFileSystem);
        const exportToPython = api.serviceContainer.get<INbConvertExport>(INbConvertExport, ExportFormat.python);
        const target = Uri.file((await fileSystem.createTemporaryLocalFile('.py')).filePath);
        const token = new CancellationTokenSource();
        const exportInterpreterFinder = api.serviceContainer.get<ExportInterpreterFinder>(ExportInterpreterFinder);
        const interpreter = await exportInterpreterFinder.getExportInterpreter();
        await exportToPython.export(
            Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'export', 'test.ipynb')),
            target,
            interpreter,
            token.token
        );

        const documentManager = api.serviceContainer.get<IDocumentManager>(IDocumentManager);
        const document = await documentManager.openTextDocument(target);
        assert.include(document.getText(), 'tim = 1');
    });
});
