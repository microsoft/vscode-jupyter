// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { nbformat } from '@jupyterlab/coreutils';
import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import { NotebookCellKind, commands, Uri, NotebookContentProvider, CancellationTokenSource } from 'vscode';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import {
    CellMetadata,
    CellOutputMetadata,
    hasErrorOutput,
    translateCellErrorOutput
} from '../../../client/datascience/notebook/helpers/helpers';
import { INotebookContentProvider } from '../../../client/datascience/notebook/types';
import { INotebookStorageProvider } from '../../../client/datascience/notebookStorage/notebookStorageProvider';
import { VSCodeNotebookModel } from '../../../client/datascience/notebookStorage/vscNotebookModel';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { IS_NON_RAW_NATIVE_TEST } from '../../constants';
import { EXTENSION_ROOT_DIR_FOR_TESTS, initialize, IS_REMOTE_NATIVE_TEST } from '../../initialize';
import { createTemporaryFile } from '../../utils/fs';
import { openNotebook } from '../helpers';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    saveActiveNotebook,
    trustAllNotebooks
} from './helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Open)', function () {
    this.timeout(15_000);
    const templateIPynbWithOutput = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'test.ipynb'
    );
    const templateIPynb = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'withOutput.ipynb'
    );
    let api: IExtensionTestApi;
    let testIPynb: Uri;
    let testIPynbWithOutput: Uri;
    let vscodeNotebook: IVSCodeNotebook;
    let contentProvider: NotebookContentProvider;
    const disposables: IDisposable[] = [];
    suiteSetup(async function () {
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST || IS_NON_RAW_NATIVE_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        contentProvider = api.serviceContainer.get<NotebookContentProvider>(INotebookContentProvider);
    });
    setup(async () => {
        sinon.restore();
        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        testIPynb = Uri.file(await createTemporaryNotebook(templateIPynb, disposables));
        testIPynbWithOutput = Uri.file(await createTemporaryNotebook(templateIPynbWithOutput, disposables));
        await trustAllNotebooks();
    });
    teardown(async () => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Opening a 0 byte ipynb file will have an empty cell', async () => {
        const tmpFile = await createTemporaryFile('.ipynb');
        disposables.push({ dispose: () => tmpFile.cleanupCallback() });

        const notebookData = await contentProvider.openNotebook(
            Uri.file(tmpFile.filePath),
            {},
            new CancellationTokenSource().token
        );

        // We must have a default empty cell
        assert.equal(notebookData.cells.length, 1);
        assert.isEmpty(notebookData.cells[0].source);
    });
    test('Verify Notebook Json', async () => {
        const storageProvider = api.serviceContainer.get<INotebookStorageProvider>(INotebookStorageProvider);
        const file = path.join(
            EXTENSION_ROOT_DIR_FOR_TESTS,
            'src',
            'test',
            'datascience',
            'notebook',
            'testJsonContents.ipynb'
        );
        const model = await storageProvider.getOrCreateModel({ file: Uri.file(file) });
        disposables.push(model);
        model.trust();
        const jsonStr = fs.readFileSync(file, { encoding: 'utf8' });

        // JSON should be identical, before and after trusting a notebook.
        assert.deepEqual(JSON.parse(jsonStr), JSON.parse(model.getContent()));

        model.trust();

        assert.deepEqual(JSON.parse(jsonStr), JSON.parse(model.getContent()));
    });
    test('Verify cells (content, metadata & output)', async () => {
        const editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        const model = (await editorProvider.open(testIPynb))!.model! as VSCodeNotebookModel;
        await model.trustNotebook(); // We want to test the output as well.

        const notebook = vscodeNotebook.activeNotebookEditor?.document!;

        assert.equal(notebook.cellCount, model?.cellCount, 'Incorrect number of cells');
        assert.equal(notebook.cellCount, 6, 'Incorrect number of cells');

        // Cell 1.
        assert.equal(notebook.cellAt(0).kind, NotebookCellKind.Code, 'Cell1, type');
        assert.lengthOf(notebook.cellAt(0).outputs, 0, 'Cell1, outputs');
        assert.include(notebook.cellAt(0).document.getText(), 'a=1', 'Cell1, source');
        assert.isUndefined(notebook.cellAt(0).latestExecutionSummary?.executionOrder, 'Cell1, execution count');
        assert.lengthOf(Object.keys(notebook.cellAt(0).metadata.custom || {}), 1, 'Cell1, metadata');
        assert.containsAllKeys(notebook.cellAt(0).metadata.custom || {}, { metadata: '' }, 'Cell1, metadata');

        // Cell 2.
        assert.equal(notebook.cellAt(1).kind, NotebookCellKind.Code, 'Cell2, type');
        assert.include(notebook.cellAt(1).document.getText(), 'pip list', 'Cell1, source');
        assert.lengthOf(notebook.cellAt(1).outputs, 1, 'Cell2, outputs');
        // assert.equal(notebook.cells[1].outputs[0].outputKind, CellOutputKind.Rich, 'Cell2, output');
        assert.equal(notebook.cellAt(1).latestExecutionSummary?.executionOrder, 3, 'Cell2, execution count');
        assert.lengthOf(Object.keys(notebook.cellAt(1).metadata.custom || {}), 1, 'Cell2, metadata');
        assert.deepEqual(notebook.cellAt(1).metadata.custom?.metadata.tags, ['WOW'], 'Cell2, metadata');

        // Cell 3.
        assert.equal(notebook.cellAt(2).kind, NotebookCellKind.Markdown, 'Cell3, type');
        assert.include(notebook.cellAt(2).document.getText(), '# HELLO WORLD', 'Cell3, source');
        assert.lengthOf(notebook.cellAt(2).outputs, 0, 'Cell3, outputs');
        assert.isUndefined(notebook.cellAt(2).latestExecutionSummary?.executionOrder, 'Cell3, execution count');
        assert.lengthOf(Object.keys(notebook.cellAt(2).metadata.custom || {}), 1, 'Cell3, metadata');
        assert.isEmpty(notebook.cellAt(2).metadata.custom?.metadata, 'Cell3, metadata');

        // Cell 4.
        assert.equal(notebook.cellAt(3).kind, NotebookCellKind.Code, 'Cell4, type');
        assert.include(notebook.cellAt(3).document.getText(), 'with Error', 'Cell4, source');
        assert.lengthOf(notebook.cellAt(3).outputs, 1, 'Cell4, outputs');
        assert.isTrue(hasErrorOutput(notebook.cellAt(3).outputs));
        const nbError = translateCellErrorOutput(notebook.cellAt(3).outputs[0]);
        assert.equal(nbError.ename, 'SyntaxError', 'Cell4, output');
        assert.equal(nbError.evalue, 'invalid syntax (<ipython-input-1-8b7c24be1ec9>, line 1)', 'Cell3, output');
        assert.lengthOf(nbError.traceback, 1, 'Incorrect traceback items');
        assert.include(nbError.traceback[0], 'invalid syntax', 'Cell4, output');
        assert.equal(notebook.cellAt(3).latestExecutionSummary?.executionOrder, 1, 'Cell4, execution count');
        let cellMetadata = notebook.cellAt(3).metadata.custom as CellMetadata;
        assert.lengthOf(Object.keys(cellMetadata || {}), 1, 'Cell4, metadata');
        assert.isObject(cellMetadata.metadata, 'Cell4, metadata');
        assert.isEmpty(cellMetadata.metadata, 'Cell4, metadata should be empty');

        // Cell 5.
        assert.equal(notebook.cellAt(4).kind, NotebookCellKind.Code, 'Cell5, type');
        assert.include(notebook.cellAt(4).document.getText(), 'import matplotlib', 'Cell5, source');
        assert.include(notebook.cellAt(4).document.getText(), 'plt.show()', 'Cell5, source');
        assert.lengthOf(notebook.cellAt(4).outputs, 1, 'Cell5, outputs');
        const richOutput = notebook.cellAt(4).outputs[0];
        assert.deepEqual(
            richOutput.outputs.map((op) => op.mime),
            ['image/svg+xml', 'image/png', 'text/plain'],
            'Cell5, output'
        );

        const cellOutputMetadata = richOutput.outputs[0].metadata as CellOutputMetadata;
        assert.deepEqual(
            cellOutputMetadata.metadata,
            {
                needs_background: 'light'
            },
            'Cell5, output metadata is invalid'
        );
        assert.equal(cellOutputMetadata.outputType, 'display_data', 'Cell5, output');

        // Cell 6.
        assert.equal(notebook.cellAt(5).kind, NotebookCellKind.Code, 'Cell6, type');
        assert.lengthOf(notebook.cellAt(5).outputs, 0, 'Cell6, outputs');
        assert.lengthOf(notebook.cellAt(5).document.getText(), 0, 'Cell6, source');
        assert.isUndefined(notebook.cellAt(5).latestExecutionSummary?.executionOrder, 'Cell6, execution count');
        cellMetadata = notebook.cellAt(5).metadata.custom as CellMetadata;
        assert.lengthOf(Object.keys(cellMetadata || {}), 1, 'Cell6, metadata');
        assert.containsAllKeys(cellMetadata || {}, { metadata: '' }, 'Cell6, metadata');
    });
    test('Verify generation of NotebookJson', async () => {
        const editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        const model = (await editorProvider.open(testIPynb))!.model!;

        const originalJsonStr = (await fs.readFile(templateIPynb, { encoding: 'utf8' })).trim();
        const originalJson: nbformat.INotebookContent = JSON.parse(originalJsonStr);
        assert.equal(JSON.parse(model.getContent()), originalJson, 'Untrusted notebook json content is invalid');
        // https://github.com/microsoft/vscode-python/issues/13155
        // assert.equal(model.getContent(), originalJsonStr, 'Untrusted notebook json not identical');

        model.trust();
        // , originalJson, 'Trusted notebook json content is invalid');
        assert.equal(JSON.parse(model.getContent()), originalJson, 'Trusted notebook json content is invalid');
        // https://github.com/microsoft/vscode-python/issues/13155
        // assert.equal(model.getContent(), originalJsonStr, 'Trusted notebook json not identical');
    });
    test('Saving after clearing should result in execution_count=null in ipynb file', async () => {
        const originalJson = JSON.parse(
            fs.readFileSync(testIPynbWithOutput.fsPath, { encoding: 'utf8' })
        ) as nbformat.INotebookContent;
        // Confirm execution count is a number in existing ipynb file.
        assert.isNumber(originalJson.cells[0].execution_count);

        // Clear the output & then save the notebook.
        await openNotebook(api.serviceContainer, testIPynbWithOutput.fsPath);
        await commands.executeCommand('notebook.clearAllCellsOutputs');

        // Wait till execution count changes & it is marked as dirty
        const notebookDocument = vscodeNotebook.activeNotebookEditor?.document!;
        await waitForCondition(
            async () => !notebookDocument.getCells().some((cell) => cell.outputs.length > 0),
            5_000,
            'Cell output not cleared'
        );
        await saveActiveNotebook(disposables);

        // Open nb json and validate execution_count = null.
        const json = JSON.parse(
            fs.readFileSync(testIPynbWithOutput.fsPath, { encoding: 'utf8' })
        ) as nbformat.INotebookContent;
        assert.isNull(json.cells[0].execution_count);
    });
});
