// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as path from '../../../platform/vscode-path/path';
import * as tmp from 'tmp';
import { Uri } from 'vscode';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfoIfCI } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { swallowExceptions } from '../../../platform/common/utils/misc';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_SMOKE_TEST } from '../../constants.node';
import { INotebookEditorProvider } from '../../../notebooks/types';
import {
    closeNotebooksAndCleanUpAfterTestsCommon,
    closeNotebooksCommon,
    deleteAllCellsAndWait,
    getServices,
    waitForKernelToGetAutoSelected
} from './helper';
export * from './helper';

export async function createTemporaryFile(options: {
    templateFile?: string;
    contents?: string;
    extension?: string;
    dir?: string;
}): Promise<{ file: string } & IDisposable> {
    const extension = options.templateFile ? path.extname(options.templateFile) : options.extension || '.py';
    const tempFile = tmp.tmpNameSync({ postfix: extension, dir: options.dir });
    if (options.templateFile) {
        await fs.copyFile(options.templateFile, tempFile);
    } else if (options.contents) {
        await fs.writeFile(tempFile, options.contents);
    }
    return { file: tempFile, dispose: () => swallowExceptions(() => fs.unlinkSync(tempFile)) };
}

export async function createTemporaryNotebook(
    templateFile: string,
    disposables: IDisposable[],
    kernelName: string = 'Python 3'
): Promise<string> {
    const extension = path.extname(templateFile);
    fs.ensureDirSync(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'tmp'));
    const tempFile = tmp.tmpNameSync({
        postfix: extension,
        dir: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'tmp'),
        prefix: path.basename(templateFile, '.ipynb')
    });
    if (await fs.pathExists(templateFile)) {
        const contents = JSON.parse(await fs.readFile(templateFile, { encoding: 'utf-8' }));
        if (contents.kernel) {
            contents.kernel.display_name = kernelName;
        }
        await fs.writeFile(tempFile, JSON.stringify(contents, undefined, 4));
    }

    disposables.push({ dispose: () => swallowExceptions(() => fs.unlinkSync(tempFile)) });
    return tempFile;
}

/**
 * Open an existing notebook with some metadata that tells extension to use Python kernel.
 * Else creating a blank notebook could result in selection of non-python kernel, based on other tests.
 * We have other tests where we test non-python kernels, this could mean we might end up with non-python kernels
 * when creating a new notebook.
 * This function ensures we always open a notebook for testing that is guaranteed to use a Python kernel.
 */
export async function createEmptyPythonNotebook(disposables: IDisposable[] = []) {
    traceInfoIfCI('Creating an empty notebook');
    const { serviceContainer } = await getServices();
    const templatePythonNbFile = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src/test/datascience/notebook/emptyPython.ipynb'
    );
    const editorProvider = serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
    const vscodeNotebook = serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    // Don't use same file (due to dirty handling, we might save in dirty.)
    // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
    const nbFile = await createTemporaryNotebook(templatePythonNbFile, disposables);
    // Open a python notebook and use this for all tests in this test suite.
    await editorProvider.open(Uri.file(nbFile));
    assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
    await waitForKernelToGetAutoSelected();
    await deleteAllCellsAndWait();
}

export function closeNotebooksAndCleanUpAfterTests(disposables: IDisposable[] = []) {
    return closeNotebooksAndCleanUpAfterTestsCommon(IS_SMOKE_TEST, disposables);
}

export function closeNotebooks(disposables: IDisposable[] = []) {
    return closeNotebooksCommon(disposables);
}
