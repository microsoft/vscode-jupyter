// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */

import type * as nbformat from '@jupyterlab/nbformat';
import { assert, expect } from 'chai';
import * as sinon from 'sinon';
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
    Diagnostic,
    NotebookEdit,
    CompletionContext,
    CompletionTriggerKind,
    CancellationTokenSource,
    CompletionItem,
    QuickPick,
    QuickPickItem,
    QuickInputButton,
    QuickPickItemButtonEvent,
    EventEmitter,
    ConfigurationTarget,
    NotebookEditor,
    debug
} from 'vscode';
import { IApplicationShell, IVSCodeNotebook, IWorkspaceService } from '../../../platform/common/application/types';
import { JVSC_EXTENSION_ID, MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { traceInfo, traceInfoIfCI } from '../../../platform/logging';
import {
    GLOBAL_MEMENTO,
    IConfigurationService,
    IDisposable,
    IMemento,
    IsWebExtension
} from '../../../platform/common/types';
import { createDeferred, sleep } from '../../../platform/common/utils/async';
import { IKernelProvider } from '../../../kernels/types';
import { noop } from '../../core';
import { closeActiveWindows, isInsiders } from '../../initialize';
import { DebugProtocol } from 'vscode-debugprotocol';
import { DataScience } from '../../../platform/common/utils/localize';
import { LastSavedNotebookCellLanguage } from '../../../notebooks/languages/cellLanguageService';
import { VSCodeNotebookController } from '../../../notebooks/controllers/vscodeNotebookController';
import { INotebookEditorProvider } from '../../../notebooks/types';
import {
    IControllerLoader,
    IControllerPreferredService,
    IControllerRegistration,
    IControllerSelection,
    InteractiveControllerIdSuffix,
    IVSCodeNotebookController
} from '../../../notebooks/controllers/types';
import { IS_SMOKE_TEST } from '../../constants';
import * as urlPath from '../../../platform/vscode-path/resources';
import uuid from 'uuid/v4';
import { IFileSystem, IPlatformService } from '../../../platform/common/platform/types';
import { initialize, waitForCondition } from '../../common';
import { VSCodeNotebook } from '../../../platform/common/application/notebook';
import { IDebuggingManager, IKernelDebugAdapter } from '../../../notebooks/debugger/debuggingTypes';
import { PythonKernelCompletionProvider } from '../../../standalone/intellisense/pythonKernelCompletionProvider';
import { verifySelectedControllerIsRemoteForRemoteTests } from '../helpers';
import {
    NotebookCellStateTracker,
    hasErrorOutput,
    CellOutputMimeTypes,
    getTextOutputValue
} from '../../../kernels/execution/helpers';
import { chainWithPendingUpdates } from '../../../kernels/execution/notebookUpdater';
import { openAndShowNotebook } from '../../../platform/common/utils/notebooks';
import { IServerConnectionType } from '../../../kernels/jupyter/types';

// Running in Conda environments, things can be a little slower.
export const defaultNotebookTestTimeout = 60_000;

export async function getServices() {
    const api = await initialize();
    return {
        vscodeNotebook: api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook) as IVSCodeNotebook,
        editorProvider: api.serviceContainer.get<INotebookEditorProvider>(
            INotebookEditorProvider
        ) as INotebookEditorProvider,
        controllerRegistration: api.serviceContainer.get<IControllerRegistration>(
            IControllerRegistration
        ) as IControllerRegistration,
        controllerLoader: api.serviceContainer.get<IControllerLoader>(IControllerLoader),
        controllerSelection: api.serviceContainer.get<IControllerSelection>(IControllerSelection),
        controllerPreferred: api.serviceContainer.get<IControllerPreferredService>(IControllerPreferredService),
        isWebExtension: api.serviceContainer.get<boolean>(IsWebExtension),
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
    const startNumber = options?.index ?? activeEditor.notebook.cellCount;
    await chainWithPendingUpdates(activeEditor.notebook, (edit) => {
        const cellData = new NotebookCellData(NotebookCellKind.Markup, source, MARKDOWN_LANGUAGE);
        cellData.outputs = [];
        cellData.metadata = {};
        const nbEdit = NotebookEdit.insertCells(startNumber, [cellData]);
        edit.set(activeEditor.notebook.uri, [nbEdit]);
    });
    return activeEditor.notebook.cellAt(startNumber)!;
}
export async function insertCodeCell(source: string, options?: { language?: string; index?: number }) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor) {
        throw new Error('No active editor');
    }
    const startNumber = options?.index ?? activeEditor.notebook.cellCount;
    const edit = new WorkspaceEdit();
    const cellData = new NotebookCellData(NotebookCellKind.Code, source, options?.language || PYTHON_LANGUAGE);
    cellData.outputs = [];
    cellData.metadata = {};
    const nbEdit = NotebookEdit.insertCells(startNumber, [cellData]);
    edit.set(activeEditor.notebook.uri, [nbEdit]);
    await workspace.applyEdit(edit);

    return activeEditor.notebook.cellAt(startNumber)!;
}
export async function deleteCell(index: number = 0) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor || activeEditor.notebook.cellCount === 0) {
        return;
    }
    if (!activeEditor) {
        assert.fail('No active editor');
        return;
    }
    await chainWithPendingUpdates(activeEditor.notebook, (edit) => {
        const nbEdit = NotebookEdit.deleteCells(new NotebookRange(index, index + 1));
        edit.set(activeEditor.notebook.uri, [nbEdit]);
    });
}
export async function deleteAllCellsAndWait() {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    if (!activeEditor || activeEditor.notebook.cellCount === 0) {
        return;
    }
    await chainWithPendingUpdates(activeEditor.notebook, (edit) => {
        const nbEdit = NotebookEdit.deleteCells(new NotebookRange(0, activeEditor.notebook.cellCount));
        edit.set(activeEditor.notebook.uri, [nbEdit]);
    });
}

async function createTemporaryNotebookFromNotebook(
    notebook: nbformat.INotebookContent,
    disposables: IDisposable[],
    rootFolder?: Uri,
    prefix?: string
) {
    const uri = await generateTemporaryFilePath('.ipynb', disposables, rootFolder, prefix);
    await workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(notebook)));

    return uri;
}

export async function generateTemporaryFilePath(
    extension: string,
    disposables: IDisposable[],
    rootFolder?: Uri,
    prefix?: string
) {
    const services = await getServices();
    const platformService = services.serviceContainer.get<IPlatformService>(IPlatformService);
    const workspaceService = services.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
    const rootUrl =
        rootFolder ||
        platformService.tempDir ||
        workspaceService.rootFolder ||
        Uri.file('./').with({ scheme: 'vscode-test-web' });

    const uri = urlPath.joinPath(rootUrl, `${prefix || ''}${uuid()}.${extension}`);
    disposables.push({
        dispose: () => {
            void workspace.fs.delete(uri).then(noop, noop);
        }
    });

    return uri;
}

export async function createTemporaryNotebookFromFile(
    file: Uri,
    disposables: IDisposable[],
    kernelName: string = 'Python 3'
) {
    const services = await getServices();
    const fileSystem = services.serviceContainer.get<IFileSystem>(IFileSystem);
    const contents = await fileSystem.readFile(file);
    const notebook = JSON.parse(contents);
    if (notebook.kernel) {
        notebook.kernel.display_name = kernelName;
    }
    return createTemporaryNotebookFromNotebook(notebook, disposables, undefined, urlPath.basename(file));
}

export async function createTemporaryNotebook(
    cells: (nbformat.ICodeCell | nbformat.IMarkdownCell | nbformat.IRawCell | nbformat.IUnrecognizedCell)[],
    disposables: IDisposable[],
    kernelName: string = 'Python 3',
    rootFolder?: Uri,
    prefix?: string
): Promise<Uri> {
    cells =
        cells.length == 0
            ? [
                  {
                      cell_type: 'code',
                      outputs: [],
                      source: ['\n'],
                      execution_count: 0,
                      metadata: {}
                  }
              ]
            : cells;
    const data: nbformat.INotebookContent = {
        cells,
        metadata: {
            orig_nbformat: 4
        },
        nbformat: 4,
        nbformat_minor: 2,
        kernel: {
            display_name: kernelName
        }
    };
    return createTemporaryNotebookFromNotebook(data, disposables, rootFolder, prefix);
}

/**
 * Open an existing notebook with some metadata that tells extension to use Python kernel.
 * Else creating a blank notebook could result in selection of non-python kernel, based on other tests.
 * We have other tests where we test non-python kernels, this could mean we might end up with non-python kernels
 * when creating a new notebook.
 * This function ensures we always open a notebook for testing that is guaranteed to use a Python kernel.
 */
export async function createEmptyPythonNotebook(
    disposables: IDisposable[] = [],
    rootFolder?: Uri,
    dontWaitForKernel?: boolean
) {
    traceInfoIfCI('Creating an empty notebook');
    const { serviceContainer } = await getServices();
    const vscodeNotebook = serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    const serverConnectionType = serviceContainer.get<IServerConnectionType>(IServerConnectionType);
    // Don't use same file (due to dirty handling, we might save in dirty.)
    // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
    const nbFile = await createTemporaryNotebook([], disposables, 'Python 3', rootFolder, 'emptyPython');
    // Open a python notebook and use this for all tests in this test suite.
    await openAndShowNotebook(nbFile);
    assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
    if (!dontWaitForKernel) {
        await waitForKernelToGetAutoSelected(undefined, undefined, !serverConnectionType.isLocalLaunch);
        await verifySelectedControllerIsRemoteForRemoteTests();
    }
    await deleteAllCellsAndWait();
    return vscodeNotebook.activeNotebookEditor!.notebook;
}

async function shutdownAllNotebooks() {
    const api = await initialize();
    const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider) as IKernelProvider;
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
    if (!IS_SMOKE_TEST()) {
        // When running smoke tests, we won't have access to these.
        const configSettings = await import('../../../platform/common/configSettings');
        // Dispose any cached python settings (used only in test env).
        configSettings.JupyterSettings.dispose();
    }
    await ensureNoActiveDebuggingSession();
    VSCodeNotebookController.kernelAssociatedWithDocument = undefined;
    await closeNotebooks(disposables);
    disposeAllDisposables(disposables);
    await shutdownAllNotebooks();
    await ensureNewNotebooksHavePythonCells();
    try {
        await commands.executeCommand('python.clearWorkspaceInterpreter');
    } catch (ex) {
        // Python extension may not be installed. Don't fail the test
    }
    sinon.restore();
}

export async function closeNotebooks(disposables: IDisposable[] = []) {
    if (!isInsiders()) {
        return false;
    }
    const api = await initialize();
    VSCodeNotebookController.kernelAssociatedWithDocument = undefined;
    const notebooks = api.serviceManager.get<IVSCodeNotebook>(IVSCodeNotebook) as VSCodeNotebook;
    await notebooks.closeActiveNotebooks();
    await closeActiveWindows();
    disposeAllDisposables(disposables);
    await shutdownAllNotebooks();
}

let waitForKernelPendingPromise: Promise<void> | undefined;

export async function waitForKernelToChange(
    criteria:
        | { labelOrId: string; isInteractiveController?: boolean }
        | { interpreterPath: Uri; isInteractiveController?: boolean },
    notebookEditor?: NotebookEditor,
    timeout = defaultNotebookTestTimeout,
    skipAutoSelection?: boolean
) {
    // Wait for the previous kernel change to finish.
    if (waitForKernelPendingPromise != undefined) {
        await waitForKernelPendingPromise;
    }
    waitForKernelPendingPromise = waitForKernelToChangeImpl(criteria, notebookEditor, timeout, skipAutoSelection);
    return waitForKernelPendingPromise;
}

async function waitForKernelToChangeImpl(
    criteria:
        | { labelOrId: string; isInteractiveController?: boolean }
        | { interpreterPath: Uri; isInteractiveController?: boolean },
    notebookEditor?: NotebookEditor,
    timeout = defaultNotebookTestTimeout,
    skipAutoSelection?: boolean
) {
    const { vscodeNotebook, controllerLoader, controllerRegistration, controllerSelection } = await getServices();

    // Wait for the active editor to come up
    notebookEditor = await waitForActiveNotebookEditor(notebookEditor);

    // Get the list of NotebookControllers for this document
    await controllerLoader.loadControllers();
    const notebookControllers = controllerRegistration.registered;

    // Find the kernel id that matches the name we want
    let controller: IVSCodeNotebookController | undefined;
    let labelOrId = 'labelOrId' in criteria ? criteria.labelOrId : undefined;
    if (labelOrId) {
        controller = notebookControllers
            ?.filter((k) => (criteria.isInteractiveController ? k.id.includes(InteractiveControllerIdSuffix) : true))
            ?.find((k) => (labelOrId && k.label === labelOrId) || (k.id && k.id == labelOrId));
        if (!controller) {
            // Try includes instead
            controller = notebookControllers?.find(
                (k) => (labelOrId && k.label.includes(labelOrId)) || (k.id && k.id == labelOrId)
            );
        }
    }
    const interpreterPath = 'interpreterPath' in criteria ? criteria.interpreterPath : undefined;
    if (interpreterPath && !controller) {
        controller = notebookControllers
            ?.filter((k) => k.connection.interpreter)
            ?.filter((k) => (criteria.isInteractiveController ? k.id.includes(InteractiveControllerIdSuffix) : true))
            .find((k) =>
                // eslint-disable-next-line local-rules/dont-use-fspath
                k.connection.interpreter!.uri.fsPath.toLowerCase().includes(interpreterPath.fsPath.toLowerCase())
            );
    }
    traceInfo(`Switching to kernel id ${controller?.id}`);
    const isRightKernel = () => {
        const doc = vscodeNotebook.activeNotebookEditor?.notebook;
        if (!doc) {
            return false;
        }

        const selectedController = controllerSelection.getSelected(doc);
        if (!selectedController) {
            return false;
        }
        if (selectedController.id === controller?.id) {
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
                if (!isRightKernel() && !skipAutoSelection) {
                    traceInfoIfCI(
                        `Notebook select.kernel command switching to kernel id ${controller?.connection.kind}${controller?.id}: Try ${tryCount}`
                    );
                    // Send a select kernel on the active notebook editor. Keep sending it if it fails.
                    await commands.executeCommand('notebook.selectKernel', {
                        id: controller?.id,
                        extension: JVSC_EXTENSION_ID
                    });
                    traceInfoIfCI(
                        `Notebook select.kernel command switched to kernel id ${controller?.connection.kind}:${controller?.id}`
                    );
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
        traceInfoIfCI(
            `Notebook select.kernel command successfully switched to kernel id ${controller?.connection.kind}${controller?.id}: after ${tryCount} attempts.`
        );
    }
}

async function waitForActiveNotebookEditor(notebookEditor?: NotebookEditor): Promise<NotebookEditor> {
    const { vscodeNotebook } = await getServices();

    // Wait for the active editor to come up
    notebookEditor = notebookEditor || vscodeNotebook.activeNotebookEditor;
    if (!notebookEditor) {
        await waitForCondition(
            async () => !!vscodeNotebook.activeNotebookEditor,
            10_000,
            'Active editor not a notebook'
        );
        notebookEditor = vscodeNotebook.activeNotebookEditor;
    }
    if (!notebookEditor) {
        throw new Error('No notebook editor');
    }
    return notebookEditor;
}

export async function waitForKernelToGetAutoSelected(
    notebookEditor?: NotebookEditor,
    expectedLanguage?: string,
    preferRemoteKernelSpec: boolean = false,
    timeout = 100_000,
    skipAutoSelection: boolean = false
) {
    traceInfoIfCI('Wait for kernel to get auto selected');
    const { controllerLoader, controllerRegistration, controllerSelection, controllerPreferred, isWebExtension } =
        await getServices();
    const useRemoteKernelSpec = preferRemoteKernelSpec || isWebExtension; // Web is only remote

    // Wait for the active editor to come up
    notebookEditor = await waitForActiveNotebookEditor(notebookEditor);

    // Get the list of NotebookControllers for this document
    await controllerLoader.loadControllers();
    traceInfoIfCI(`Wait for kernel - got notebook controllers`);
    const notebookControllers = controllerRegistration.registered;

    // Make sure we don't already have a selection (this function gets run even after opening a document)
    if (controllerSelection.getSelected(notebookEditor.notebook)) {
        return;
    }

    // We don't have one, try to find the preferred one
    let preferred: IVSCodeNotebookController | undefined;

    // Wait for one of them to have affinity as the preferred (this may not happen)
    try {
        await waitForCondition(
            async () => {
                preferred = controllerPreferred.getPreferred(notebookEditor!.notebook);
                return preferred != undefined;
            },
            30_000,
            `Did not find a controller with document affinity`
        );
    } catch {
        // Do nothing for now. Just log it
        traceInfoIfCI(`No preferred controller found during waitForKernelToGetAutoSelected`);
    }
    traceInfoIfCI(
        `Wait for kernel - got a preferred notebook controller: ${preferred?.connection.kind}:${preferred?.id}`
    );

    // Find one that matches the expected language or the preferred
    const expectedLower = expectedLanguage?.toLowerCase();
    const language = expectedLower || 'python';
    const preferredKind = useRemoteKernelSpec ? 'startUsingRemoteKernelSpec' : preferred?.connection.kind;
    let match: IVSCodeNotebookController | undefined;
    if (preferred) {
        if (
            preferred.connection.kind !== 'connectToLiveRemoteKernel' &&
            (!expectedLanguage || preferred.connection.kernelSpec?.language?.toLowerCase() === expectedLower) &&
            preferredKind === preferred.connection.kind
        ) {
            match = preferred;
        } else if (preferred.connection.kind === 'connectToLiveRemoteKernel') {
            match = preferred;
        }
    }
    if (!match) {
        match = notebookControllers.find(
            (d) =>
                d.connection.kind != 'connectToLiveRemoteKernel' &&
                language === d.connection.kernelSpec?.language?.toLowerCase() &&
                (!useRemoteKernelSpec || d.connection.kind.includes('Remote'))
        );
    }

    if (!match) {
        traceInfoIfCI(
            `Houston, we have a problem, no match. Expected language ${expectedLanguage}. Expected kind ${preferredKind}.`
        );
        assert.fail(
            `No notebook controller found for ${expectedLanguage} when useRemote is ${useRemoteKernelSpec} and preferred kind is ${preferredKind}. NotebookControllers : ${JSON.stringify(
                notebookControllers.map((c) => c.connection)
            )}`
        );
    }

    const criteria = { labelOrId: match!.id };
    traceInfo(
        `Preferred kernel for selection is ${match.connection.kind}:${match?.id}, criteria = ${JSON.stringify(
            criteria
        )}`
    );
    assert.ok(match, 'No kernel to auto select');
    return waitForKernelToChange(criteria, notebookEditor, timeout, skipAutoSelection);
}

const prewarmNotebooksDone = { done: false };
export async function prewarmNotebooks() {
    if (prewarmNotebooksDone.done) {
        return;
    }
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
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(0)!;
        traceInfoIfCI(`Running all cells in prewarm notebooks`);
        await Promise.all([waitForExecutionCompletedSuccessfully(cell, 60_000), runAllCellsInActiveNotebook()]);
        await closeActiveWindows();
        await shutdownAllNotebooks();
    } finally {
        disposables.forEach((d) => d.dispose());
        prewarmNotebooksDone.done = true;
    }
}

function assertHasExecutionCompletedSuccessfully(cell: NotebookCell) {
    return (
        (cell.executionSummary?.executionOrder ?? 0) > 0 &&
        NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Idle &&
        !hasErrorOutput(cell.outputs)
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
    assert.ok(cell, 'No notebook cell to wait for');
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

export async function waitForCompletions(
    completionProvider: PythonKernelCompletionProvider,
    cell: NotebookCell,
    pos: Position,
    triggerCharacter: string | undefined
) {
    const token = new CancellationTokenSource().token;
    let completions: CompletionItem[] = [];
    await waitForCondition(
        async () => {
            await sleep(500); // Give it some time since last ask.
            let context: CompletionContext = {
                triggerKind: triggerCharacter ? CompletionTriggerKind.TriggerCharacter : CompletionTriggerKind.Invoke,
                triggerCharacter
            };
            completions = await completionProvider.provideCompletionItems(cell.document, pos, token, context);
            return completions.length > 0;
        },
        defaultNotebookTestTimeout,
        `Unable to get completions for cell ${cell.document.uri}`
    );
    return completions;
}

export async function waitForCellHavingOutput(cell: NotebookCell) {
    return waitForCondition(
        async () => {
            const cellOutputs = getCellOutputs(cell);
            return cellOutputs.length > 0 && !cellOutputs.includes('No cell outputs');
        },
        defaultNotebookTestTimeout,
        'No output'
    );
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
export async function waitForExecutionCompletedWithoutChangesToExecutionCount(
    cell: NotebookCell,
    timeout: number = defaultNotebookTestTimeout
) {
    await waitForCondition(
        async () =>
            (cell.executionSummary?.executionOrder ?? 0) === 0 &&
            (NotebookCellStateTracker.getCellState(cell) ?? NotebookCellExecutionState.Idle) ===
                NotebookCellExecutionState.Idle,
        timeout,
        () => `Cell ${cell.index + 1} did not complete, State = ${NotebookCellStateTracker.getCellState(cell)}`
    );
}
export async function waitForExecutionCompletedWithErrors(
    cell: NotebookCell,
    timeout: number = defaultNotebookTestTimeout,
    executionOderShouldChange: boolean = true
) {
    await waitForCondition(
        async () => assertHasExecutionCompletedWithErrors(cell, executionOderShouldChange),
        timeout,
        () => `Cell ${cell.index + 1} did not fail as expected, State =  ${NotebookCellStateTracker.getCellState(cell)}`
    );
    if (executionOderShouldChange) {
        await waitForCellExecutionToComplete(cell);
    }
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

function assertHasExecutionCompletedWithErrors(cell: NotebookCell, executionOderShouldChange = true) {
    return (
        (executionOderShouldChange ? (cell.executionSummary?.executionOrder ?? 0) > 0 : true) &&
        (NotebookCellStateTracker.getCellState(cell) || NotebookCellExecutionState.Idle) ===
            NotebookCellExecutionState.Idle &&
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
        output.mime !== CellOutputMimeTypes.error &&
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
        output.mime !== CellOutputMimeTypes.error &&
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
    } catch (ex) {
        traceInfoIfCI(`Looking for value ${value}, but failed with error`, ex);
        return false;
    }
}
export function assertHasTextOutputInVSCode(cell: NotebookCell, text: string, index: number = 0, isExactMatch = true) {
    const cellOutputs = cell.outputs;
    assert.ok(cellOutputs.length, 'No output');
    const result = cell.outputs[index].items.some((item) => hasTextOutputValue(item, text, isExactMatch));
    if (result) {
        return result;
    }
    assert.isTrue(result, `${text} not found in outputs of cell ${cell.index} ${getCellOutputs(cell)}`);
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
            `After ${timeout}ms output, does not contain provided text '${text}' for Cell ${
                cell.index + 1
            } in output index ${index}, it is ${cell.outputs
                .map(
                    (output, index) =>
                        `Output for Index "${index}" with total outputs ${output.items.length} is "${output.items
                            .map(getOutputText)
                            .join('\n')}"`
                )
                .join('\n')}`
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
export async function runCell(cell: NotebookCell, waitForExecutionToComplete = false) {
    const api = await initialize();
    const vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    const notebookEditor = vscodeNotebook.notebookEditors.find((e) => e.notebook === cell.notebook);
    await waitForKernelToGetAutoSelected(notebookEditor, undefined, false, 60_000);
    if (!vscodeNotebook.activeNotebookEditor || !vscodeNotebook.activeNotebookEditor.notebook) {
        throw new Error('No notebook or document');
    }

    const promise = commands.executeCommand(
        'notebook.cell.execute',
        { start: cell.index, end: cell.index + 1 },
        vscodeNotebook.activeNotebookEditor.notebook.uri
    );

    if (waitForExecutionToComplete) {
        await promise.then(noop, noop);
    }
}
export async function runAllCellsInActiveNotebook(
    waitForExecutionToComplete = false,
    activeEditor: NotebookEditor | undefined = undefined
) {
    const api = await initialize();
    const vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    await waitForKernelToGetAutoSelected(activeEditor, undefined, false, 60_000);

    if (!vscodeNotebook.activeNotebookEditor || !vscodeNotebook.activeNotebookEditor.notebook) {
        throw new Error('No editor or document');
    }

    const promise = commands
        .executeCommand('notebook.execute', vscodeNotebook.activeNotebookEditor.notebook.uri)
        .then(noop, noop);

    if (waitForExecutionToComplete) {
        await promise.then(noop, noop);
    }
}

export type WindowPromptStub = {
    dispose: Function;
    displayed: Promise<boolean>;
    /**
     * Gets the messages that were displayed. Access this once the promise `displayed` has resolved to get latest stuff.
     */
    messages: string[];
    clickButton(text?: string | undefined): void;
    reset(): void;
    getDisplayCount(): number;
};
export type WindowPromptStubButtonClickOptions = {
    result?: string | Uri;
    clickImmediately?: boolean;
    dismissPrompt?: boolean;
};
/**
 * Ability to stub prompts for VS Code tests.
 * We can confirm prompt was displayed & invoke a button click.
 */
export async function hijackPrompt(
    promptType: 'showErrorMessage' | 'showInformationMessage',
    message: { exactMatch: string } | { endsWith: string } | { contains: string },
    buttonToClick?: WindowPromptStubButtonClickOptions,
    disposables: IDisposable[] = []
): Promise<WindowPromptStub> {
    const api = await initialize();
    const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
    let displayed = createDeferred<boolean>();
    let clickButton = createDeferred<string | Uri>();
    const messageDisplayed: string[] = [];
    let displayCount = 0;
    // eslint-disable-next-line
    const stub = sinon.stub(appShell, promptType).callsFake(function (msg: string) {
        traceInfo(`Message displayed to user '${msg}', condition ${JSON.stringify(message)}`);
        if (
            ('exactMatch' in message && msg.trim() === message.exactMatch.trim()) ||
            ('contains' in message && msg.trim().includes(message.contains.trim())) ||
            ('endsWith' in message && msg.endsWith(message.endsWith))
        ) {
            messageDisplayed.push(msg);
            traceInfo(`Exact Message found '${msg}'`);
            displayCount += 1;
            displayed.resolve(true);
            if (buttonToClick) {
                if (!buttonToClick.dismissPrompt && buttonToClick?.clickImmediately === true && buttonToClick.result) {
                    if (clickButton.completed) {
                        clickButton = createDeferred<string>();
                    }
                    clickButton.resolve(buttonToClick.result);
                }
                return buttonToClick.dismissPrompt ? Promise.resolve(undefined) : clickButton.promise;
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (appShell[promptType] as any).wrappedMethod.apply(appShell, arguments);
    } as any);
    const disposable = { dispose: () => stub.restore() };
    if (disposables) {
        disposables.push(disposable);
    }
    return {
        dispose: () => stub.restore(),
        getDisplayCount: () => displayCount,
        get displayed() {
            return displayed.promise;
        },
        get messages() {
            return messageDisplayed;
        },
        reset: () => {
            messageDisplayed.splice(0, messageDisplayed.length);
            displayCount = 0;
            displayed = createDeferred<boolean>();
        },
        clickButton: (text?: string) => clickButton.resolve(text || buttonToClick?.result)
    };
}

export async function changeShowOnlyOneTypeOfKernel(setting: boolean) {
    const api = await initialize();
    const config = api.serviceContainer.get<IConfigurationService>(IConfigurationService);
    const settings = config.getSettings();
    if (settings.showOnlyOneTypeOfKernel !== setting) {
        await config.updateSetting('showOnlyOneTypeOfKernel', setting, undefined, ConfigurationTarget.Global);
    }
}

export async function hijackSavePrompt(
    saveLabel: string,
    buttonToClick?: WindowPromptStubButtonClickOptions,
    disposables: IDisposable[] = []
): Promise<WindowPromptStub> {
    const api = await initialize();
    const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
    let displayed = createDeferred<boolean>();
    let clickButton = createDeferred<string | Uri>();
    const messageDisplayed: string[] = [];
    let displayCount = 0;
    // eslint-disable-next-line
    const stub = sinon.stub(appShell, 'showSaveDialog').callsFake(function (msg: { saveLabel: string }) {
        traceInfo(`Message displayed to user '${JSON.stringify(msg)}', checking for '${saveLabel}'`);
        if (msg.saveLabel === saveLabel) {
            messageDisplayed.push(msg.saveLabel);
            traceInfo(`Exact Message found '${msg.saveLabel}'`);
            displayCount += 1;
            displayed.resolve(true);
            if (buttonToClick) {
                if (!buttonToClick.dismissPrompt && buttonToClick?.clickImmediately === true && buttonToClick.result) {
                    if (clickButton.completed) {
                        clickButton = createDeferred<string>();
                    }
                    clickButton.resolve(buttonToClick.result);
                }
                return buttonToClick.dismissPrompt ? Promise.resolve(undefined) : clickButton.promise;
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (appShell.showSaveDialog as any).wrappedMethod.apply(appShell, arguments);
    } as any);
    const disposable = { dispose: () => stub.restore() };
    if (disposables) {
        disposables.push(disposable);
    }
    return {
        dispose: () => stub.restore(),
        getDisplayCount: () => displayCount,
        get displayed() {
            return displayed.promise;
        },
        get messages() {
            return messageDisplayed;
        },
        reset: () => {
            messageDisplayed.splice(0, messageDisplayed.length);
            displayCount = 0;
            displayed = createDeferred<boolean>();
        },
        clickButton: (text?: string) => clickButton.resolve(text || buttonToClick?.result)
    };
}

export class MockQuickPick implements QuickPick<QuickPickItem> {
    value: string;
    placeholder: string | undefined;
    get onDidChangeValue(): Event<string> {
        return this._onDidChangeValueEmitter.event;
    }
    get onDidAccept(): Event<void> {
        return this._onDidAcceptEmitter.event;
    }
    buttons: readonly QuickInputButton[];
    get onDidTriggerButton(): Event<QuickInputButton> {
        return this._onDidTriggerButtonEmitter.event;
    }
    get onDidTriggerItemButton(): Event<QuickPickItemButtonEvent<QuickPickItem>> {
        return this._onDidTriggerItemButtonEmitter.event;
    }
    items: readonly QuickPickItem[];
    canSelectMany: boolean;
    matchOnDescription: boolean;
    matchOnDetail: boolean;
    keepScrollPosition?: boolean | undefined;
    activeItems: readonly QuickPickItem[];
    get onDidChangeActive(): Event<readonly QuickPickItem[]> {
        return this._onDidChangeActiveEmitter.event;
    }
    selectedItems: readonly QuickPickItem[];
    get onDidChangeSelection(): Event<readonly QuickPickItem[]> {
        return this._onDidChangeSelectionEmitter.event;
    }
    sortByLabel: boolean;
    title: string | undefined;
    step: number | undefined;
    totalSteps: number | undefined;
    enabled: boolean;
    busy: boolean;
    ignoreFocusOut: boolean;
    show(): void {
        // Does nothing.
    }
    hide(): void {
        this._onDidHideEmitter.fire();
    }
    get onDidHide(): Event<void> {
        return this._onDidHideEmitter.event;
    }
    dispose(): void {
        // Do nothing
    }
    public selectIndex(index: number) {
        this.selectedItems = [this.items[index]];
        this._onDidChangeSelectionEmitter.fire([this.items[index]]);
    }
    public selectLastItem() {
        const index = this.items.length - 1;
        this.selectIndex(index);
    }
    public triggerButton(button: QuickInputButton): void {
        this._onDidTriggerButtonEmitter.fire(button);
    }
    private _onDidChangeValueEmitter = new EventEmitter<string>();
    private _onDidAcceptEmitter = new EventEmitter<void>();
    private _onDidTriggerButtonEmitter = new EventEmitter<QuickInputButton>();
    private _onDidTriggerItemButtonEmitter = new EventEmitter<QuickPickItemButtonEvent<QuickPickItem>>();
    private _onDidChangeActiveEmitter = new EventEmitter<readonly QuickPickItem[]>();
    private _onDidChangeSelectionEmitter = new EventEmitter<readonly QuickPickItem[]>();
    private _onDidHideEmitter = new EventEmitter<void>();
}

export type QuickPickStub = {
    dispose(): void;
    created: Event<MockQuickPick>;
};

export async function hijackCreateQuickPick(disposables: IDisposable[] = []): Promise<QuickPickStub> {
    const api = await initialize();
    const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
    const emitter = new EventEmitter<MockQuickPick>();

    const stub = sinon.stub(appShell, 'createQuickPick').callsFake(function () {
        const result = new MockQuickPick();
        emitter.fire(result);
        return result;
    });
    const disposable = { dispose: () => stub.restore() };
    if (disposables) {
        disposables.push(disposable);
        disposables.push(emitter);
    }
    return {
        dispose: () => {
            stub.restore();
            emitter.dispose();
        },
        created: emitter.event
    };
}

export async function asPromise<T>(
    event: Event<T>,
    predicate?: (value: T) => boolean,
    timeout = env.uiKind === UIKind.Desktop ? 5000 : 15000,
    prefix: string | undefined = undefined
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const handle = setTimeout(() => {
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            sub.dispose();
            reject(new Error(`asPromise ${prefix} TIMEOUT reached`));
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
    assert.ok(debugAdapter, `No debug adapter when waiting for stopped event`);
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

export async function ensureNoActiveDebuggingSession() {
    await commands.executeCommand('workbench.action.debug.stop');
    await commands.executeCommand('workbench.action.debug.disconnect');
    await waitForCondition(
        async () => {
            return debug.activeDebugSession === undefined;
        },
        defaultNotebookTestTimeout,
        `Unable to stop debug session`
    );
}
