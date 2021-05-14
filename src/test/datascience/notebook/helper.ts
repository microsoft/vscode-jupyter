// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */

import { nbformat } from '@jupyterlab/coreutils';
import { assert, expect } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import * as tmp from 'tmp';
import { instance, mock, when } from 'ts-mockito';
import {
    WorkspaceEdit,
    commands,
    Memento,
    Uri,
    window,
    workspace,
    NotebookCell,
    NotebookContentProvider as VSCNotebookContentProvider,
    NotebookDocument,
    NotebookCellKind,
    NotebookCellMetadata,
    NotebookCellOutputItem,
    NotebookRange,
    NotebookCellExecutionState,
    NotebookCellData
} from 'vscode';
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
import {
    getTextOutputValue,
    hasErrorOutput,
    NotebookCellStateTracker
} from '../../../client/datascience/notebook/helpers/helpers';
import { LastSavedNotebookCellLanguage } from '../../../client/datascience/notebook/defaultCellLanguageService';
import { chainWithPendingUpdates } from '../../../client/datascience/notebook/helpers/notebookUpdater';
import { NotebookEditor } from '../../../client/datascience/notebook/notebookEditor';
import {
    CellOutputMimeTypes,
    INotebookContentProvider,
    INotebookControllerManager
} from '../../../client/datascience/notebook/types';
import { VSCodeNotebookModel } from '../../../client/datascience/notebookStorage/vscNotebookModel';
import { INotebookEditorProvider, INotebookProvider, ITrustService } from '../../../client/datascience/types';
import { createEventHandler, IExtensionTestApi, sleep, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_CONDA_TEST, IS_REMOTE_NATIVE_TEST, IS_SMOKE_TEST } from '../../constants';
import { noop } from '../../core';
import { closeActiveWindows, initialize, isInsiders } from '../../initialize';
import { JupyterServer } from '../jupyterServer';
import { NotebookEditorProvider } from '../../../client/datascience/notebook/notebookEditorProvider';
import { VSCodeNotebookProvider } from '../../../client/datascience/constants';
import { VSCodeNotebookController } from '../../../client/datascience/notebook/vscodeNotebookController';

// Running in Conda environments, things can be a little slower.
const defaultTimeout = IS_CONDA_TEST ? 30_000 : 15_000;

async function getServices() {
    const api = await initialize();
    return {
        contentProvider: api.serviceContainer.get<VSCNotebookContentProvider>(INotebookContentProvider),
        vscodeNotebook: api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook),
        editorProvider: api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider),
        notebookControllerManager: api.serviceContainer.get<INotebookControllerManager>(INotebookControllerManager),
        serviceContainer: api.serviceContainer
    };
}

export async function selectCell(notebook: NotebookDocument, start: number, end: number) {
    await window.showNotebookDocument(notebook, {
        selections: [new NotebookRange(start, end)]
    });
}

export async function insertMarkdownCell(source: string, options?: { index?: number }) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor) {
        throw new Error('No active editor');
    }
    const startNumber = options?.index ?? activeEditor.document.cellCount;
    await chainWithPendingUpdates(activeEditor.document, (edit) =>
        edit.replaceNotebookCells(activeEditor.document.uri, new NotebookRange(startNumber, startNumber), [
            new NotebookCellData(NotebookCellKind.Markup, source, MARKDOWN_LANGUAGE, [], new NotebookCellMetadata())
        ])
    );
    return activeEditor.document.cellAt(startNumber)!;
}
export async function insertCodeCell(source: string, options?: { language?: string; index?: number }) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor) {
        throw new Error('No active editor');
    }
    const startNumber = options?.index ?? activeEditor.document.cellCount;
    const edit = new WorkspaceEdit();
    edit.replaceNotebookCells(activeEditor.document.uri, new NotebookRange(startNumber, startNumber), [
        new NotebookCellData(
            NotebookCellKind.Code,
            source,
            options?.language || PYTHON_LANGUAGE,
            [],
            new NotebookCellMetadata()
        )
    ]);
    await workspace.applyEdit(edit);

    return activeEditor.document.cellAt(startNumber)!;
}
export async function deleteCell(index: number = 0) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor || activeEditor.document.cellCount === 0) {
        return;
    }
    if (!activeEditor) {
        assert.fail('No active editor');
        return;
    }
    await chainWithPendingUpdates(activeEditor.document, (edit) =>
        edit.replaceNotebookCells(activeEditor.document.uri, new NotebookRange(index, index + 1), [])
    );
}
export async function deleteAllCellsAndWait() {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor || activeEditor.document.cellCount === 0) {
        return;
    }
    await chainWithPendingUpdates(activeEditor.document, (edit) =>
        edit.replaceNotebookCells(activeEditor.document.uri, new NotebookRange(0, activeEditor.document.cellCount), [])
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

export async function canRunNotebookTests() {
    if (
        //isInsiders() ||
        !process.env.VSC_JUPYTER_RUN_NB_TEST
    ) {
        console.log(
            `Can't run native nb tests isInsiders() = ${isInsiders()}, process.env.VSC_JUPYTER_RUN_NB_TEST = ${
                process.env.VSC_JUPYTER_RUN_NB_TEST
            }`
        );
        return false;
    }
    const api = await initialize();
    const appEnv = api.serviceContainer.get<IApplicationEnvironment>(IApplicationEnvironment);
    const canRunTests = appEnv.channel === 'insiders';
    if (!canRunTests) {
        console.log(`Can't run native nb tests appEnv.channel = ${appEnv.channel}`);
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
    const notebookEditorProvider = api.serviceContainer.get<NotebookEditorProvider>(VSCodeNotebookProvider);
    notebookEditorProvider.dispose();
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
    const { vscodeNotebook, notebookControllerManager } = await getServices();

    // Wait for the active editor to come up
    await waitForCondition(async () => !!vscodeNotebook.activeNotebookEditor, 10_000, 'Active editor not a notebook');

    // Wait for the notebookControllerManager to have results for this given document
    await waitForKernelToGetAutoSelected(undefined, 10_000);

    // Get the list of NotebookControllers for this document
    const notebookControllers = await notebookControllerManager.getNotebookControllers();

    // Get the list of kernels possible
    traceInfo(`Controllers found for wait search: ${notebookControllers?.map((k) => `${k.label}:${k.id}`).join('\n')}`);

    // Find the kernel id that matches the name we want
    let id: string | undefined;
    if (criteria.labelOrId) {
        const labelOrId = criteria.labelOrId;
        id = notebookControllers?.find((k) => (labelOrId && k.label === labelOrId) || (k.id && k.id == labelOrId))?.id;
        if (!id) {
            // Try includes instead
            id = notebookControllers?.find(
                (k) => (labelOrId && k.label.includes(labelOrId)) || (k.id && k.id == labelOrId)
            )?.id;
        }
    }
    if (criteria.interpreterPath && !id) {
        id = notebookControllers
            ?.filter((k) => k.connection.interpreter)
            .find((k) => k.connection.interpreter!.path.toLowerCase().includes(criteria.interpreterPath!.toLowerCase()))
            ?.id;
    }
    traceInfo(`Switching to kernel id ${id}`);
    // Send a select kernel on the active notebook editor
    void commands.executeCommand('notebook.selectKernel', { id, extension: JVSC_EXTENSION_ID });
    const isRightKernel = () => {
        if (!vscodeNotebook.activeNotebookEditor) {
            return false;
        }

        const selectedController = notebookControllerManager.getSelectedNotebookController(
            vscodeNotebook.activeNotebookEditor.document
        );
        if (!selectedController) {
            return false;
        }
        if (selectedController.id === id) {
            traceInfo(`Found selected kernel id:label ${selectedController.id}:${selectedController.label}`);
            return true;
        }
        traceInfo(`Active kernel is id:label = ${selectedController.id}:${selectedController.label}`);
        return false;
    };
    await waitForCondition(
        async () => isRightKernel(),
        defaultTimeout,
        `Kernel with criteria ${JSON.stringify(criteria)} not selected`
    );

    // Make sure the kernel is actually in use before returning (switching is async)
    await sleep(500);
}

export async function waitForKernelToGetAutoSelected(expectedLanguage?: string, time = 100_000) {
    const { vscodeNotebook, notebookControllerManager } = await getServices();
    // Wait for the active kernel to be a julia kernel.
    // await waitForCondition(async () => !!vscodeNotebook.activeNotebookEditor?.kernel, time, 'Kernel not auto selected');

    // Wait for the notebookControllerManager to have results for this given document
    let selectedController: VSCodeNotebookController;
    await waitForCondition(
        async () => {
            const controller = notebookControllerManager.getSelectedNotebookController(
                vscodeNotebook.activeNotebookEditor?.document!
            );
            if (controller) {
                selectedController = controller;
            }
            return controller !== undefined;
        },
        time,
        'Failed to set notebook controllers'
    );
    let kernelInfo = '';
    const isRightKernel = () => {
        if (!vscodeNotebook.activeNotebookEditor || !vscodeNotebook.activeNotebookEditor.document) {
            return false;
        }

        traceInfo(`Waiting for kernel and active is ${selectedController.label}`);
        if (!expectedLanguage) {
            kernelInfo = `<No specific kernel expected> ${JSON.stringify(selectedController.connection)}`;
            return true;
        }
        switch (selectedController.connection.kind) {
            case 'startUsingDefaultKernel':
            case 'startUsingKernelSpec':
                kernelInfo = `<startUsingKernelSpec>${JSON.stringify(selectedController.connection.kernelSpec || {})}`;
                return (
                    selectedController.connection.kernelSpec?.language?.toLowerCase() === expectedLanguage.toLowerCase()
                );
            case 'startUsingPythonInterpreter':
                kernelInfo = `<startUsingPythonInterpreter ${selectedController.connection.interpreter.path}>`;
                return expectedLanguage.toLowerCase() === PYTHON_LANGUAGE.toLowerCase();
            case 'connectToLiveKernel':
                kernelInfo = `<connectToLiveKernel id: ${selectedController.connection.kernelModel.id}, name: ${selectedController.connection.kernelModel.id}>`;
                return true;
            default:
                // We don't support testing other kernels, not required hence not added.
                // eslint-disable-next-line no-console
                throw new Error('Testing other kernel connections not supported');
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
    // If it works, make sure kernel has enough time to actually switch the active notebook to this
    // kernel (kernel changes are async)
    await sleep(500);
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
        const cell = vscodeNotebook.activeNotebookEditor!.document.cellAt(0)!;
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
        (cell.executionSummary?.executionOrder ?? 0) > 0 &&
        NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Idle &&
        !hasErrorOutput(cell.outputs)
    );
}
function assertHasEmptyCellExecutionCompleted(cell: NotebookCell) {
    return (
        (cell.executionSummary?.executionOrder ?? 0) === 0 &&
        NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Idle
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
        `Cell ${cell.index + 1} did not complete successfully, State = ${NotebookCellStateTracker.getCellState(cell)}`
    );
    await waitForCellExecutionToComplete(cell);
}
/**
 * When a cell is running (in progress), the start time will be > 0.
 */
export async function waitForExecutionInProgress(cell: NotebookCell, timeout: number = defaultTimeout) {
    await waitForCondition(
        async () => {
            return (
                NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Executing &&
                (cell.executionSummary?.executionOrder || 0) > 0 // If execution count > 0, then jupyter has started running this cell.
            );
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
        async () => {
            return NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Pending;
        },
        timeout,
        `Cell ${cell.index + 1} not queued for execution, current state is ${NotebookCellStateTracker.getCellState(
            cell
        )}`
    );
}
export async function waitForQueuedForExecutionOrExecuting(cell: NotebookCell, timeout: number = defaultTimeout) {
    await waitForCondition(
        async () => {
            return (
                NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Pending ||
                NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Executing
            );
        },
        timeout,
        `Cell ${
            cell.index + 1
        } not queued for execution nor already executing, current state is ${NotebookCellStateTracker.getCellState(
            cell
        )}`
    );
}
export async function waitForEmptyCellExecutionCompleted(cell: NotebookCell, timeout: number = defaultTimeout) {
    await waitForCondition(
        async () => assertHasEmptyCellExecutionCompleted(cell),
        timeout,
        `Cell ${
            cell.index + 1
        } did not complete (this is an empty cell), State = ${NotebookCellStateTracker.getCellState(cell)}`
    );
    await waitForCellExecutionToComplete(cell);
}
export async function waitForExecutionCompletedWithErrors(cell: NotebookCell, timeout: number = defaultTimeout) {
    await waitForCondition(
        async () => assertHasExecutionCompletedWithErrors(cell),
        timeout,
        `Cell ${cell.index + 1} did not fail as expected, State =  ${NotebookCellStateTracker.getCellState(cell)}`
    );
    await waitForCellExecutionToComplete(cell);
}
function assertHasExecutionCompletedWithErrors(cell: NotebookCell) {
    return (
        (cell.executionSummary?.executionOrder ?? 0) > 0 &&
        NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Idle &&
        hasErrorOutput(cell.outputs)
    );
}
function hasTextOutputValue(output: NotebookCellOutputItem, value: string, isExactMatch = true) {
    if (
        output.mime !== CellOutputMimeTypes.stdout &&
        output.mime !== CellOutputMimeTypes.stderr &&
        output.mime !== 'text/plain' &&
        output.mime !== 'text/markdown'
    ) {
        return false;
    }
    const haystack = ((output.value || '') as string).toString().trim();
    return isExactMatch ? haystack === value : haystack.includes(value);
}
export function assertHasTextOutputInVSCode(cell: NotebookCell, text: string, index: number = 0, isExactMatch = true) {
    const cellOutputs = cell.outputs;
    assert.ok(cellOutputs.length, 'No output');
    const result = cell.outputs[index].outputs.some((item) => hasTextOutputValue(item, text, isExactMatch));
    assert.isTrue(
        result,
        `${text} not found in outputs of cell ${cell.index} ${cell.outputs[index].outputs
            .map((o) => o.value)
            .join(' ')}`
    );
    return result;
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
    const outputText = getTextOutputValue(cellOutputs[index]).trim();
    if (isExactMatch) {
        assert.notEqual(outputText, text, 'Incorrect output');
    } else {
        expect(outputText).to.not.include(text, 'Output does not contain provided text');
    }
    return true;
}
export function assertVSCCellIsRunning(cell: NotebookCell) {
    assert.equal(NotebookCellStateTracker.getCellState(cell), NotebookCellExecutionState.Executing);
    // If execution count > 0, then jupyter has started running this cell.
    assert.isAtLeast(cell.executionSummary?.executionOrder || 0, 1);
    return true;
}
export function assertVSCCellIsNotRunning(cell: NotebookCell) {
    assert.notEqual(NotebookCellStateTracker.getCellState(cell), NotebookCellExecutionState.Executing);
    return true;
}
export function assertVSCCellStateIsUndefinedOrIdle(cell: NotebookCell) {
    if (NotebookCellStateTracker.getCellState(cell) === undefined) {
        return true;
    }
    assert.equal(NotebookCellStateTracker.getCellState(cell), NotebookCellExecutionState.Idle);
    return true;
}
export function assertVSCCellHasErrorOutput(cell: NotebookCell) {
    assert.isTrue(hasErrorOutput(cell.outputs), 'No error output in cell');
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

    return new VSCodeNotebookModel(
        trusted,
        uri,
        globalMemento,
        crypto,
        nbJson,
        ' ',
        3,
        instance(mockVSC),
        nb?.metadata?.language_info?.name || PYTHON_LANGUAGE
    );
}
export async function runCell(cell: NotebookCell) {
    const api = await initialize();
    const vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    await waitForKernelToGetAutoSelected(undefined, 60_000);
    if (!vscodeNotebook.activeNotebookEditor || !vscodeNotebook.activeNotebookEditor.document) {
        throw new Error('No notebook or document');
    }

    void commands.executeCommand(
        'notebook.cell.execute',
        { start: cell.index, end: cell.index + 1 },
        vscodeNotebook.activeNotebookEditor.document.uri
    );
}
export async function runAllCellsInActiveNotebook() {
    const api = await initialize();
    const vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    await waitForKernelToGetAutoSelected(undefined, 60_000);

    if (!vscodeNotebook.activeNotebookEditor || !vscodeNotebook.activeNotebookEditor.document) {
        throw new Error('No editor or document');
    }

    void commands.executeCommand('notebook.execute', vscodeNotebook.activeNotebookEditor.document.uri);
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
