// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */
import type * as nbformat from '@jupyterlab/nbformat';
import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as path from '../../../platform/vscode-path/path';
import { Uri } from 'vscode';
import { removeSvgs } from '../../../notebooks/export/exportUtil.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants.node';

suite('Export Util @export', () => {
    const testPdfIpynb: Uri = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'export', 'testPDF.ipynb')
    );
    test('Remove svgs from model', async () => {
        const contents = fs.readFileSync(testPdfIpynb.fsPath).toString();

        const contentsWithoutSvg = await removeSvgs(contents);
        const model = JSON.parse(contentsWithoutSvg) as nbformat.INotebookContent;

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
