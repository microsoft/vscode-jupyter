// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable local-rules/dont-use-fspath */

import { assert } from 'chai';
import * as vscode from 'vscode';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { traceError, traceInfo, traceInfoIfCI, traceVerbose } from '../../platform/logging';
import { IPythonApiProvider } from '../../platform/api/types';
import { IJupyterSettings, Resource } from '../../platform/common/types';
import { InteractiveWindow } from '../../interactive-window/interactiveWindow';
import { InteractiveWindowProvider } from '../../interactive-window/interactiveWindowProvider';
import { createTemporaryFile, initialize, waitForCondition } from '../common';
import {
    defaultNotebookTestTimeout,
    waitForCellExecutionToComplete,
    waitForExecutionCompletedSuccessfully
} from './notebook/helper';
import { IDataScienceCodeLensProvider } from '../../interactive-window/editor-integration/types';
import { IInteractiveWindowProvider, IInteractiveWindow } from '../../interactive-window/types';
import { Commands } from '../../platform/common/constants';
import { noop, sleep } from '../core';
import { arePathsSame } from '../../platform/common/platform/fileUtils';
import { IS_REMOTE_NATIVE_TEST } from '../constants';
import { isWeb } from '../../platform/common/utils/misc';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { Matcher } from 'ts-mockito/lib/matcher/type/Matcher';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { isEqual } from '../../platform/vscode-path/resources';
import { IWorkspaceService } from '../../platform/common/application/types';

export async function openNotebook(ipynbFile: vscode.Uri) {
    traceInfo(`Opening notebook ${getFilePath(ipynbFile)}`);
    const notebook = await vscode.workspace.openNotebookDocument(ipynbFile);
    const editor = await vscode.window.showNotebookDocument(notebook);
    traceInfo(`Opened notebook ${getFilePath(ipynbFile)}`);
    return { notebook, editor };
}

// The default base set of data science settings to use
export function defaultDataScienceSettings(): IJupyterSettings {
    return {
        logging: {
            level: 'off'
        },
        experiments: {
            enabled: false,
            optOutFrom: [],
            optInto: []
        },
        jupyterLaunchTimeout: 10,
        jupyterLaunchRetries: 3,
        // eslint-disable-next-line no-template-curly-in-string
        notebookFileRoot: '${fileDirname}',
        useDefaultConfigForJupyter: true,
        jupyterInterruptTimeout: 10000,
        searchForJupyter: true,
        errorBackgroundColor: '#FFFFFF',
        sendSelectionToInteractiveWindow: false,
        variableExplorerExclude: 'module;function;builtin_function_or_method',
        codeRegularExpression: '^(#\\s*%%|#\\s*\\<codecell\\>|#\\s*In\\[\\d*?\\]|#\\s*In\\[ \\])',
        markdownRegularExpression: '^(#\\s*%%\\s*\\[markdown\\]|#\\s*\\<markdowncell\\>)',
        generateSVGPlots: false,
        runStartupCommands: '',
        debugJustMyCode: true,
        variableQueries: [],
        jupyterCommandLineArguments: [],
        widgetScriptSources: [],
        interactiveWindowMode: 'single'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

export function takeSnapshot() {
    // If you're investigating memory leaks in the tests, using the node-memwatch
    // code below can be helpful. It will at least write out what objects are taking up the most
    // memory.
    // Alternatively, using the test:functional:memleak task and sticking breakpoints here and in
    // writeDiffSnapshot can be used as convenient locations to create heap snapshots and diff them.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    //const memwatch = require('@raghb1/node-memwatch');
    return {}; //new memwatch.HeapDiff();
}

//let snapshotCounter = 1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeDiffSnapshot(_snapshot: any, _prefix: string) {
    noop(); // Stick breakpoint here when generating heap snapshots
    // const diff = snapshot.end();
    // const file = path.join(EXTENSION_ROOT_DIR, 'temp', `SD-${snapshotCounter}-${prefix}.json`);
    // snapshotCounter += 1;
    // fs.writeFile(file, JSON.stringify(diff), { encoding: 'utf-8' }).catch(noop);
}

export async function createStandaloneInteractiveWindow(interactiveWindowProvider: InteractiveWindowProvider) {
    const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(undefined)) as InteractiveWindow;
    await waitForInteractiveWindow(activeInteractiveWindow);
    return activeInteractiveWindow;
}

// Add code to the input box
export async function insertIntoInputEditor(source: string, interactiveWindow?: InteractiveWindow) {
    let inputBox: vscode.TextEditor | undefined;
    if (interactiveWindow) {
        inputBox = vscode.window.visibleTextEditors.find(
            (e) => e.document.uri.path === interactiveWindow.inputUri.path
        );
        if (!inputBox) {
            traceError(
                `couldn't find input box ${interactiveWindow.inputUri.path} in visible text editors ${JSON.stringify(
                    vscode.window.visibleTextEditors.map((e) => e.document.uri.path)
                )}`
            );
        }
    }
    if (!inputBox) {
        await vscode.commands.executeCommand('interactive.input.focus');
        inputBox = vscode.window.activeTextEditor;
    }

    assert(inputBox, 'No active text editor for IW input');

    await inputBox!.edit((editBuilder) => {
        editBuilder.insert(new vscode.Position(0, 0), source);
    });
    return vscode.window.activeTextEditor;
}

export async function setActiveInterpreter(
    apiProvider: IPythonApiProvider,
    resource: Resource,
    interpreter: vscode.Uri | undefined
) {
    if (interpreter) {
        const [pythonApi, api] = await Promise.all([apiProvider.getNewApi(), initialize()]);
        // if we have one workspace, then use the Uri of the workspace folder.
        const workspace = api.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        resource = workspace.workspaceFolders?.length === 1 ? workspace.workspaceFolders[0].uri : resource;
        await pythonApi?.environments.updateActiveEnvironmentPath(getFilePath(interpreter), resource);
    }
}

export async function submitFromPythonFile(
    interactiveWindowProvider: IInteractiveWindowProvider,
    source: string,
    disposables: vscode.Disposable[],
    apiProvider?: IPythonApiProvider,
    activeInterpreterPath?: vscode.Uri
) {
    const api = await initialize();
    const tempFile = await createTemporaryFile({ contents: source, extension: '.py' });
    disposables.push(tempFile);
    const untitledPythonFile = await vscode.workspace.openTextDocument(tempFile.file);
    await vscode.window.showTextDocument(untitledPythonFile);
    if (apiProvider && activeInterpreterPath) {
        const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        await setActiveInterpreter(apiProvider, untitledPythonFile.uri, activeInterpreterPath);
        await interpreterService.refreshInterpreters();
        const interpreter = await interpreterService.getActiveInterpreter();
        assert.ok(
            isEqual(interpreter?.uri, activeInterpreterPath),
            `Active interpreter not set, actual ${interpreter?.uri.fsPath}, expected ${activeInterpreterPath}`
        );
    }
    const activeInteractiveWindow = await runCurrentFile(interactiveWindowProvider, untitledPythonFile);
    const notebook = await waitForInteractiveWindow(activeInteractiveWindow);
    await verifySelectedControllerIsRemoteForRemoteTests(notebook);
    return { activeInteractiveWindow, untitledPythonFile };
}

export async function submitFromPythonFileUsingCodeWatcher(
    source: string,
    disposables: vscode.Disposable[],
    activeInterpreterPath?: vscode.Uri
) {
    const api = await initialize();
    const interactiveWindowProvider = api.serviceManager.get<IInteractiveWindowProvider>(IInteractiveWindowProvider);
    const codeWatcherProvider = api.serviceManager.get<IDataScienceCodeLensProvider>(IDataScienceCodeLensProvider);
    const tempFile = await createTemporaryFile({ contents: source, extension: '.py' });
    disposables.push(tempFile);
    const untitledPythonFile = await vscode.workspace.openTextDocument(tempFile.file);
    const editor = await vscode.window.showTextDocument(untitledPythonFile);
    if (activeInterpreterPath) {
        const pythonApiProvider = api.serviceManager.get<IPythonApiProvider>(IPythonApiProvider);
        const pythonApi = await pythonApiProvider.getNewApi();
        await pythonApi?.environments.updateActiveEnvironmentPath(activeInterpreterPath.fsPath, untitledPythonFile.uri);
    }
    const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(
        untitledPythonFile.uri
    )) as InteractiveWindow;
    await waitForInteractiveWindow(activeInteractiveWindow);
    const codeWatcher = codeWatcherProvider.getCodeWatcher(editor.document);
    void codeWatcher?.runAllCells(); // Dont wait for execution to complete
    return { activeInteractiveWindow, untitledPythonFile };
}

export async function runNewPythonFile(
    interactiveWindowProvider: IInteractiveWindowProvider,
    source: string,
    disposables: vscode.Disposable[]
) {
    const tempFile = await createTemporaryFile({ contents: source, extension: '.py' });
    disposables.push(tempFile);
    const untitledPythonFile = await vscode.workspace.openTextDocument(tempFile.file);
    const activeInteractiveWindow = await runCurrentFile(interactiveWindowProvider, untitledPythonFile);
    return { activeInteractiveWindow, untitledPythonFile };
}

export async function runCurrentFile(interactiveWindowProvider: IInteractiveWindowProvider, file: vscode.TextDocument) {
    await vscode.window.showTextDocument(file, vscode.ViewColumn.One);
    const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(file.uri)) as InteractiveWindow;
    await waitForInteractiveWindow(activeInteractiveWindow);
    await vscode.commands.executeCommand(Commands.RunFileInInteractiveWindows, file.uri);
    return activeInteractiveWindow;
}

export async function closeInteractiveWindow(interactiveWindow: IInteractiveWindow) {
    if (interactiveWindow.notebookDocument) {
        const editor = vscode.window.visibleNotebookEditors.find(
            (n) => n.notebook === interactiveWindow.notebookDocument
        );
        if (editor) {
            await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
            await vscode.commands.executeCommand('interactive.input.focus');
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await sleep(500); // Seems to be some flakiness in VS code closing a window.
        }
        interactiveWindow.dispose();
    }
}

export async function waitForInteractiveWindow(
    interactiveWindow: IInteractiveWindow
): Promise<vscode.NotebookDocument> {
    let notebookDocument: vscode.NotebookDocument | undefined;
    await waitForCondition(
        async () => {
            notebookDocument = vscode.workspace.notebookDocuments.find(
                (doc) => doc.uri.toString() === interactiveWindow?.notebookUri?.toString()
            );
            let inputBox = vscode.window.visibleTextEditors.find(
                (e) => e.document.uri.path === interactiveWindow?.inputUri?.path
            );
            traceVerbose(
                `Waiting for Interactive Window '${interactiveWindow.notebookUri?.toString()}',`,
                `found notebook '${notebookDocument?.uri.toString()}' and input '${inputBox?.document.uri.toString()}'`
            );
            return !!notebookDocument && !!inputBox;
        },
        defaultNotebookTestTimeout,
        'Interactive window notebook document not found'
    );

    return notebookDocument!;
}

export async function runInteractiveWindowInput(
    code: string,
    interactiveWindow: InteractiveWindow,
    newCellCount: number
) {
    await insertIntoInputEditor(code, interactiveWindow);
    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await vscode.commands.executeCommand('interactive.input.focus');
    await vscode.commands.executeCommand('interactive.execute');
    return waitForLastCellToComplete(interactiveWindow, newCellCount, false);
}

export async function waitForLastCellToComplete(
    interactiveWindow: InteractiveWindow,
    numberOfCells: number = -1,
    errorsOkay?: boolean
) {
    const notebookDocument = await waitForInteractiveWindow(interactiveWindow);
    let codeCell: vscode.NotebookCell | undefined;
    let codeCells: vscode.NotebookCell[] = [];
    await waitForCondition(
        async () => {
            codeCells = notebookDocument?.getCells().filter((c) => c.kind === vscode.NotebookCellKind.Code);
            codeCell = codeCells && codeCells.length ? codeCells[codeCells.length - 1] : undefined;
            return codeCell && (numberOfCells === -1 || numberOfCells === codeCells!.length) ? true : false;
        },
        defaultNotebookTestTimeout,
        `No code cell found in interactive window notebook document`
    );
    if (errorsOkay) {
        await waitForCellExecutionToComplete(codeCell!);
    } else {
        await waitForExecutionCompletedSuccessfully(codeCell!);
    }
    traceInfoIfCI(`finished waiting for last cell to complete of ${codeCells.length} cells`);
    return codeCell!;
}

export async function waitForCodeLenses(document: vscode.Uri, command: string) {
    // First make sure the editor has focus
    const selection = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
    let editor = vscode.window.visibleTextEditors.find((e) => arePathsSame(e.document.uri.fsPath, document.fsPath));
    if (editor) {
        await vscode.window
            .showTextDocument(editor.document, { selection, viewColumn: editor.viewColumn })
            .then((e) => {
                e.revealRange(selection, vscode.TextEditorRevealType.InCenter);
            });
    }

    let codeLenses: vscode.CodeLens[] = [];
    // Wait for the code lens to appear
    await waitForCondition(
        async () => {
            const textDocument = await vscode.workspace.openTextDocument(document);
            await vscode.window.showTextDocument(textDocument, undefined, false);
            codeLenses = (await vscode.commands.executeCommand(
                'vscode.executeCodeLensProvider',
                document
            )) as vscode.CodeLens[];
            return (
                codeLenses &&
                codeLenses.length > 0 &&
                codeLenses.find((c) => c.command?.command === command) != undefined
            );
        },
        defaultNotebookTestTimeout,
        `Code lens with command ${command} not found`
    );

    traceInfoIfCI(`Found code lenses with command ${command}`);
    return codeLenses;
}

export async function verifySelectedControllerIsRemoteForRemoteTests(notebook?: vscode.NotebookDocument) {
    if (!IS_REMOTE_NATIVE_TEST() || !isWeb()) {
        return;
    }
    notebook = notebook || vscode.window.activeNotebookEditor!.notebook;
    const api = await initialize();
    const controller = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration).getSelected(notebook);
    if (!controller) {
        return;
    }
    if (
        controller.connection.kind !== 'connectToLiveRemoteKernel' &&
        controller.connection.kind !== 'startUsingRemoteKernelSpec'
    ) {
        assert.fail(
            `Notebook Controller is not a remote controller, it is ${controller.connection.kind}:${controller.id}`
        );
    }
}

export function uriEquals(expected: string | vscode.Uri) {
    class UriMatcher extends Matcher {
        constructor(private readonly expectedUri: vscode.Uri) {
            super();
        }
        override match(value: vscode.Uri): boolean {
            return arePathsSame(getFilePath(value), getFilePath(this.expectedUri));
        }
    }
    return new UriMatcher(typeof expected === 'string' ? vscode.Uri.file(expected) : expected) as unknown as vscode.Uri;
}
