// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */

import { assert, expect } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import * as tmp from 'tmp';
import {
    WorkspaceEdit,
    commands,
    Memento,
    Uri,
    window,
    workspace,
    NotebookCell,
    NotebookDocument,
    NotebookCellKind,
    NotebookCellOutputItem,
    NotebookRange,
    NotebookCellExecutionState,
    NotebookCellData,
    notebooks,
    Event,
    env,
    UIKind,
    DebugSession,
    languages,
    Position,
    Hover,
    Diagnostic
} from 'vscode';
import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../../../client/common/application/types';
import { JVSC_EXTENSION_ID, MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../client/common/constants';
import { disposeAllDisposables } from '../../../client/common/helpers';
import { traceInfo, traceInfoIfCI } from '../../../client/common/logger';
import { GLOBAL_MEMENTO, IDisposable, IMemento } from '../../../client/common/types';
import { createDeferred } from '../../../client/common/utils/async';
import { swallowExceptions } from '../../../client/common/utils/misc';
import { IKernelProvider } from '../../../client/datascience/jupyter/kernels/types';
import { JupyterServerSelector } from '../../../client/datascience/jupyter/serverSelector';
import {
    getTextOutputValue,
    hasErrorOutput,
    NotebookCellStateTracker
} from '../../../client/datascience/notebook/helpers/helpers';
import { LastSavedNotebookCellLanguage } from '../../../client/datascience/notebook/cellLanguageService';
import { chainWithPendingUpdates } from '../../../client/datascience/notebook/helpers/notebookUpdater';
import { CellOutputMimeTypes, INotebookControllerManager } from '../../../client/datascience/notebook/types';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { IExtensionTestApi, sleep, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST, IS_SMOKE_TEST } from '../../constants';
import { noop } from '../../core';
import { closeActiveWindows, initialize, isInsiders } from '../../initialize';
import { JupyterServer } from '../jupyterServer';
import { VSCodeNotebookController } from '../../../client/datascience/notebook/vscodeNotebookController';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IDebuggingManager, IKernelDebugAdapter } from '../../../client/debugger/types';
import { DataScience } from '../../../client/common/utils/localize';

// Running in Conda environments, things can be a little slower.
export const defaultNotebookTestTimeout = 60_000;

async function getServices() {
    const api = await initialize();
    return {
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
    await chainWithPendingUpdates(activeEditor.document, (edit) => {
        const cellData = new NotebookCellData(NotebookCellKind.Markup, source, MARKDOWN_LANGUAGE);
        cellData.outputs = [];
        cellData.metadata = {};
        edit.replaceNotebookCells(activeEditor.document.uri, new NotebookRange(startNumber, startNumber), [cellData]);
    });
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
    const cellData = new NotebookCellData(NotebookCellKind.Code, source, options?.language || PYTHON_LANGUAGE);
    cellData.outputs = [];
    cellData.metadata = {};
    edit.replaceNotebookCells(activeEditor.document.uri, new NotebookRange(startNumber, startNumber), [cellData]);
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

export async function canRunNotebookTests() {
    if (!isInsiders() && !process.env.VSC_JUPYTER_RUN_NB_TEST) {
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
    const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
    await Promise.all(kernelProvider.kernels.map((k) => k.dispose().catch(noop)));
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
export async function closeNotebooksAndCleanUpAfterTests(disposables: IDisposable[] = []) {
    if (!IS_SMOKE_TEST) {
        // When running smoke tests, we won't have access to these.
        const configSettings = await import('../../../client/common/configSettings');
        // Dispose any cached python settings (used only in test env).
        configSettings.JupyterSettings.dispose();
    }
    VSCodeNotebookController.kernelAssociatedWithDocument = undefined;
    await closeActiveWindows();
    disposeAllDisposables(disposables);
    await shutdownAllNotebooks();
    await ensureNewNotebooksHavePythonCells();
    sinon.restore();
}

export async function closeNotebooks(disposables: IDisposable[] = []) {
    if (!isInsiders()) {
        return false;
    }
    VSCodeNotebookController.kernelAssociatedWithDocument = undefined;
    await closeActiveWindows();
    disposeAllDisposables(disposables);
}

let waitForKernelPendingPromise: Promise<void> | undefined;

export async function waitForKernelToChange(
    criteria: { labelOrId?: string; interpreterPath?: string },
    timeout = defaultNotebookTestTimeout
) {
    // Wait for the previous kernel change to finish.
    if (waitForKernelPendingPromise != undefined) {
        await waitForKernelPendingPromise;
    }
    waitForKernelPendingPromise = waitForKernelToChangeImpl(criteria, timeout);
    return waitForKernelPendingPromise;
}

async function waitForKernelToChangeImpl(
    criteria: { labelOrId?: string; interpreterPath?: string },
    timeout = defaultNotebookTestTimeout
) {
    const { vscodeNotebook, notebookControllerManager } = await getServices();

    // Wait for the active editor to come up
    if (!vscodeNotebook.activeNotebookEditor) {
        await waitForCondition(
            async () => !!vscodeNotebook.activeNotebookEditor,
            10_000,
            'Active editor not a notebook'
        );
    }

    // Get the list of NotebookControllers for this document
    await notebookControllerManager.loadNotebookControllers();
    const notebookControllers = notebookControllerManager.registeredNotebookControllers();

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
    const isRightKernel = () => {
        const doc = vscodeNotebook.activeNotebookEditor?.document;
        if (!doc) {
            return false;
        }

        const selectedController = notebookControllerManager.getSelectedNotebookController(doc);
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
    if (!isRightKernel()) {
        let tryCount = 0;
        await waitForCondition(
            async () => {
                // Double check not the right kernel (don't select again if already found to be correct)
                if (!isRightKernel()) {
                    traceInfoIfCI(`Notebook select.kernel command switching to kernel id ${id}: Try ${tryCount}`);
                    // Send a select kernel on the active notebook editor. Keep sending it if it fails.
                    await commands.executeCommand('notebook.selectKernel', { id, extension: JVSC_EXTENSION_ID });
                    traceInfoIfCI(`Notebook select.kernel command switched to kernel id ${id}`);
                    tryCount += 1;
                }

                // Check if it's the right one or not.
                return isRightKernel();
            },
            timeout,
            `Kernel with criteria ${JSON.stringify(criteria)} not selected`
        );
        // Make sure the kernel is actually in use before returning (switching is async)
        await sleep(500);
    }
}

export async function waitForKernelToGetAutoSelected(expectedLanguage?: string, timeout = 100_000) {
    const { vscodeNotebook, notebookControllerManager } = await getServices();

    // Wait for the active editor to come up
    if (!vscodeNotebook.activeNotebookEditor) {
        await waitForCondition(
            async () => !!vscodeNotebook.activeNotebookEditor,
            10_000,
            'Active editor not a notebook'
        );
    }

    // Get the list of NotebookControllers for this document
    await notebookControllerManager.loadNotebookControllers();
    const notebookControllers = notebookControllerManager.registeredNotebookControllers();

    // Make sure we don't already have a selection (this function gets run even after opening a document)
    if (notebookControllerManager.getSelectedNotebookController(vscodeNotebook.activeNotebookEditor!.document)) {
        return;
    }

    // We don't have one, try to find the preferred one
    let preferred: VSCodeNotebookController | undefined;

    // Wait for one of them to have affinity as the preferred (this may not happen)
    try {
        await waitForCondition(
            async () => {
                preferred = notebookControllerManager.getPreferredNotebookController(
                    vscodeNotebook.activeNotebookEditor!.document
                );
                return preferred != undefined;
            },
            3_000,
            `Did not find a controller with document affinity`
        );
    } catch {
        // Do nothing for now. Just log it
        traceInfoIfCI(`No preferred controller found during waitForKernelToGetAutoSelected`);
    }

    // Find one that matches the expected language or the preferred
    const expectedLower = expectedLanguage?.toLowerCase();
    const language = expectedLower || 'python';
    const match =
        (preferred &&
            preferred.connection.kind !== 'connectToLiveKernel' &&
            (!expectedLanguage || preferred.connection.kernelSpec?.language?.toLowerCase() === expectedLower)) ||
        preferred?.connection.kind === 'connectToLiveKernel'
            ? preferred
            : notebookControllers.find(
                  (d) =>
                      d.connection.kind != 'connectToLiveKernel' &&
                      language === d.connection.kernelSpec?.language?.toLowerCase()
              );

    assert.ok(match, 'No kernel to auto select');
    return waitForKernelToChange({ labelOrId: match!.id }, timeout);
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
    await waitForKernelToGetAutoSelected();
    await deleteAllCellsAndWait();
}

export async function stopJupyterServer() {
    if (!IS_REMOTE_NATIVE_TEST) {
        return;
    }
    await JupyterServer.instance.dispose().catch(noop);
}

let workedAroundVSCodeNotebookStartPage = false;
/**
 * VS Code displays a start page when opening notebooks for the first time.
 * This takes focus from the notebook, hence our tests can fail as a result of this.
 * Solution, try to trigger the display of the start page displayed before starting the tests.
 */
export async function workAroundVSCodeNotebookStartPages() {
    if (workedAroundVSCodeNotebookStartPage) {
        return;
    }
    workedAroundVSCodeNotebookStartPage = true;
    const { editorProvider } = await getServices();
    await closeActiveWindows();

    // Open a notebook, VS Code will open the start page (wait for 5s for VSCode to react & open it)
    await editorProvider.createNew();
    await sleep(5_000);
    await closeActiveWindows();
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
        traceInfoIfCI(`Running all cells in prewarm notebooks`);
        await Promise.all([waitForExecutionCompletedSuccessfully(cell, 60_000), runAllCellsInActiveNotebook()]);
        // Wait for Jupyter to start.
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
    // if (!CellExecution.cellsCompletedForTesting.has(cell)) {
    //     CellExecution.cellsCompletedForTesting.set(cell, createDeferred<void>());
    // }
    // // Yes hacky approach, however its difficult to synchronize everything as we update cells in a few places while executing.
    // // 100ms should be plenty sufficient for other code to get executed when dealing with cells.
    // // Again, we need to wait for rest of execution code to access the cells.
    // // Else in tests we'd delete the cells & the extension code could fall over trying to access non-existent cells.
    // // In fact code doesn't fall over, but VS Code just hangs in tests.
    // // If this doesn't work on CI, we'll need to clean up and write more code to ensure we remove these race conditions as done with `CellExecution.cellsCompleted`.
    // await CellExecution.cellsCompletedForTesting.get(cell)!.promise;
    await waitForCondition(
        async () => (cell.executionSummary?.executionOrder || 0) > 0,
        defaultNotebookTestTimeout,
        'Execution did not complete'
    );
    await sleep(100);
}
export async function waitForCellExecutionState(
    cell: NotebookCell,
    state: NotebookCellExecutionState,
    disposables: IDisposable[],
    timeout: number = defaultNotebookTestTimeout
) {
    const deferred = createDeferred<boolean>();
    const disposable = notebooks.onDidChangeNotebookCellExecutionState((e) => {
        if (e.cell !== cell) {
            return;
        }
        if (e.state === state) {
            deferred.resolve(true);
        }
    });
    disposables.push(disposable);
    try {
        await waitForCondition(async () => deferred.promise, timeout, `Execution state did not change to ${state}`);
    } finally {
        disposable.dispose();
    }
}
export async function waitForOutputs(
    cell: NotebookCell,
    expectedNumberOfOutputs: number,
    timeout: number = defaultNotebookTestTimeout
) {
    await waitForCondition(
        async () => cell.outputs.length === expectedNumberOfOutputs,
        timeout,
        () =>
            `Cell ${cell.index + 1} did not complete successfully, State = ${NotebookCellStateTracker.getCellState(
                cell
            )}`
    );
}
export async function waitForExecutionCompletedSuccessfully(
    cell: NotebookCell,
    timeout: number = defaultNotebookTestTimeout
) {
    await Promise.all([
        waitForCondition(
            async () => assertHasExecutionCompletedSuccessfully(cell),
            timeout,
            () =>
                `Cell ${cell.index + 1} did not complete successfully, State = ${NotebookCellStateTracker.getCellState(
                    cell
                )}`
        ),
        waitForCellExecutionToComplete(cell)
    ]);
}
/**
 * When a cell is running (in progress), the start time will be > 0.
 */
export async function waitForExecutionInProgress(cell: NotebookCell, timeout: number = defaultNotebookTestTimeout) {
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
export async function waitForQueuedForExecution(cell: NotebookCell, timeout: number = defaultNotebookTestTimeout) {
    await waitForCondition(
        async () => {
            return NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Pending;
        },
        timeout,
        () =>
            `Cell ${cell.index + 1} not queued for execution, current state is ${NotebookCellStateTracker.getCellState(
                cell
            )}`
    );
}
export async function waitForQueuedForExecutionOrExecuting(
    cell: NotebookCell,
    timeout: number = defaultNotebookTestTimeout
) {
    await waitForCondition(
        async () => {
            return (
                NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Pending ||
                NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Executing
            );
        },
        timeout,
        () =>
            `Cell ${
                cell.index + 1
            } not queued for execution nor already executing, current state is ${NotebookCellStateTracker.getCellState(
                cell
            )}`
    );
}
export async function waitForEmptyCellExecutionCompleted(
    cell: NotebookCell,
    timeout: number = defaultNotebookTestTimeout
) {
    await waitForCondition(
        async () => assertHasEmptyCellExecutionCompleted(cell),
        timeout,
        () =>
            `Cell ${
                cell.index + 1
            } did not complete (this is an empty cell), State = ${NotebookCellStateTracker.getCellState(cell)}`
    );
    await waitForCellExecutionToComplete(cell);
}
export async function waitForExecutionCompletedWithErrors(
    cell: NotebookCell,
    timeout: number = defaultNotebookTestTimeout
) {
    await waitForCondition(
        async () => assertHasExecutionCompletedWithErrors(cell),
        timeout,
        () => `Cell ${cell.index + 1} did not fail as expected, State =  ${NotebookCellStateTracker.getCellState(cell)}`
    );
    await waitForCellExecutionToComplete(cell);
}

export async function waitForDiagnostics(
    uri: Uri,
    timeout: number = defaultNotebookTestTimeout
): Promise<Diagnostic[]> {
    let diagnostics: Diagnostic[] = [];
    await waitForCondition(
        async () => {
            diagnostics = languages.getDiagnostics(uri);
            if (diagnostics && diagnostics.length) {
                return true;
            }
            return false;
        },
        timeout,
        `No diagnostics found for ${uri}`,
        250
    );
    return diagnostics;
}

export async function waitForHover(
    uri: Uri,
    pos: Position,
    timeout: number = defaultNotebookTestTimeout
): Promise<Hover[]> {
    let hovers: Hover[] = [];
    await waitForCondition(
        async () => {
            // Use a command to get back the list of hovers
            hovers = (await commands.executeCommand('vscode.executeHoverProvider', uri, pos)) as Hover[];
            if (hovers && hovers.length) {
                return true;
            }
            return false;
        },
        timeout,
        `No hovers found for ${uri}`,
        250
    );
    return hovers;
}

function assertHasExecutionCompletedWithErrors(cell: NotebookCell) {
    return (
        (cell.executionSummary?.executionOrder ?? 0) > 0 &&
        NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Idle &&
        hasErrorOutput(cell.outputs)
    );
}
export function getCellOutputs(cell: NotebookCell) {
    return cell.outputs.length
        ? cell.outputs.map((output) => output.items.map(getOutputText).join('\n')).join('\n')
        : '<No cell outputs>';
}
function getOutputText(output: NotebookCellOutputItem) {
    if (
        output.mime !== CellOutputMimeTypes.stdout &&
        output.mime !== CellOutputMimeTypes.stderr &&
        output.mime !== 'text/plain' &&
        output.mime !== 'text/markdown'
    ) {
        return '';
    }
    return Buffer.from(output.data).toString('utf8');
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
    try {
        const haystack = Buffer.from(output.data).toString('utf8');
        return isExactMatch
            ? haystack === value || haystack.trim() === value
            : haystack.toLowerCase().includes(value.toLowerCase());
    } catch {
        return false;
    }
}
export function assertHasTextOutputInVSCode(cell: NotebookCell, text: string, index: number = 0, isExactMatch = true) {
    const cellOutputs = cell.outputs;
    assert.ok(cellOutputs.length, 'No output');
    const result = cell.outputs[index].items.some((item) => hasTextOutputValue(item, text, isExactMatch));
    assert.isTrue(
        result,
        `${text} not found in outputs of cell ${cell.index} ${cell.outputs[index].items
            .map((o) => (o.data ? Buffer.from(o.data).toString('utf8') : ''))
            .join(' ')}`
    );
    return result;
}
export async function waitForTextOutput(
    cell: NotebookCell,
    text: string,
    index: number = 0,
    isExactMatch = true,
    timeout = defaultNotebookTestTimeout
) {
    await waitForCondition(
        async () => assertHasTextOutputInVSCode(cell, text, index, isExactMatch),
        timeout,
        () =>
            `Output does not contain provided text '${text}' for Cell ${cell.index + 1}, it is ${getCellOutputs(cell)}`
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

export async function saveActiveNotebook() {
    await commands.executeCommand('workbench.action.files.saveAll');
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

export async function asPromise<T>(
    event: Event<T>,
    predicate?: (value: T) => boolean,
    timeout = env.uiKind === UIKind.Desktop ? 5000 : 15000
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const handle = setTimeout(() => {
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            sub.dispose();
            reject(new Error('asPromise TIMEOUT reached'));
        }, timeout);
        const sub = event((e) => {
            if (!predicate || predicate(e)) {
                clearTimeout(handle);
                sub.dispose();
                resolve(e);
            }
        });
    });
}

export async function waitForDebugEvent<T>(
    eventType: string,
    debugAdapter: IKernelDebugAdapter,
    timeout = env.uiKind === UIKind.Desktop ? 5000 : 15000
): Promise<T> {
    return asPromise(
        debugAdapter.onDidSendMessage,
        (message) => (message as DebugProtocol.Event).event === eventType,
        timeout
    ) as Promise<T>;
}

export async function waitForStoppedEvent(debugAdapter: IKernelDebugAdapter): Promise<DebugProtocol.StoppedEvent> {
    return waitForDebugEvent('stopped', debugAdapter, 10_000);
}

export async function getDebugSessionAndAdapter(
    debuggingManager: IDebuggingManager,
    doc: NotebookDocument
): Promise<{ session: DebugSession; debugAdapter: IKernelDebugAdapter }> {
    await waitForCondition(
        async () => !!debuggingManager.getDebugSession(doc),
        defaultNotebookTestTimeout,
        'DebugSession should start'
    );
    const session = await debuggingManager.getDebugSession(doc)!;

    const debugAdapter = debuggingManager.getDebugAdapter(doc)!;
    assert.isOk<IKernelDebugAdapter | undefined>(debugAdapter, 'DebugAdapter not started');

    return { session, debugAdapter };
}

export async function clickOKForRestartPrompt() {
    const api = await initialize();
    // Ensure we click `Yes` when prompted to restart the kernel.
    const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
    const showInformationMessage = sinon.stub(appShell, 'showInformationMessage').callsFake(function (message: string) {
        traceInfo(`Step 2. ShowInformationMessage ${message}`);
        if (message === DataScience.restartKernelMessage()) {
            traceInfo(`Step 3. ShowInformationMessage & yes to restart`);
            // User clicked ok to restart it.
            return DataScience.restartKernelMessageYes();
        }
        return (appShell.showInformationMessage as any).wrappedMethod.apply(appShell, arguments);
    });
    return { dispose: () => showInformationMessage.restore() };
}
