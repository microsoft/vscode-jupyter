// Licensed under the MIT License.
// Copyright (c) Microsoft Corporation. All rights reserved.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import * as path from 'path';
import { CancellationTokenSource, Uri } from 'vscode';
import { IDocumentManager } from '../../../client/common/application/types';
import { IFileSystem } from '../../../client/common/platform/types';
import { ExportInterpreterFinder } from '../../../client/datascience/export/exportInterpreterFinder';
import { ExportFormat, IExport } from '../../../client/datascience/export/types';
import { IExtensionTestApi } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants';
import { closeActiveWindows, initialize } from '../../initialize';

suite('DataScience - Export Python', function () {
    let api: IExtensionTestApi;
    this.timeout(10_000);
    suiteSetup(async function () {
        api = await initialize();
        // Export to Python tests require jupyter to run. Othewrise can't
        // run any of our variable execution code
        const isRollingBuild = process.env ? process.env.VSC_FORCE_REAL_JUPYTER !== undefined : false;
        if (!isRollingBuild) {
            // eslint-disable-next-line no-console
            console.log('Skipping Export to Python tests. Requires python environment');
            // eslint-disable-next-line no-invalid-this
            this.skip();
        }
        // eslint-disable-next-line no-invalid-this
        this.skip();
    });
    teardown(closeActiveWindows);
    suiteTeardown(closeActiveWindows);
    test('Export To Python', async () => {
        const fileSystem = api.serviceContainer.get<IFileSystem>(IFileSystem);
        const exportToPython = api.serviceContainer.get<IExport>(IExport, ExportFormat.python);
        const target = Uri.file((await fileSystem.createTemporaryLocalFile('.py')).filePath);
        const token = new CancellationTokenSource();
        const exportInterpreterFinder = api.serviceContainer.get<ExportInterpreterFinder>(ExportInterpreterFinder);
        const interpreter = await exportInterpreterFinder.getExportInterpreter(ExportFormat.html);
        await exportToPython.export(
            Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'export', 'test.ipynb')),
            target,
            interpreter,
            token.token
        );

        const documentManager = api.serviceContainer.get<IDocumentManager>(IDocumentManager);
        assert.include(documentManager.activeTextEditor!.document.getText(), 'tim = 1');
    });
});
