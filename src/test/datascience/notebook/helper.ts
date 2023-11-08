// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */

import type * as nbformat from '@jupyterlab/nbformat';
import { KernelAPI } from '@jupyterlab/services';
import { assert, expect } from 'chai';
import * as sinon from 'sinon';
import uuid from 'uuid/v4';
import {
    CancellationTokenSource,
    CompletionContext,
    CompletionItem,
    CompletionTriggerKind,
    DebugSession,
    Diagnostic,
    Event,
    EventEmitter,
    Hover,
    Memento,
    NotebookCell,
    NotebookCellData,
    NotebookCellExecutionState,
    NotebookCellKind,
    NotebookCellOutputItem,
    NotebookData,
    NotebookDocument,
    NotebookEdit,
    NotebookEditor,
    NotebookRange,
    Position,
    QuickInputButton,
    QuickPick,
    QuickPickItem,
    QuickPickItemButtonEvent,
    UIKind,
    Uri,
    WorkspaceEdit,
    commands,
    debug,
    env,
    languages,
    notebooks,
    window,
    workspace
} from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import {
    CellOutputMimeTypes,
    NotebookCellStateTracker,
    getTextOutputValue,
    hasErrorOutput
} from '../../../kernels/execution/helpers';
import { chainWithPendingUpdates } from '../../../kernels/execution/notebookUpdater';
import { IJupyterServerUriStorage } from '../../../kernels/jupyter/types';
import {
    IKernelFinder,
    IKernelProvider,
    IThirdPartyKernelProvider,
    PythonKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../../kernels/types';
import {
    IControllerRegistration,
    IVSCodeNotebookController,
    InteractiveControllerIdSuffix
} from '../../../notebooks/controllers/types';
import { VSCodeNotebookController } from '../../../notebooks/controllers/vscodeNotebookController';
import { IDebuggingManager, IKernelDebugAdapter } from '../../../notebooks/debugger/debuggingTypes';
import { LastSavedNotebookCellLanguage } from '../../../notebooks/languages/cellLanguageService';
import { INotebookEditorProvider } from '../../../notebooks/types';
import { VSCodeNotebook } from '../../../platform/common/application/notebook';
import { IApplicationShell, IVSCodeNotebook, IWorkspaceService } from '../../../platform/common/application/types';
import {
    JVSC_EXTENSION_ID,
    JupyterNotebookView,
    MARKDOWN_LANGUAGE,
    PYTHON_LANGUAGE,
    defaultNotebookFormat
} from '../../../platform/common/constants';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IFileSystem, IPlatformService } from '../../../platform/common/platform/types';
import { GLOBAL_MEMENTO, IDisposable, IMemento, IsWebExtension } from '../../../platform/common/types';
import { createDeferred, raceTimeoutError, sleep } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { isWeb } from '../../../platform/common/utils/misc';
import { openAndShowNotebook } from '../../../platform/common/utils/notebooks';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { traceInfo, traceInfoIfCI, traceVerbose, traceWarning } from '../../../platform/logging';
import { areInterpreterPathsSame } from '../../../platform/pythonEnvironments/info/interpreter';
import * as urlPath from '../../../platform/vscode-path/resources';
import { PythonKernelCompletionProvider } from '../../../standalone/intellisense/pythonKernelCompletionProvider';
import { initialize, waitForCondition } from '../../common';
import { IS_REMOTE_NATIVE_TEST, IS_SMOKE_TEST } from '../../constants';
import { noop } from '../../core';
import { closeActiveWindows, isInsiders } from '../../initialize';
import { verifySelectedControllerIsRemoteForRemoteTests } from '../helpers';
import { ControllerPreferredService } from './controllerPreferredService';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';
import { JupyterLabHelper } from '../../../kernels/jupyter/session/jupyterLabHelper';

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
        controllerPreferred: ControllerPreferredService.create(api.serviceContainer),
        isWebExtension: api.serviceContainer.get<boolean>(IsWebExtension),
        interpreterService: api.serviceContainer.get<boolean>(IsWebExtension)
            ? undefined
            : api.serviceContainer.get<IInterpreterService>(IInterpreterService),
        kernelFinder: api.serviceContainer.get<IKernelFinder>(IKernelFinder),
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
    kernelSpec: nbformat.IKernelspecMetadata = { display_name: 'Python 3', name: 'python3' },
    rootFolder?: Uri,
    prefix?: string,
    language?: string
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
            orig_nbformat: 4,
            kernelspec: kernelSpec
        },
        nbformat: 4,
        nbformat_minor: 2
    };
    if (language) {
        data.metadata.language_info = {
            name: language
        };
    }
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
    // Don't use same file (due to dirty handling, we might save in dirty.)
    // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
    const nbFile = await createTemporaryNotebook(
        [],
        disposables,
        undefined,
        rootFolder,
        'emptyPython',
        PYTHON_LANGUAGE
    );
    // Open a python notebook and use this for all tests in this test suite.
    await openAndShowNotebook(nbFile);
    assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
    if (!dontWaitForKernel) {
        await waitForKernelToGetAutoSelected(vscodeNotebook.activeNotebookEditor!, PYTHON_LANGUAGE);
        await verifySelectedControllerIsRemoteForRemoteTests();
    }
    await deleteAllCellsAndWait();
    const notebook = vscodeNotebook.activeNotebookEditor!.notebook;
    traceVerbose(`Empty notebook created ${getDisplayPath(notebook.uri)}`);
    return { notebook, editor: vscodeNotebook.activeNotebookEditor! };
}

async function shutdownAllNotebooks() {
    traceVerbose('Shutting down all kernels');
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
async function shutdownRemoteKernels() {
    const api = await initialize();
    const serverUriStorage = api.serviceContainer.get<IJupyterServerUriStorage>(IJupyterServerUriStorage);
    const jupyterConnection = api.serviceContainer.get<JupyterConnection>(JupyterConnection);
    const cancelToken = new CancellationTokenSource();
    let sessionManager: JupyterLabHelper | undefined;
    try {
        const connection = await jupyterConnection.createConnectionInfo((await serverUriStorage.getAll())[0].provider);
        sessionManager = JupyterLabHelper.create(connection.settings);
        const liveKernels = await sessionManager.getRunningKernels();
        await Promise.all(
            liveKernels.filter((item) => item.id).map((item) => KernelAPI.shutdownKernel(item.id!).catch(noop))
        );
    } catch {
        // ignore
    } finally {
        cancelToken.dispose();
        await sessionManager?.dispose().catch(noop);
    }
}
export const MockNotebookDocuments: NotebookDocument[] = [];
async function shutdownKernels() {
    const api = await initialize();
    const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
    await Promise.all(kernelProvider.kernels.map((k) => k.dispose().catch(noop)));
    const thirdPartyKernelProvider = api.serviceContainer.get<IThirdPartyKernelProvider>(IThirdPartyKernelProvider);
    await Promise.all(thirdPartyKernelProvider.kernels.map((k) => k.dispose().catch(noop)));
    await Promise.all(MockNotebookDocuments.map((nb) => kernelProvider.get(nb)?.dispose().catch(noop)));
    MockNotebookDocuments.length = 0;
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
    dispose(disposables);
    await shutdownAllNotebooks();
    await ensureNewNotebooksHavePythonCells();
    await shutdownRemoteKernels(); // Shutdown remote kernels, else the number of live kernels keeps growing.
    await shutdownKernels();
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
    traceVerbose(
        `Before Closing all notebooks, currently opened ${workspace.notebookDocuments
            .map((item) => getDisplayPath(item.uri))
            .join(', ')}`
    );
    const api = await initialize();
    VSCodeNotebookController.kernelAssociatedWithDocument = undefined;
    const notebooks = api.serviceManager.get<IVSCodeNotebook>(IVSCodeNotebook) as VSCodeNotebook;
    await notebooks.closeActiveNotebooks();
    await closeActiveWindows();
    dispose(disposables);
    await shutdownAllNotebooks();
    if (workspace.notebookDocuments.length) {
        traceVerbose(
            `After Closing all notebooks, currently opened ${workspace.notebookDocuments
                .map((item) => getDisplayPath(item.uri))
                .join(', ')}`
        );
    } else {
        traceVerbose(`Closed all notebooks`);
    }
}

let waitForKernelPendingPromise: Promise<void> | undefined;

export async function waitForKernelToChange(
    searchCriteria:
        | (() => Promise<{ labelOrId: string; isInteractiveController?: boolean }>)
        | { interpreterPath: Uri; isInteractiveController?: boolean },
    notebookEditor?: NotebookEditor,
    timeout = defaultNotebookTestTimeout,
    skipAutoSelection?: boolean
) {
    // Wait for the previous kernel change to finish.
    if (waitForKernelPendingPromise != undefined) {
        await waitForKernelPendingPromise;
    }
    waitForKernelPendingPromise = waitForKernelToChangeImpl(searchCriteria, notebookEditor, timeout, skipAutoSelection);
    return waitForKernelPendingPromise;
}

async function waitForKernelToChangeImpl(
    searchCriteria:
        | (() => Promise<{ labelOrId: string; isInteractiveController?: boolean }>)
        | { interpreterPath: Uri; isInteractiveController?: boolean },
    notebookEditor?: NotebookEditor,
    timeout = defaultNotebookTestTimeout,
    skipAutoSelection?: boolean
) {
    const { controllerRegistration } = await getServices();

    // Wait for the active editor to come up
    const editor = await waitForActiveNotebookEditor(notebookEditor);

    // Find the kernel id that matches the name we want
    let controller: IVSCodeNotebookController | undefined;
    const isRightKernel = async () => {
        const criteria = typeof searchCriteria === 'function' ? await searchCriteria() : searchCriteria;
        let labelOrId = 'labelOrId' in criteria ? criteria.labelOrId : undefined;
        if (labelOrId) {
            controller = controllerRegistration.registered
                .filter((k) => (criteria.isInteractiveController ? k.id.includes(InteractiveControllerIdSuffix) : true))
                .find((k) => (labelOrId && k.label === labelOrId) || (k.id && k.id == labelOrId));
            if (!controller) {
                // Try includes instead
                controller = controllerRegistration.registered.find(
                    (k) => (labelOrId && k.label.includes(labelOrId)) || (k.id && k.id == labelOrId)
                );
            }
        }
        const interpreterPath = 'interpreterPath' in criteria ? criteria.interpreterPath : undefined;
        if (interpreterPath && !controller) {
            controller = controllerRegistration.registered
                .filter((k) => k.connection.interpreter)
                .filter((k) => (criteria.isInteractiveController ? k.id.includes(InteractiveControllerIdSuffix) : true))
                .find((k) =>
                    // eslint-disable-next-line local-rules/dont-use-fspath
                    k.connection.interpreter!.uri.fsPath.toLowerCase().includes(interpreterPath.fsPath.toLowerCase())
                );
            if (controller) {
                // eslint-disable-next-line local-rules/dont-use-fspath
                traceVerbose(`Did match a controller that matches the interpreter ${interpreterPath.fsPath}`);
            } else {
                // eslint-disable-next-line local-rules/dont-use-fspath
                traceWarning(`Did not find a controller that matches the interpreter ${interpreterPath.fsPath}`);
            }
        }
        traceInfo(
            `Switching to kernel id ${controller?.id}, current controllers ${controllerRegistration.all
                .map(
                    (c) =>
                        `${c.kind} with id ${c.id} and ${
                            'interpreter' in c
                                ? // eslint-disable-next-line local-rules/dont-use-fspath
                                  `has interpreter with details = ${c.interpreter?.id}:${c.interpreter?.uri.fsPath}`
                                : 'does not have an interpreter'
                        } `
                )
                .join(', ')}`
        );

        const selectedController = controllerRegistration.getSelected(editor.notebook);
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
    if (!(await isRightKernel())) {
        let tryCount = 0;
        let lastCriteria: string;
        await waitForCondition(
            async () => {
                // Double check not the right kernel (don't select again if already found to be correct)
                if (!(await isRightKernel()) && !skipAutoSelection) {
                    const criteria = typeof searchCriteria === 'function' ? await searchCriteria() : searchCriteria;
                    lastCriteria = JSON.stringify(lastCriteria);
                    traceInfoIfCI(
                        `Notebook select.kernel command switching to kernel id ${controller?.connection
                            .kind}${controller?.id}: Try ${tryCount} for ${JSON.stringify(criteria)}`
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
                return await isRightKernel();
            },
            timeout,
            () => `Kernel with criteria ${lastCriteria} not selected`
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

async function getActiveInterpreterKernelConnection() {
    const { interpreterService, kernelFinder } = await getServices();
    const interpreter = await waitForCondition(
        () => interpreterService?.getActiveInterpreter(),
        defaultNotebookTestTimeout,
        'Active Interpreter is undefined.2'
    );
    return waitForCondition(
        () =>
            kernelFinder.kernels.find(
                (item) =>
                    item.kind === 'startUsingPythonInterpreter' &&
                    areInterpreterPathsSame(item.interpreter.uri, interpreter.uri)
            ) as PythonKernelConnectionMetadata,
        defaultNotebookTestTimeout,
        () =>
            `Kernel Connection pointing to active interpreter not found.0, active interpreter
        ${interpreter?.id} (${getDisplayPath(interpreter?.uri)}) for kernels (${
            kernelFinder.kernels.length
        }) ${kernelFinder.kernels
            .map((item) => `${item.id}=> ${item.kind} (${getDisplayPath(item.interpreter?.uri)})`)
            .join(', ')}`,
        500
    );
}
async function getDefaultPythonRemoteKernelConnectionForActiveInterpreter() {
    const { interpreterService, kernelFinder } = await getServices();
    const interpreter = isWeb()
        ? undefined
        : await waitForCondition(
              () => interpreterService?.getActiveInterpreter(),
              defaultNotebookTestTimeout,
              'Active Interpreter is undefined.3'
          );
    return waitForCondition(
        () =>
            kernelFinder.kernels.find(
                (item) => item.kind === 'startUsingRemoteKernelSpec' && item.kernelSpec.language === PYTHON_LANGUAGE
            ) as RemoteKernelSpecConnectionMetadata,
        defaultNotebookTestTimeout,
        () =>
            `Kernel Connection pointing to active interpreter not found.1, active interpreter
            ${interpreter?.id} (${getDisplayPath(interpreter?.uri)}) for kernels ${kernelFinder.kernels
                .map((item) => `${item.id}=> ${item.kind} (${getDisplayPath(item.interpreter?.uri)})`)
                .join(', ')}`,
        500
    );
}
export async function getDefaultKernelConnection() {
    return IS_REMOTE_NATIVE_TEST() || isWeb()
        ? getDefaultPythonRemoteKernelConnectionForActiveInterpreter()
        : getActiveInterpreterKernelConnection();
}
export function selectDefaultController(
    notebookEditor: NotebookEditor,
    timeout = defaultNotebookTestTimeout,
    language = PYTHON_LANGUAGE
) {
    if (language === PYTHON_LANGUAGE) {
        return IS_REMOTE_NATIVE_TEST() || isWeb()
            ? selectPythonRemoteKernelConnectionForActiveInterpreter(notebookEditor, timeout)
            : selectActiveInterpreterController(notebookEditor, timeout);
    } else {
        return IS_REMOTE_NATIVE_TEST() || isWeb()
            ? selectKernelSpec(notebookEditor, timeout, language)
            : selectKernelSpec(notebookEditor, timeout, language);
    }
}

async function selectKernelSpec(
    notebookEditor: NotebookEditor,
    timeout = defaultNotebookTestTimeout,
    language: string
) {
    const { controllerRegistration } = await getServices();

    // Find the requried controller
    const controller = await getControllerForKernelSpec(timeout, { language });
    await commands.executeCommand('notebook.selectKernel', {
        id: controller.id,
        extension: JVSC_EXTENSION_ID
    });
    await waitForCondition(
        () => controllerRegistration.getSelected(notebookEditor.notebook)?.id === controller.id,
        timeout,
        `Controller ${
            controller.id
        } not selected for ${notebookEditor.notebook.uri.toString()}, currently selected ${controllerRegistration.getSelected(
            notebookEditor.notebook
        )?.id} (2)`
    );
}

export async function getControllerForKernelSpec(
    timeout = defaultNotebookTestTimeout,
    query: { language: string; kernelSpecName?: string },
    localOrRemote: 'local' | 'remote' = IS_REMOTE_NATIVE_TEST() ? 'remote' : 'local'
) {
    const { controllerRegistration } = await getServices();
    const disposables: IDisposable[] = [];

    // Find the kernel id that matches the name we want
    const promise = new Promise<IVSCodeNotebookController>((resolve) => {
        const findController = () => {
            const controller = controllerRegistration.registered.find((k) => {
                if (
                    k.connection.kind !== 'startUsingRemoteKernelSpec' &&
                    k.connection.kind !== 'startUsingLocalKernelSpec'
                ) {
                    return false;
                }
                if (localOrRemote === 'remote' && k.connection.kind !== 'startUsingRemoteKernelSpec') {
                    return false;
                }
                if (localOrRemote === 'local' && k.connection.kind !== 'startUsingLocalKernelSpec') {
                    return false;
                }
                return k.connection.kernelSpec.language?.toLowerCase() === query.language.toLowerCase() &&
                    query.kernelSpecName
                    ? k.connection.kernelSpec.name?.toLowerCase() === query.kernelSpecName.toLowerCase()
                    : true;
            });
            if (controller) {
                resolve(controller);
            }
        };
        findController();
        controllerRegistration.onDidChange(() => findController(), undefined, disposables);
    });

    return raceTimeoutError(
        timeout,
        new Error(`No matching controller found for query ${JSON.stringify(query)}`),
        promise
    ).finally(() => dispose(disposables));
}
async function selectActiveInterpreterController(notebookEditor: NotebookEditor, timeout = defaultNotebookTestTimeout) {
    const { controllerRegistration, interpreterService } = await getServices();

    // Get the list of NotebookControllers for this document
    const interpreter = await interpreterService?.getActiveInterpreter(notebookEditor.notebook.uri);

    // Find the kernel id that matches the name we want
    const controller = await waitForCondition(
        () =>
            controllerRegistration.registered.find(
                (k) =>
                    k.connection.kind === 'startUsingPythonInterpreter' &&
                    (k.connection.kernelSpec.language || PYTHON_LANGUAGE).toLowerCase() ===
                        PYTHON_LANGUAGE.toLowerCase() &&
                    areInterpreterPathsSame(k.connection.interpreter.uri, interpreter?.uri)
            ),
        timeout,
        `No matching controller found for interpreter ${interpreter?.id}:${getDisplayPath(interpreter?.uri)}`
    );
    if (!controller) {
        throw new Error('No interpreter controller');
    }
    await commands.executeCommand('notebook.selectKernel', {
        id: controller.id,
        extension: JVSC_EXTENSION_ID
    });
    await waitForCondition(
        () =>
            controllerRegistration.getSelected(notebookEditor.notebook)?.id === controller.id &&
            controllerRegistration.getSelected(notebookEditor.notebook)?.viewType ===
                notebookEditor.notebook.notebookType,
        timeout,
        `Controller ${
            controller.id
        } not selected for ${notebookEditor.notebook.uri.toString()}, currently selected ${controllerRegistration.getSelected(
            notebookEditor.notebook
        )?.id} (1)`
    );
}
async function selectPythonRemoteKernelConnectionForActiveInterpreter(
    notebookEditor: NotebookEditor,
    timeout = defaultNotebookTestTimeout
) {
    const { controllerRegistration } = await getServices();
    const metadata = await getDefaultPythonRemoteKernelConnectionForActiveInterpreter();

    // Find the kernel id that matches the name we want
    const controller = await waitForCondition(
        () =>
            controllerRegistration.registered.find(
                (k) =>
                    k.connection.kind === 'startUsingRemoteKernelSpec' &&
                    k.connection.id === metadata.id &&
                    k.viewType === notebookEditor.notebook.notebookType
            ),
        timeout,
        `No matching controller found for metadata ${metadata?.kind}:${metadata.id}`
    );
    if (!controller) {
        throw new Error('No interpreter controller');
    }
    await commands.executeCommand('notebook.selectKernel', {
        id: controller.id,
        extension: JVSC_EXTENSION_ID
    });
    await waitForCondition(
        () => controllerRegistration.getSelected(notebookEditor.notebook)?.id === controller.id,
        timeout,
        `Controller ${
            controller.id
        } not selected for ${notebookEditor.notebook.uri.toString()}, currently selected ${controllerRegistration.getSelected(
            notebookEditor.notebook
        )?.id} (2)`
    );
}
export async function waitForKernelToGetAutoSelected(
    notebookEditor: NotebookEditor,
    expectedLanguage: string,
    timeout = 100_000,
    skipAutoSelection: boolean = false
) {
    const { controllerRegistration } = await getServices();
    let lastLoadedControllerCount = controllerRegistration.all.length;
    let lastError: Error | undefined;
    await waitForCondition(
        async () => {
            // Wait for controllers to get loaded.
            // Now that we're lazy loading the controllers, we need to wait for the controllers to get loaded.
            await waitForCondition(
                async () => controllerRegistration.all.length > lastLoadedControllerCount,
                1000,
                () =>
                    `No new controllers loaded, currently loaded ${controllerRegistration.all
                        .map((item) => `${item.kind}:${item.id}`)
                        .join(',')}`,
                100,
                false
            ).catch(noop);
            lastLoadedControllerCount = controllerRegistration.all.length;

            // Try the test.
            try {
                await waitForKernelToGetAutoSelectedImpl(notebookEditor, expectedLanguage, timeout, skipAutoSelection);
                return true;
            } catch (ex) {
                lastError = ex;
                return false;
            }
        },
        timeout,
        () => `Kernel not selected, last error ${lastError}`,
        100
    );
}
export async function waitForKernelToGetAutoSelectedImpl(
    notebookEditor?: NotebookEditor,
    expectedLanguage?: string,
    timeout = 100_000,
    skipAutoSelection: boolean = false
) {
    traceInfoIfCI('Wait for kernel to get auto selected');
    const { controllerRegistration, controllerPreferred, interpreterService, isWebExtension } = await getServices();
    const useRemoteKernelSpec = IS_REMOTE_NATIVE_TEST() || isWebExtension; // Web is only remote

    // Wait for the active editor to come up
    notebookEditor = await waitForActiveNotebookEditor(notebookEditor);

    traceInfoIfCI(`Wait for kernel - got notebook controllers`);
    const notebookControllers = controllerRegistration.registered;

    // Make sure we don't already have a selection (this function gets run even after opening a document)
    if (controllerRegistration.getSelected(notebookEditor.notebook)) {
        return;
    }

    const searchCriteria = async () => {
        // We don't have one, try to find the preferred one
        let preferred: IVSCodeNotebookController | undefined;

        // Wait for one of them to have affinity as the preferred (this may not happen)
        await controllerPreferred.computePreferred(notebookEditor!.notebook);
        preferred = controllerPreferred.getPreferred(notebookEditor!.notebook);
        if (!preferred) {
            traceInfoIfCI(`Did not find a controller with document affinity`);
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
            traceInfoIfCI(`Manually pick a preferred kernel from all kernel specs`);
            const matches = notebookControllers.filter(
                (d) =>
                    d.connection.kind != 'connectToLiveRemoteKernel' &&
                    language === d.connection.kernelSpec?.language?.toLowerCase() &&
                    (!useRemoteKernelSpec || d.connection.kind.includes('Remote'))
            );

            const activeInterpreter = await interpreterService?.getActiveInterpreter(notebookEditor!.notebook.uri);
            traceInfoIfCI(
                `Attempt to find a kernel that matches the active interpreter ${activeInterpreter?.uri.path}`
            );
            traceInfoIfCI(
                `Matches: ${matches
                    .map((m) => m.connection.kind + ', ' + m.connection.interpreter?.uri.path)
                    .join('\n ')}`
            );

            match =
                matches.find(
                    (d) =>
                        d.connection.kind === 'startUsingPythonInterpreter' &&
                        d.connection.interpreter &&
                        activeInterpreter &&
                        areInterpreterPathsSame(d.connection.interpreter.uri, activeInterpreter.uri)
                ) ?? matches[0];
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
        return { labelOrId: match!.id };
    };
    return waitForKernelToChange(searchCriteria, notebookEditor!, timeout, skipAutoSelection);
}

const prewarmNotebooksDone = { done: false };
export async function prewarmNotebooks() {
    if (prewarmNotebooksDone.done) {
        return;
    }
    const { vscodeNotebook, serviceContainer } = await getServices();
    await closeActiveWindows();

    const disposables: IDisposable[] = [];
    try {
        // Ensure preferred language is always Python.
        const memento = serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
        if (memento.get(LastSavedNotebookCellLanguage) !== PYTHON_LANGUAGE) {
            await memento.update(LastSavedNotebookCellLanguage, PYTHON_LANGUAGE);
        }
        const notebookEditor = await createNewNotebook();
        await insertCodeCell('print("Hello World1")', { index: 0 });
        await selectDefaultController(notebookEditor, defaultNotebookTestTimeout);
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

export async function createNewNotebook() {
    // contents will be ignored
    const language = PYTHON_LANGUAGE;
    const cell = new NotebookCellData(NotebookCellKind.Code, '', language);
    const data = new NotebookData([cell]);
    data.metadata = {
        custom: {
            cells: [],
            metadata: <nbformat.INotebookMetadata>{
                language_info: {
                    name: language
                }
            },
            nbformat: defaultNotebookFormat.major,
            nbformat_minor: defaultNotebookFormat.minor
        }
    };
    const doc = await workspace.openNotebookDocument(JupyterNotebookView, data);
    return window.showNotebookDocument(doc);
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
            `Cell ${cell.index + 1} did not complete successfully, State = ${NotebookCellStateTracker.getCellStatus(
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
                `Cell ${cell.index + 1} did not complete successfully, State = ${NotebookCellStateTracker.getCellStatus(
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
            `Cell ${cell.index + 1} not queued for execution, current state is ${NotebookCellStateTracker.getCellStatus(
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
            } not queued for execution nor already executing, current state is ${NotebookCellStateTracker.getCellStatus(
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
        () => `Cell ${cell.index + 1} did not complete, State = ${NotebookCellStateTracker.getCellStatus(cell)}`
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
        () =>
            `Cell ${cell.index + 1} did not fail as expected, State =  ${NotebookCellStateTracker.getCellStatus(cell)}`
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
            } in output index ${index}, the outputs are: \n${cell.outputs
                .map(
                    (output, index) =>
                        `${index}. Output for Index "${index}" with total outputs ${
                            output.items.length
                        } is "${output.items.map(getOutputText).join('\n')}"`
                )
                .join(',\n')}`
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
export async function runCell(cell: NotebookCell, waitForExecutionToComplete = false, language = PYTHON_LANGUAGE) {
    const api = await initialize();
    const vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    const notebookEditor = vscodeNotebook.notebookEditors.find((e) => e.notebook === cell.notebook);
    await waitForKernelToGetAutoSelected(notebookEditor!, language, 60_000);
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
    activeEditor: NotebookEditor | undefined = undefined,
    language: string = PYTHON_LANGUAGE
) {
    const api = await initialize();
    const vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    await waitForKernelToGetAutoSelected(activeEditor!, language, 60_000);

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
    dispose: () => void;
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
    promptType: 'showErrorMessage' | 'showInformationMessage' | 'showWarningMessage',
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
        timeout,
        `waitForDebugEvent: ${eventType}`
    ) as Promise<T>;
}

export async function waitForStoppedEvent(debugAdapter: IKernelDebugAdapter): Promise<DebugProtocol.StoppedEvent> {
    assert.ok(debugAdapter, `No debug adapter when waiting for stopped event`);
    return waitForDebugEvent('stopped', debugAdapter, 10_000);
}

export async function getDebugSessionAndAdapter(
    debuggingManager: IDebuggingManager,
    doc: NotebookDocument,
    prevSessionId?: string
): Promise<{ session: DebugSession; debugAdapter: IKernelDebugAdapter }> {
    await waitForCondition(
        async () =>
            !!debuggingManager.getDebugSession(doc) &&
            (!prevSessionId || prevSessionId !== debuggingManager.getDebugSession(doc)?.id),
        defaultNotebookTestTimeout,
        'DebugSession should start'
    );
    const session = debuggingManager.getDebugSession(doc)!;

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
        if (message === DataScience.restartKernelMessage) {
            traceInfo(`Step 3. ShowInformationMessage & yes to restart`);
            // User clicked ok to restart it.
            return DataScience.restartKernelMessageYes;
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
