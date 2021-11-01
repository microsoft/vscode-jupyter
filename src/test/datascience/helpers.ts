// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { assert } from 'chai';
import { noop } from 'lodash';
import * as vscode from 'vscode';
import { traceInfo } from '../../client/common/logger';
import { IJupyterSettings } from '../../client/common/types';
import { InteractiveWindow } from '../../client/datascience/interactive-window/interactiveWindow';
import { InteractiveWindowProvider } from '../../client/datascience/interactive-window/interactiveWindowProvider';
import { IInteractiveWindowProvider } from '../../client/datascience/types';
import {
    createTemporaryFile,
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
        collapseCellInputCodeByDefault: true,
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

export async function waitForLastCellToComplete(interactiveWindow: InteractiveWindow, errorsOkay?: boolean) {
    const notebookDocument = vscode.workspace.notebookDocuments.find(
        (doc) => doc.uri.toString() === interactiveWindow?.notebookUri?.toString()
    );
    const cells = notebookDocument?.getCells();
    assert.ok(notebookDocument !== undefined, 'Interactive window notebook document not found');
    let codeCell: vscode.NotebookCell | undefined;
    for (let i = cells!.length - 1; i >= 0; i -= 1) {
        if (cells![i].kind === vscode.NotebookCellKind.Code) {
            codeCell = cells![i];
            break;
        }
    }
    assert.ok(codeCell !== undefined, 'No code cell found in interactive window notebook document');
    if (errorsOkay) {
        await waitForCellExecutionToComplete(codeCell!);
    } else {
        await waitForExecutionCompletedSuccessfully(codeCell!);
    }
    return codeCell!;
}
