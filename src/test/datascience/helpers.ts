// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { assert } from 'chai';
import { noop } from 'lodash';
import * as vscode from 'vscode';
import { traceInfo } from '../../client/common/logger';
import { IJupyterSettings } from '../../client/common/types';
import { Commands } from '../../client/datascience/constants';
import { InteractiveWindow } from '../../client/datascience/interactive-window/interactiveWindow';
import { InteractiveWindowProvider } from '../../client/datascience/interactive-window/interactiveWindowProvider';
import { IDataScienceCodeLensProvider, IInteractiveWindowProvider } from '../../client/datascience/types';
import { arePathsSame, waitForCondition } from '../common';
import {
    createTemporaryFile,
    defaultNotebookTestTimeout,
    waitForCellExecutionToComplete,
    waitForExecutionCompletedSuccessfully
} from './notebook/helper';

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
        allowImportFromNotebook: true,
        jupyterLaunchTimeout: 10,
        jupyterLaunchRetries: 3,
        jupyterServerType: 'local',
        // eslint-disable-next-line no-template-curly-in-string
        notebookFileRoot: '${fileDirname}',
        changeDirOnImportExport: false,
        useDefaultConfigForJupyter: true,
        jupyterInterruptTimeout: 10000,
        searchForJupyter: true,
        showCellInputCode: true,
        allowInput: true,
        maxOutputSize: 400,
        enableScrollingForCellOutputs: true,
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
    // const file = path.join(EXTENSION_ROOT_DIR, 'tmp', `SD-${snapshotCounter}-${prefix}.json`);
    // snapshotCounter += 1;
    // fs.writeFile(file, JSON.stringify(diff), { encoding: 'utf-8' }).ignoreErrors();
}

export async function openNotebook(ipynbFile: string) {
    traceInfo(`Opening notebook ${ipynbFile}`);
    const uri = vscode.Uri.file(ipynbFile);
    const nb = await vscode.workspace.openNotebookDocument(uri);
    await vscode.window.showNotebookDocument(nb);
    traceInfo(`Opened notebook ${ipynbFile}`);
    return nb;
}

export async function createStandaloneInteractiveWindow(interactiveWindowProvider: InteractiveWindowProvider) {
    const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(undefined)) as InteractiveWindow;
    return activeInteractiveWindow;
}

export async function insertIntoInputEditor(source: string) {
    // Add code to the input box
    await vscode.window.activeTextEditor?.edit((editBuilder) => {
        editBuilder.insert(new vscode.Position(0, 0), source);
    });
    return vscode.window.activeTextEditor;
}

export async function submitFromPythonFile(
    interactiveWindowProvider: IInteractiveWindowProvider,
    source: string,
    disposables: vscode.Disposable[]
) {
    const tempFile = await createTemporaryFile({ contents: source, extension: '.py' });
    disposables.push(tempFile);
    const untitledPythonFile = await vscode.workspace.openTextDocument(tempFile.file);
    await vscode.window.showTextDocument(untitledPythonFile);
    const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(
        untitledPythonFile.uri
    )) as InteractiveWindow;
    await activeInteractiveWindow.addCode(source, untitledPythonFile.uri, 0);
    return { activeInteractiveWindow, untitledPythonFile };
}

export async function submitFromPythonFileUsingCodeWatcher(
    interactiveWindowProvider: IInteractiveWindowProvider,
    codeWatcherProvider: IDataScienceCodeLensProvider,
    source: string,
    disposables: vscode.Disposable[]
) {
    const tempFile = await createTemporaryFile({ contents: source, extension: '.py' });
    disposables.push(tempFile);
    const untitledPythonFile = await vscode.workspace.openTextDocument(tempFile.file);
    const editor = await vscode.window.showTextDocument(untitledPythonFile);
    const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(
        untitledPythonFile.uri
    )) as InteractiveWindow;
    const codeWatcher = codeWatcherProvider.getCodeWatcher(editor.document);
    void codeWatcher?.runAllCells(); // Dont wait for execution to complete
    return { activeInteractiveWindow, untitledPythonFile };
}

export async function runCurrentFile(
    interactiveWindowProvider: IInteractiveWindowProvider,
    source: string,
    disposables: vscode.Disposable[]
) {
    const tempFile = await createTemporaryFile({ contents: source, extension: '.py' });
    disposables.push(tempFile);
    const untitledPythonFile = await vscode.workspace.openTextDocument(tempFile.file);
    await vscode.window.showTextDocument(untitledPythonFile);
    const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(
        untitledPythonFile.uri
    )) as InteractiveWindow;
    await vscode.commands.executeCommand(Commands.RunFileInInteractiveWindows, untitledPythonFile.uri);
    return { activeInteractiveWindow, untitledPythonFile };
}

export async function waitForLastCellToComplete(
    interactiveWindow: InteractiveWindow,
    numberOfCells: number = -1,
    errorsOkay?: boolean
) {
    const notebookDocument = vscode.workspace.notebookDocuments.find(
        (doc) => doc.uri.toString() === interactiveWindow?.notebookUri?.toString()
    );
    assert.ok(notebookDocument !== undefined, 'Interactive window notebook document not found');

    let codeCell: vscode.NotebookCell | undefined;
    await waitForCondition(
        async () => {
            const codeCells = notebookDocument?.getCells().filter((c) => c.kind === vscode.NotebookCellKind.Code);
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

    return codeLenses;
}
