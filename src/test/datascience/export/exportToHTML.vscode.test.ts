// Licensed under the MIT License.
// Copyright (c) Microsoft Corporation. All rights reserved.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import * as path from '../../../platform/vscode-path/path';
import { CancellationTokenSource, Uri } from 'vscode';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { ExportInterpreterFinder } from '../../../platform/export/exportInterpreterFinder.node';
import { INbConvertExport, ExportFormat } from '../../../platform/export/types';
import { IExtensionTestApi } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants.node';
import { closeActiveWindows, initialize } from '../../initialize.node';

suite('DataScience - Export HTML', function () {
    let api: IExtensionTestApi;
    this.timeout(20_000);
    suiteSetup(async function () {
        api = await initialize();
    });
    teardown(closeActiveWindows);
    suiteTeardown(closeActiveWindows);
    test('Export To HTML', async () => {
        const fileSystem = api.serviceContainer.get<IFileSystemNode>(IFileSystemNode);
        const exportToHTML = api.serviceContainer.get<INbConvertExport>(INbConvertExport, ExportFormat.html);
        const exportInterpreterFinder = api.serviceContainer.get<ExportInterpreterFinder>(ExportInterpreterFinder);
        const file = await fileSystem.createTemporaryLocalFile('.html');
        const target = Uri.file(file.filePath);
        await file.dispose();
        const token = new CancellationTokenSource();
        const interpreter = await exportInterpreterFinder.getExportInterpreter();
        await exportToHTML.export(
            Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'export', 'test.ipynb')),
            target,
            interpreter,
            token.token
        );

        assert.equal(await fileSystem.localFileExists(target.fsPath), true);
        const fileContents = await fileSystem.readLocalFile(target.fsPath);
        assert.include(fileContents, '<!DOCTYPE html>');
        // this is the content of a cell
        assert.include(fileContents, 'f6886df81f3d4023a2122cc3f55fdbec');
    });
});
