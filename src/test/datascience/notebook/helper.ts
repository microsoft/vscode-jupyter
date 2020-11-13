// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// tslint:disable: no-var-requires no-require-imports no-invalid-this no-any

import { nbformat } from '@jupyterlab/coreutils';
import { assert, expect } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import * as tmp from 'tmp';
import { anything, instance, mock, when } from 'ts-mockito';
import { commands, Memento, TextDocument, Uri } from 'vscode';
import {
    CellDisplayOutput,
    NotebookCell,
    NotebookContentProvider as VSCNotebookContentProvider,
    NotebookDocument
} from '../../../../typings/vscode-proposed';
import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../../../client/common/application/types';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../client/common/constants';
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
import { JupyterNotebookView } from '../../../client/datascience/notebook/constants';
import {
    LastSavedNotebookCellLanguage,
    NotebookCellLanguageService
} from '../../../client/datascience/notebook/defaultCellLanguageService';
import { chainWithPendingUpdates } from '../../../client/datascience/notebook/helpers/notebookUpdater';
import { VSCodeNotebookKernelMetadata } from '../../../client/datascience/notebook/kernelProvider';
import { NotebookEditor } from '../../../client/datascience/notebook/notebookEditor';
import { INotebookContentProvider } from '../../../client/datascience/notebook/types';
import { VSCodeNotebookModel } from '../../../client/datascience/notebookStorage/vscNotebookModel';
import { INotebookEditorProvider, INotebookProvider, ITrustService } from '../../../client/datascience/types';
import { createEventHandler, sleep, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_SMOKE_TEST } from '../../constants';
import { closeActiveWindows, initialize, isInsiders } from '../../initialize';
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

async function getServices() {
    const api = await initialize();
    return {
        contentProvider: api.serviceContainer.get<VSCNotebookContentProvider>(INotebookContentProvider),
        vscodeNotebook: api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook),
        editorProvider: api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider),
        serviceContainer: api.serviceContainer
    };
}

export async function insertMarkdownCell(source: string) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor) {
        assert.fail('No active editor');
        return;
    }
    await chainWithPendingUpdates(activeEditor, (edit) =>
        edit.replaceCells(activeEditor.document.cells.length, 0, [
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
}
export async function insertCodeCell(source: string, options?: { language?: string; index?: number }) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor) {
        assert.fail('No active editor');
        return;
    }
    const startNumber = options?.index ?? activeEditor.document.cells.length;
    await activeEditor.edit((edit) => {
        edit.replaceCells(startNumber, 0, [
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
    });
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
    await chainWithPendingUpdates(activeEditor, (edit) => edit.replaceCells(index, 1, []));
}
export async function deleteAllCellsAndWait() {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor || activeEditor.document.cells.length === 0) {
        return;
    }
    await chainWithPendingUpdates(activeEditor, (edit) => edit.replaceCells(0, activeEditor.document.cells.length, []));
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
    const tempFile = tmp.tmpNameSync({ postfix: extension, dir: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'tmp') });
    await fs.copyFile(templateFile, tempFile);
    disposables.push({ dispose: () => swallowExceptions(() => fs.unlinkSync(tempFile)) });
    return tempFile;
}

export function disposeAllDisposables(disposables: IDisposable[]) {
    while (disposables.length) {
        disposables.pop()?.dispose(); // NOSONAR;
    }
}

export async function canRunNotebookTests() {
    if (!isInsiders() || !process.env.VSC_JUPYTER_RUN_NB_TEST) {
        return false;
    }
    const api = await initialize();
    const appEnv = api.serviceContainer.get<IApplicationEnvironment>(IApplicationEnvironment);
    return appEnv.extensionChannel !== 'stable';
}

export async function shutdownAllNotebooks() {
    const api = await initialize();
    const notebookProvider = api.serviceContainer.get<INotebookProvider>(INotebookProvider);
    await Promise.all(notebookProvider.activeNotebooks.map(async (item) => (await item).dispose()));
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

export async function waitForKernelToGetAutoSelected(expectedLanguage?: string) {
    const { vscodeNotebook } = await getServices();

    // Wait for the active kernel to be a julia kernel.
    await waitForCondition(
        async () => !!vscodeNotebook.activeNotebookEditor?.kernel,
        10_000,
        'Kernel not auto selected'
    );
    let kernelInfo = '';
    const isRightKernel = () => {
        if (!vscodeNotebook.activeNotebookEditor) {
            return false;
        }
        if (!vscodeNotebook.activeNotebookEditor.kernel) {
            return false;
        }
        if (!expectedLanguage) {
            kernelInfo = '<No specific kernel expected>';
            return true;
        }
        if (vscodeNotebook.activeNotebookEditor.kernel instanceof VSCodeNotebookKernelMetadata) {
            if (vscodeNotebook.activeNotebookEditor.kernel.selection.kind === 'startUsingKernelSpec') {
                kernelInfo = JSON.stringify(vscodeNotebook.activeNotebookEditor.kernel.selection.kernelSpec || {});
                return (
                    vscodeNotebook.activeNotebookEditor.kernel.selection.kernelSpec.language?.toLowerCase() ===
                    expectedLanguage.toLowerCase()
                );
            }
            if (vscodeNotebook.activeNotebookEditor.kernel.selection.kind === 'startUsingPythonInterpreter') {
                kernelInfo = `<startUsingPythonInterpreter ${vscodeNotebook.activeNotebookEditor.kernel.selection.interpreter.path}>`;
                return expectedLanguage.toLowerCase() === PYTHON_LANGUAGE.toLowerCase();
            }
            // We don't support testing other kernels, not required hence not added.
            // tslint:disable-next-line: no-console
            console.error('Testing other kernel connections not supported');
        }
        return false;
    };

    // Wait for the active kernel to be a julia kernel.
    const errorMessage = expectedLanguage ? `${expectedLanguage} kernel not auto selected` : 'Kernel not auto selected';
    await waitForCondition(async () => isRightKernel(), 15_000, errorMessage);
    console.info(`Preferred kernel auto selected for Native Notebook for ${kernelInfo}.`);
}
export async function trustNotebook(ipynbFile: string | Uri) {
    console.info(`Trusting Notebook ${ipynbFile}`);
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
export async function startJupyter(closeInitialEditor: boolean) {
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
        await executeActiveDocument();
        // Wait for Jupyter to start.
        await waitForExecutionCompletedSuccessfully(cell, 60_000);

        if (closeInitialEditor) {
            await closeActiveWindows();
        } else {
            await deleteCell(0);
        }
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
/**
 *  Wait for VSC to perform some last minute clean up of cells.
 * In tests we can end up deleting cells. However if extension is still dealing with the cells, we need to give it some time to finish.
 */
async function waitForCellExecutionToComplete(cell: NotebookCell) {
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
export async function waitForExecutionCompletedSuccessfully(cell: NotebookCell, timeout: number = 15_000) {
    await waitForCondition(
        async () => assertHasExecutionCompletedSuccessfully(cell),
        timeout,
        `Cell ${cell.index + 1} did not complete successfully`
    );
    await waitForCellExecutionToComplete(cell);
}
export async function waitForExecutionCompletedWithErrors(cell: NotebookCell, timeout: number = 15_000) {
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
    assert.ok(cellOutputs, 'No output');
    assert.equal(cellOutputs[index].outputKind, vscodeNotebookEnums.CellOutputKind.Rich, 'Incorrect output kind');
    const outputText = (cellOutputs[index] as CellDisplayOutput).data['text/plain'].trim();
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
    assert.equal(cellOutputs[index].outputKind, vscodeNotebookEnums.CellOutputKind.Rich, 'Incorrect output kind');
    const outputText = (cellOutputs[index] as CellDisplayOutput).data['text/plain'].trim();
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
        cell.outputs.filter((output) => output.outputKind === vscodeNotebookEnums.CellOutputKind.Error).length,
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
export async function executeCell(cell: NotebookCell) {
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
export async function executeActiveDocument() {
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
    promptType: 'showErrorMessage' | 'showWarningMessage',
    message: { exactMatch: string } | { endsWith: string },
    buttonToClick?: { text?: string; clickImmediately?: boolean },
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
    const stub = sinon.stub(appShell, promptType);
    // tslint:disable-next-line: no-function-expression
    (stub as any).callsFake(function (msg: string) {
        console.info(`Message displayed to user ${msg}.`);
        if (
            ('exactMatch' in message && msg === message.exactMatch) ||
            ('endsWith' in message && msg.endsWith(message.endsWith))
        ) {
            console.debug(`Exact Message found ${msg} with condition ${JSON.stringify(message)}`);
            displayCount += 1;
            displayed.resolve(true);
            if (buttonToClick) {
                return clickButton.promise;
            }
        }
        // tslint:disable-next-line: no-any
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
