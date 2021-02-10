// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */

import { nbformat } from '@jupyterlab/coreutils';
import { assert, expect } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import * as tmp from 'tmp';
import { anything, instance, mock, when } from 'ts-mockito';
import { WorkspaceEdit } from 'vscode';
import { commands, Memento, TextDocument, Uri, window, workspace } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import {
    NotebookCell,
    NotebookContentProvider as VSCNotebookContentProvider,
    NotebookDocument
} from '../../../../typings/vscode-proposed';
import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../../../client/common/application/types';
import { JVSC_EXTENSION_ID, MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../client/common/constants';
import { disposeAllDisposables } from '../../../client/common/helpers';
import { traceInfo } from '../../../client/common/logger';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    ICryptoUtils,
    IDisposable,
    IMemento
} from '../../../client/common/types';
import { createDeferred } from '../../../client/common/utils/async';
import { swallowExceptions } from '../../../client/common/utils/misc';
import { CellExecution } from '../../../client/datascience/jupyter/kernels/cellExecution';
import { IKernelProvider } from '../../../client/datascience/jupyter/kernels/types';
import { JupyterServerSelector } from '../../../client/datascience/jupyter/serverSelector';
import { JupyterNotebookView } from '../../../client/datascience/notebook/constants';
import {
    LastSavedNotebookCellLanguage,
    NotebookCellLanguageService
} from '../../../client/datascience/notebook/defaultCellLanguageService';
import { isJupyterKernel } from '../../../client/datascience/notebook/helpers/helpers';
import { chainWithPendingUpdates } from '../../../client/datascience/notebook/helpers/notebookUpdater';
import { VSCodeNotebookKernelMetadata } from '../../../client/datascience/notebook/kernelWithMetadata';
import { NotebookEditor } from '../../../client/datascience/notebook/notebookEditor';
import { INotebookContentProvider, INotebookKernelProvider } from '../../../client/datascience/notebook/types';
import { VSCodeNotebookModel } from '../../../client/datascience/notebookStorage/vscNotebookModel';
import { INotebookEditorProvider, INotebookProvider, ITrustService } from '../../../client/datascience/types';
import { createEventHandler, IExtensionTestApi, sleep, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST, IS_SMOKE_TEST } from '../../constants';
import { noop } from '../../core';
import { closeActiveWindows, initialize, isInsiders } from '../../initialize';
import { JupyterServer } from '../jupyterServer';
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');
const defaultTimeout = 15_000;

async function getServices() {
    const api = await initialize();
    return {
        contentProvider: api.serviceContainer.get<VSCNotebookContentProvider>(INotebookContentProvider),
        vscodeNotebook: api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook),
        editorProvider: api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider),
        serviceContainer: api.serviceContainer,
        kernelProvider: api.serviceContainer.get<INotebookKernelProvider>(INotebookKernelProvider)
    };
}

export async function selectCell(notebook: NotebookDocument, start: number, end: number) {
    await window.showNotebookDocument(notebook, {
        selection: { start, end }
    });
}

export async function insertMarkdownCell(source: string, options?: { index?: number }) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor) {
        throw new Error('No active editor');
    }
    const startNumber = options?.index ?? activeEditor.document.cells.length;
    await chainWithPendingUpdates(activeEditor.document, (edit) =>
        edit.replaceNotebookCells(activeEditor.document.uri, startNumber, 0, [
            {
                cellKind: vscodeNotebookEnums.CellKind.Markdown,
                language: MARKDOWN_LANGUAGE,
                source,
                metadata: {
                    hasExecutionOrder: false
                },
                outputs: []
            }
        ])
    );
    return activeEditor.document.cells[startNumber]!;
}
export async function insertCodeCell(source: string, options?: { language?: string; index?: number }) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor) {
        throw new Error('No active editor');
    }
    const startNumber = options?.index ?? activeEditor.document.cells.length;
    const edit = new WorkspaceEdit();
    edit.replaceNotebookCells(activeEditor.document.uri, startNumber, 0, [
        {
            cellKind: vscodeNotebookEnums.CellKind.Code,
            language: options?.language || PYTHON_LANGUAGE,
            source,
            metadata: {
                hasExecutionOrder: false
            },
            outputs: []
        }
    ]);
    await workspace.applyEdit(edit);

    return activeEditor.document.cells[startNumber]!;
}
export async function deleteCell(index: number = 0) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor || activeEditor.document.cells.length === 0) {
        return;
    }
    if (!activeEditor) {
        assert.fail('No active editor');
        return;
    }
    await chainWithPendingUpdates(activeEditor.document, (edit) =>
        edit.replaceNotebookCells(activeEditor.document.uri, index, 1, [])
    );
}
export async function deleteAllCellsAndWait() {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor || activeEditor.document.cells.length === 0) {
        return;
    }
    await chainWithPendingUpdates(activeEditor.document, (edit) =>
        edit.replaceNotebookCells(activeEditor.document.uri, 0, activeEditor.document.cells.length, [])
    );
}

export async function createTemporaryFile(options: {
    templateFile: string;
    dir: string;
}): Promise<{ file: string } & IDisposable> {
    const extension = path.extname(options.templateFile);
    const tempFile = tmp.tmpNameSync({ postfix: extension, dir: options.dir });
    await fs.copyFile(options.templateFile, tempFile);
    return { file: tempFile, dispose: () => swallowExceptions(() => fs.unlinkSync(tempFile)) };
}

export async function createTemporaryNotebook(templateFile: string, disposables: IDisposable[]): Promise<string> {
    const extension = path.extname(templateFile);
    fs.ensureDirSync(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'tmp'));
    const tempFile = tmp.tmpNameSync({
        postfix: extension,
        dir: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'tmp'),
        prefix: path.basename(templateFile, '.ipynb')
    });
    await fs.copyFile(templateFile, tempFile);
    disposables.push({ dispose: () => swallowExceptions(() => fs.unlinkSync(tempFile)) });
    return tempFile;
}

export async function canRunNotebookTests() {
    if (!isInsiders() || !process.env.VSC_JUPYTER_RUN_NB_TEST) {
        console.log(
            `Can't run native nb tests isInsiders() = ${isInsiders()}, process.env.VSC_JUPYTER_RUN_NB_TEST = ${process.env.VSC_JUPYTER_RUN_NB_TEST
            }`
        );
        return false;
    }
    const api = await initialize();
    const appEnv = api.serviceContainer.get<IApplicationEnvironment>(IApplicationEnvironment);
    const canRunTests = appEnv.extensionChannel !== 'stable';
    if (!canRunTests) {
        console.log(`Can't run native nb tests appEnv.extensionChannel = ${appEnv.extensionChannel}`);
    }
    return canRunTests;
}

export async function shutdownAllNotebooks() {
    const api = await initialize();
    const notebookProvider = api.serviceContainer.get<INotebookProvider>(INotebookProvider);
    const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
    await Promise.all([
        ...notebookProvider.activeNotebooks.map(async (item) => (await item).dispose()),
        kernelProvider.dispose()
    ]);
}

export async function ensureNewNotebooksHavePythonCells() {
    const api = await initialize();
    const globalMemento = api.serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
    const lastLanguage = (
        globalMemento.get<string | undefined>(LastSavedNotebookCellLanguage) || PYTHON_LANGUAGE
    ).toLowerCase();
    if (lastLanguage !== PYTHON_LANGUAGE.toLowerCase()) {
        await globalMemento.update(LastSavedNotebookCellLanguage, PYTHON_LANGUAGE).then(noop, noop);
    }
}
let oldValueFor_alwaysTrustNotebooks: undefined | boolean;
export async function closeNotebooksAndCleanUpAfterTests(disposables: IDisposable[] = []) {
    if (!IS_SMOKE_TEST) {
        // When running smoke tests, we won't have access to these.
        const configSettings = await import('../../../client/common/configSettings');
        // Dispose any cached python settings (used only in test env).
        configSettings.JupyterSettings.dispose();
    }
    if (!isInsiders()) {
        return false;
    }
    await closeActiveWindows();
    disposeAllDisposables(disposables);
    await shutdownAllNotebooks();
    await ensureNewNotebooksHavePythonCells();
    if (typeof oldValueFor_alwaysTrustNotebooks === 'boolean') {
        const api = await initialize();
        const dsSettings = api.serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings();
        (<any>dsSettings).alwaysTrustNotebooks = oldValueFor_alwaysTrustNotebooks;
        oldValueFor_alwaysTrustNotebooks = undefined;
    }

    sinon.restore();
}

export async function closeNotebooks(disposables: IDisposable[] = []) {
    if (!isInsiders()) {
        return false;
    }
    await closeActiveWindows();
    disposeAllDisposables(disposables);
}

export async function waitForKernelToChange(criteria: { labelOrId?: string; interpreterPath?: string }) {
    const { vscodeNotebook, kernelProvider } = await getServices();

    // Wait for the active editor to come up
    await waitForCondition(async () => !!vscodeNotebook.activeNotebookEditor, 10_000, 'Active editor not a notebook');

    // Get the list of kernels possible
    const kernels = (await kernelProvider.provideKernels(
        vscodeNotebook.activeNotebookEditor!.document,
        CancellationToken.None
    )) as VSCodeNotebookKernelMetadata[];

    traceInfo(`Kernels found for wait search: ${kernels?.map((k) => k.label).join('\n')}`);

    // Find the kernel id that matches the name we want
    let id: string | undefined;
    if (criteria.labelOrId) {
        const labelOrId = criteria.labelOrId;
        id = kernels?.find((k) => (labelOrId && k.label.includes(labelOrId)) || (k.id && k.id == labelOrId))?.id;
    }

    if (criteria.interpreterPath) {
        id = kernels
            ?.filter((k) => k.selection.interpreter)
            .find((k) => k.selection.interpreter!.path.toLowerCase().includes(criteria.interpreterPath!.toLowerCase()))
            ?.id;
    }

    // Send a select kernel on the active notebook editor
    void commands.executeCommand('notebook.selectKernel', { id, extension: JVSC_EXTENSION_ID });
    const isRightKernel = () => {
        if (!vscodeNotebook.activeNotebookEditor) {
            return false;
        }
        if (!vscodeNotebook.activeNotebookEditor.kernel) {
            return false;
        }
        if (vscodeNotebook.activeNotebookEditor.kernel.id === id) {
            traceInfo(`Found selected kernel ${vscodeNotebook.activeNotebookEditor.kernel.id}`);
            return true;
        }
        traceInfo(`Active kernel is ${vscodeNotebook.activeNotebookEditor.kernel.id}`);
        return false;
    };
    await waitForCondition(
        async () => isRightKernel(),
        defaultTimeout,
        `Kernel with criteria ${JSON.stringify(criteria)} not selected`
    );
}

export async function waitForKernelToGetAutoSelected(expectedLanguage?: string, time = 100_000) {
    const { vscodeNotebook } = await getServices();

    // Wait for the active kernel to be a julia kernel.
    await waitForCondition(async () => !!vscodeNotebook.activeNotebookEditor?.kernel, time, 'Kernel not auto selected');
    let kernelInfo = '';
    const isRightKernel = () => {
        if (!vscodeNotebook.activeNotebookEditor) {
            return false;
        }
        if (!vscodeNotebook.activeNotebookEditor.kernel) {
            return false;
        }
        if (isJupyterKernel(vscodeNotebook.activeNotebookEditor.kernel)) {
            if (!expectedLanguage) {
                kernelInfo = `<No specific kernel expected> ${JSON.stringify(
                    vscodeNotebook.activeNotebookEditor.kernel.selection
                )}`;
                return true;
            }
            switch (vscodeNotebook.activeNotebookEditor.kernel.selection.kind) {
                case 'startUsingKernelSpec':
                    kernelInfo = `<startUsingKernelSpec>${JSON.stringify(
                        vscodeNotebook.activeNotebookEditor.kernel.selection.kernelSpec || {}
                    )}`;
                    return (
                        vscodeNotebook.activeNotebookEditor.kernel.selection.kernelSpec.language?.toLowerCase() ===
                        expectedLanguage.toLowerCase()
                    );
                case 'startUsingPythonInterpreter':
                    kernelInfo = `<startUsingPythonInterpreter ${vscodeNotebook.activeNotebookEditor.kernel.selection.interpreter.path}>`;
                    return expectedLanguage.toLowerCase() === PYTHON_LANGUAGE.toLowerCase();
                case 'connectToLiveKernel':
                    kernelInfo = `<connectToLiveKernel id: ${vscodeNotebook.activeNotebookEditor.kernel.selection.kernelModel.id}, name: ${vscodeNotebook.activeNotebookEditor.kernel.selection.kernelModel.id}>`;
                    return true;
                default:
                    // We don't support testing other kernels, not required hence not added.
                    // eslint-disable-next-line no-console
                    throw new Error('Testing other kernel connections not supported');
            }
        }
        if (!expectedLanguage) {
            kernelInfo = '<No specific kernel expected>. Non Jupyter Kernel';
            return true;
        }
        return false;
    };

    // Wait for the active kernel to be a julia kernel.
    const errorMessage = expectedLanguage ? `${expectedLanguage} kernel not auto selected` : 'Kernel not auto selected';
    await waitForCondition(async () => isRightKernel(), defaultTimeout, errorMessage);
    traceInfo(`Preferred kernel auto selected for Native Notebook for ${kernelInfo}.`);
}
export async function trustNotebook(ipynbFile: string | Uri) {
    traceInfo(`Trusting Notebook ${ipynbFile}`);
    const api = await initialize();
    const uri = typeof ipynbFile === 'string' ? Uri.file(ipynbFile) : ipynbFile;
    const content = await fs.readFile(uri.fsPath, { encoding: 'utf8' });
    await api.serviceContainer.get<ITrustService>(ITrustService).trustNotebook(uri, content);
}
export async function trustAllNotebooks() {
    const api = await initialize();
    const dsSettings = api.serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings();
    if (oldValueFor_alwaysTrustNotebooks !== undefined) {
        oldValueFor_alwaysTrustNotebooks = dsSettings.alwaysTrustNotebooks;
    }
    (<any>dsSettings).alwaysTrustNotebooks = true;
}

export async function startJupyterServer(api?: IExtensionTestApi) {
    const { serviceContainer } = api ? { serviceContainer: api.serviceContainer } : await getServices();
    if (IS_REMOTE_NATIVE_TEST) {
        const selector = serviceContainer.get<JupyterServerSelector>(JupyterServerSelector);
        const uri = await JupyterServer.instance.startJupyterWithToken();
        const uriString = decodeURIComponent(uri.toString());
        traceInfo(`Jupyter started and listening at ${uriString}`);
        await selector.setJupyterURIToRemote(uriString);
    } else {
        traceInfo(`Jupyter not started and set to local`); // This is the default
    }
}
/**
 * Open an existing notebook with some metadata that tells extension to use Python kernel.
 * Else creating a blank notebook could result in selection of non-python kernel, based on other tests.
 * We have other tests where we test non-python kernels, this could mean we might end up with non-python kernels
 * when creating a new notebook.
 * This function ensures we always open a notebook for testing that is guaranteed to use a Python kernel.
 */
export async function createEmptyPythonNotebook(disposables: IDisposable[] = []) {
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
    await waitForKernelToGetAutoSelected(undefined);
    await deleteAllCellsAndWait();
}

export async function stopJupyterServer() {
    if (!IS_REMOTE_NATIVE_TEST) {
        return;
    }
    await JupyterServer.instance.dispose().catch(noop);
}

export async function prewarmNotebooks() {
    const { editorProvider, vscodeNotebook, serviceContainer } = await getServices();
    await closeActiveWindows();

    const disposables: IDisposable[] = [];
    try {
        // Ensure preferred language is always Python.
        const memento = serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
        if (memento.get(LastSavedNotebookCellLanguage) !== PYTHON_LANGUAGE) {
            await memento.update(LastSavedNotebookCellLanguage, PYTHON_LANGUAGE);
        }
        await editorProvider.createNew();
        await insertCodeCell('print("Hello World1")', { index: 0 });
        await waitForKernelToGetAutoSelected();
        const cell = vscodeNotebook.activeNotebookEditor!.document.cells[0]!;
        await runAllCellsInActiveNotebook();
        // Wait for Jupyter to start.
        await waitForExecutionCompletedSuccessfully(cell, 60_000);
        await closeActiveWindows();
    } finally {
        disposables.forEach((d) => d.dispose());
    }
}

function assertHasExecutionCompletedSuccessfully(cell: NotebookCell) {
    return (
        (cell.metadata.executionOrder ?? 0) > 0 &&
        cell.metadata.runState === vscodeNotebookEnums.NotebookCellRunState.Success
    );
}
function assertHasEmptyCellExecutionCompleted(cell: NotebookCell) {
    return (
        (cell.metadata.executionOrder ?? 0) === 0 &&
        cell.metadata.runState === vscodeNotebookEnums.NotebookCellRunState.Idle
    );
}
/**
 *  Wait for VSC to perform some last minute clean up of cells.
 * In tests we can end up deleting cells. However if extension is still dealing with the cells, we need to give it some time to finish.
 */
export async function waitForCellExecutionToComplete(cell: NotebookCell) {
    if (!CellExecution.cellsCompletedForTesting.has(cell)) {
        CellExecution.cellsCompletedForTesting.set(cell, createDeferred<void>());
    }
    // Yes hacky approach, however its difficult to synchronize everything as we update cells in a few places while executing.
    // 100ms should be plenty sufficient for other code to get executed when dealing with cells.
    // Again, we need to wait for rest of execution code to access the cells.
    // Else in tests we'd delete the cells & the extension code could fall over trying to access non-existent cells.
    // In fact code doesn't fall over, but VS Code just hangs in tests.
    // If this doesn't work on CI, we'll need to clean up and write more code to ensure we remove these race conditions as done with `CellExecution.cellsCompleted`.
    await CellExecution.cellsCompletedForTesting.get(cell)!.promise;
    await sleep(100);
}
export async function waitForExecutionCompletedSuccessfully(cell: NotebookCell, timeout: number = defaultTimeout) {
    await waitForCondition(
        async () => assertHasExecutionCompletedSuccessfully(cell),
        timeout,
        `Cell ${cell.index + 1} did not complete successfully`
    );
    await waitForCellExecutionToComplete(cell);
}
/**
 * When a cell is running (in progress), the start time will be > 0.
 */
export async function waitForExecutionInProgress(cell: NotebookCell, timeout: number = defaultTimeout) {
    await waitForCondition(
        async () => {
            const result =
                cell.metadata.runState === vscodeNotebookEnums.NotebookCellRunState.Running &&
                    cell.metadata.runStartTime &&
                    !cell.metadata.lastRunDuration &&
                    !cell.metadata.statusMessage
                    ? true
                    : false;
            return result;
        },
        timeout,
        `Cell ${cell.index + 1} did not start`
    );
}
/**
 * When a cell is queued for execution (in progress), the start time, last duration & status message will be `empty`.
 */
export async function waitForQueuedForExecution(cell: NotebookCell, timeout: number = defaultTimeout) {
    await waitForCondition(
        async () =>
            cell.metadata.runState === vscodeNotebookEnums.NotebookCellRunState.Running &&
                !cell.metadata.runStartTime &&
                !cell.metadata.lastRunDuration &&
                !cell.metadata.statusMessage
                ? true
                : false,
        timeout,
        `Cell ${cell.index + 1} not queued for execution`
    );
}
export async function waitForEmptyCellExecutionCompleted(cell: NotebookCell, timeout: number = defaultTimeout) {
    await waitForCondition(
        async () => assertHasEmptyCellExecutionCompleted(cell),
        timeout,
        `Cell ${cell.index + 1} did not complete (this is an empty cell)`
    );
    await waitForCellExecutionToComplete(cell);
}
export async function waitForExecutionCompletedWithErrors(cell: NotebookCell, timeout: number = defaultTimeout) {
    await waitForCondition(
        async () => assertHasExecutionCompletedWithErrors(cell),
        timeout,
        `Cell ${cell.index + 1} did not fail as expected`
    );
    await waitForCellExecutionToComplete(cell);
}
function assertHasExecutionCompletedWithErrors(cell: NotebookCell) {
    return (
        (cell.metadata.executionOrder ?? 0) > 0 &&
        cell.metadata.runState === vscodeNotebookEnums.NotebookCellRunState.Error
    );
}
export function assertHasTextOutputInVSCode(cell: NotebookCell, text: string, index: number = 0, isExactMatch = true) {
    const cellOutputs = cell.outputs;
    assert.ok(cellOutputs.length, 'No output');
    // assert.equal(cellOutputs[index].outputKind, vscodeNotebookEnums.CellOutputKind.Rich, 'Incorrect output kind');
    const outputText = (cellOutputs[index].outputs.find(opit => opit.mime === 'text/plain')?.value as string).trim();
    if (isExactMatch) {
        assert.equal(outputText, text, 'Incorrect output');
    } else {
        expect(outputText).to.include(text, 'Output does not contain provided text');
    }
    return true;
}
export async function waitForTextOutputInVSCode(
    cell: NotebookCell,
    text: string,
    index: number,
    isExactMatch = true,
    timeout = 1_000
) {
    await waitForCondition(
        async () => assertHasTextOutputInVSCode(cell, text, index, isExactMatch),
        timeout,
        `Output does not contain provided text '${text}' for Cell ${cell.index + 1}`
    );
}
export function assertNotHasTextOutputInVSCode(cell: NotebookCell, text: string, index: number, isExactMatch = true) {
    const cellOutputs = cell.outputs;
    assert.ok(cellOutputs, 'No output');
    // assert.equal(cellOutputs[index].outputKind, vscodeNotebookEnums.CellOutputKind.Rich, 'Incorrect output kind');
    const outputText = (cellOutputs[index].outputs.find(opit => opit.mime === 'text/plain')?.value as string).trim();
    if (isExactMatch) {
        assert.notEqual(outputText, text, 'Incorrect output');
    } else {
        expect(outputText).to.not.include(text, 'Output does not contain provided text');
    }
    return true;
}
export function assertVSCCellIsRunning(cell: NotebookCell) {
    assert.equal(cell.metadata.runState, vscodeNotebookEnums.NotebookCellRunState.Running);
    return true;
}
export function assertVSCCellIsNotRunning(cell: NotebookCell) {
    assert.notEqual(cell.metadata.runState, vscodeNotebookEnums.NotebookCellRunState.Running);
    return true;
}
export function assertVSCCellStateIsUndefinedOrIdle(cell: NotebookCell) {
    if (cell.metadata.runState === undefined) {
        return true;
    }
    assert.equal(cell.metadata.runState, vscodeNotebookEnums.NotebookCellRunState.Idle);
    return true;
}
export function assertVSCCellHasErrors(cell: NotebookCell) {
    assert.equal(cell.metadata.runState, vscodeNotebookEnums.NotebookCellRunState.Error);
    return true;
}
export function assertVSCCellHasErrorOutput(cell: NotebookCell) {
    assert.ok(
        cell.outputs.filter((output) => output.outputs.some(opit => opit.mime === 'application/x.notebook.error-traceback')).length,
        'No error output in cell'
    );
    return true;
}

export async function saveActiveNotebook(disposables: IDisposable[]) {
    const api = await initialize();
    const editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
    if (editorProvider.activeEditor instanceof NotebookEditor) {
        await commands.executeCommand('workbench.action.files.saveAll');
    } else {
        const savedEvent = createEventHandler(editorProvider.activeEditor!.model!, 'changed', disposables);
        await commands.executeCommand('workbench.action.files.saveAll');

        await waitForCondition(async () => savedEvent.all.some((e) => e.kind === 'save'), 5_000, 'Not saved');
    }
}

export function createNotebookModel(
    trusted: boolean,
    uri: Uri,
    globalMemento: Memento,
    crypto: ICryptoUtils,
    nb?: Partial<nbformat.INotebookContent>
) {
    const nbJson: nbformat.INotebookContent = {
        cells: [],
        metadata: {
            orig_nbformat: 4
        },
        nbformat: 4,
        nbformat_minor: 4,
        ...(nb || {})
    };
    const mockVSC = mock<IVSCodeNotebook>();
    when(mockVSC.notebookEditors).thenReturn([]);
    when(mockVSC.notebookDocuments).thenReturn([]);
    const cellLanguageService = mock<NotebookCellLanguageService>();
    when(cellLanguageService.getPreferredLanguage(anything())).thenReturn(
        nb?.metadata?.language_info?.name || PYTHON_LANGUAGE
    );

    return new VSCodeNotebookModel(
        trusted,
        uri,
        globalMemento,
        crypto,
        nbJson,
        ' ',
        3,
        instance(mockVSC),
        instance(cellLanguageService)
    );
}
export async function runCell(cell: NotebookCell) {
    const api = await initialize();
    const vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    await waitForCondition(
        async () => !!vscodeNotebook.activeNotebookEditor?.kernel,
        60_000, // Validating kernel can take a while.
        'Timeout waiting for active kernel'
    );
    if (!vscodeNotebook.activeNotebookEditor || !vscodeNotebook.activeNotebookEditor.kernel) {
        throw new Error('No notebook or kernel');
    }
    // Execute cells (it should throw an error).
    vscodeNotebook.activeNotebookEditor.kernel.executeCell(cell.notebook, cell);
}
export async function runAllCellsInActiveNotebook() {
    const api = await initialize();
    const vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    await waitForCondition(
        async () => !!vscodeNotebook.activeNotebookEditor?.kernel,
        60_000, // Validating kernel can take a while (this is required to ensure a kernel is available for use).
        'Timeout waiting for active kernel'
    );
    if (!vscodeNotebook.activeNotebookEditor || !vscodeNotebook.activeNotebookEditor.kernel) {
        throw new Error('No notebook or kernel');
    }
    vscodeNotebook.activeNotebookEditor.kernel.executeAllCells(vscodeNotebook.activeNotebookEditor.document);
}
export function createNotebookDocument(
    model: VSCodeNotebookModel,
    viewType: string = JupyterNotebookView
): NotebookDocument {
    const cells: NotebookCell[] = [];
    const doc: NotebookDocument = {
        cells,
        version: 1,
        fileName: model.file.fsPath,
        isDirty: false,
        languages: [],
        uri: model.file,
        isUntitled: false,
        viewType,
        contentOptions: {
            transientOutputs: false,
            transientMetadata: {
                breakpointMargin: true,
                editable: true,
                hasExecutionOrder: true,
                inputCollapsed: true,
                lastRunDuration: true,
                outputCollapsed: true,
                runStartTime: true,
                runnable: true,
                executionOrder: false,
                custom: false,
                runState: false,
                statusMessage: false
            }
        },
        metadata: {
            cellEditable: model.isTrusted,
            cellHasExecutionOrder: true,
            cellRunnable: model.isTrusted,
            editable: model.isTrusted,
            runnable: model.isTrusted
        }
    };
    model.getNotebookData().cells.forEach((cell, index) => {
        const vscDocumentCell: NotebookCell = {
            cellKind: cell.cellKind,
            language: cell.language,
            metadata: cell.metadata || {},
            uri: model.file.with({ fragment: `cell${index}` }),
            notebook: doc,
            index,
            document: instance(mock<TextDocument>()),
            outputs: cell.outputs
        };
        cells.push(vscDocumentCell);
    });
    model.associateNotebookDocument(doc);
    return doc;
}

/**
 * Ability to stub prompts for VS Code tests.
 * We can confirm prompt was displayed & invoke a button click.
 */
export async function hijackPrompt(
    promptType: 'showErrorMessage',
    message: { exactMatch: string } | { endsWith: string },
    buttonToClick?: { text?: string; clickImmediately?: boolean; dismissPrompt?: boolean },
    disposables: IDisposable[] = []
): Promise<{
    dispose: Function;
    displayed: Promise<boolean>;
    clickButton(text?: string): void;
    getDisplayCount(): number;
}> {
    const api = await initialize();
    const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
    const displayed = createDeferred<boolean>();
    const clickButton = createDeferred<string>();
    if (buttonToClick?.clickImmediately && buttonToClick.text) {
        clickButton.resolve(buttonToClick.text);
    }
    let displayCount = 0;
    // eslint-disable-next-line
    const stub = sinon.stub(appShell, promptType).callsFake(function (msg: string) {
        traceInfo(`Message displayed to user '${msg}', condition ${JSON.stringify(message)}`);
        if (
            ('exactMatch' in message && msg.trim() === message.exactMatch.trim()) ||
            ('endsWith' in message && msg.endsWith(message.endsWith))
        ) {
            traceInfo(`Exact Message found '${msg}'`);
            displayCount += 1;
            displayed.resolve(true);
            if (buttonToClick) {
                return buttonToClick.dismissPrompt ? undefined : clickButton.promise;
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (appShell[promptType] as any).wrappedMethod.apply(appShell, arguments);
    });
    const disposable = { dispose: () => stub.restore() };
    if (disposables) {
        disposables.push(disposable);
    }
    return {
        dispose: () => stub.restore(),
        getDisplayCount: () => displayCount,
        displayed: displayed.promise,
        clickButton: (text?: string) => clickButton.resolve(text || buttonToClick?.text)
    };
}
