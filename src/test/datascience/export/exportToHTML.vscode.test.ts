// Licensed under the MIT License.
// Copyright (c) Microsoft Corporation. All rights reserved.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import * as path from 'path';
import { CancellationTokenSource, Uri } from 'vscode';
import { IFileSystem } from '../../../client/common/platform/types';
import { ExportInterpreterFinder } from '../../../client/datascience/export/exportInterpreterFinder';
import { ExportFormat, IExport } from '../../../client/datascience/export/types';
import { IExtensionTestApi } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants';
import { closeActiveWindows, initialize } from '../../initialize';

suite('DataScience - Export HTML', function () {
    let api: IExtensionTestApi;
    this.timeout(10_000);
    suiteSetup(async function () {
        api = await initialize();
        // Export to HTML tests require jupyter to run. Othewrise can't
        // run any of our variable execution code
        const isRollingBuild = process.env ? process.env.VSC_FORCE_REAL_JUPYTER !== undefined : false;
        if (!isRollingBuild) {
            // eslint-disable-next-line no-console
            console.log('Skipping Export to HTML tests. Requires python environment');
            // eslint-disable-next-line no-invalid-this
            this.skip();
        }
        // eslint-disable-next-line no-invalid-this
        this.skip();
    });
    teardown(closeActiveWindows);
    suiteTeardown(closeActiveWindows);
    test('Export To HTML', async () => {
        const fileSystem = api.serviceContainer.get<IFileSystem>(IFileSystem);
        const exportToHTML = api.serviceContainer.get<IExport>(IExport, ExportFormat.html);
        const exportInterpreterFinder = api.serviceContainer.get<ExportInterpreterFinder>(ExportInterpreterFinder);
        const file = await fileSystem.createTemporaryLocalFile('.html');
        const target = Uri.file(file.filePath);
        await file.dispose();
        const token = new CancellationTokenSource();
        const interpreter = await exportInterpreterFinder.getExportInterpreter(ExportFormat.html);
        await exportToHTML.export(
            Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'export', 'test.ipynb')),
            target,
            interpreter!,
            token.token
        );

        assert.equal(await fileSystem.localFileExists(target.fsPath), true);
        const fileContents = await fileSystem.readLocalFile(target.fsPath);
        assert.include(fileContents, '<!DOCTYPE html>');
        // this is the content of a cell
        assert.include(fileContents, 'f6886df81f3d4023a2122cc3f55fdbec');
    });
});
