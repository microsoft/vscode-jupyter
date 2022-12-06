// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */
import type * as nbformat from '@jupyterlab/nbformat';
import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as path from '../../../platform/vscode-path/path';
import { Uri } from 'vscode';
import { IDisposable } from '../../../platform/common/types';
import { ExportUtil } from '../../../notebooks/export/exportUtil.node';
import { IExtensionTestApi } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants.node';
import { closeActiveWindows, initialize } from '../../initialize.node';
import { createTemporaryNotebookFromFile } from '../notebook/helper.node';

suite('Export Util @export', () => {
    let api: IExtensionTestApi;
    let testPdfIpynb: Uri;
    const testDisposables: IDisposable[] = [];
    suiteSetup(async function () {
        api = await initialize();
    });
    setup(async () => {
        // Create a new file (instead of modifying existing file).
        testPdfIpynb = await createTemporaryNotebookFromFile(
            Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'export', 'testPDF.ipynb')),
            testDisposables
        );
    });
    teardown(() => closeActiveWindows(testDisposables));
    suiteTeardown(() => closeActiveWindows(testDisposables));
    test('Remove svgs from model', async () => {
        const exportUtil = api.serviceContainer.get<ExportUtil>(ExportUtil);
        const contents = fs.readFileSync(testPdfIpynb.fsPath).toString();

        const contentsWithoutSvg = await exportUtil.removeSvgs(contents);
        await fs.writeFile(testPdfIpynb.fsPath, contentsWithoutSvg);
        const model = JSON.parse(fs.readFileSync(testPdfIpynb.fsPath).toString()) as nbformat.INotebookContent;

        // make sure no svg exists in model
        const SVG = 'image/svg+xml';
        const PNG = 'image/png';
        for (const cell of model.cells) {
            const outputs = (cell.outputs || []) as nbformat.IOutput[];
            for (const output of outputs) {
                if (output.data) {
                    const data = output.data as nbformat.IMimeBundle;
                    if (PNG in data) {
                        // we only remove svgs if there is a pdf available
                        assert.equal(SVG in data, false);
                    }
                }
            }
        }
    });
});
