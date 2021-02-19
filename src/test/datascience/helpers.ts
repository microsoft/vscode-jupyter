// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { noop } from 'lodash';
import * as path from 'path';
import { Uri } from 'vscode';
import { ICommandManager } from '../../client/common/application/types';
import { traceInfo } from '../../client/common/logger';
import { IJupyterSettings } from '../../client/common/types';
import { Commands } from '../../client/datascience/constants';
import {
    AskForSaveResult,
    NativeEditorOldWebView
} from '../../client/datascience/interactive-ipynb/nativeEditorOldWebView';
import { INotebookEditorProvider } from '../../client/datascience/types';
import { IServiceContainer } from '../../client/ioc/types';
import { CommandSource } from '../../client/testing/common/constants';
import { waitForCondition } from '../common';
import { trustNotebook } from './notebook/helper';

// The default base set of data science settings to use
export function defaultDataScienceSettings(): IJupyterSettings {
    return {
        logging: {
            level: 'off'
        },
        insidersChannel: 'off',
        experiments: {
            enabled: false,
            optOutFrom: [],
            optInto: []
        },
        allowImportFromNotebook: true,
        alwaysTrustNotebooks: true,
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
        enablePlotViewer: true,
        runStartupCommands: '',
        debugJustMyCode: true,
        variableQueries: [],
        codeLensExpressions : [
            {
              "language": "python",
              "codeExpression": "^(#\\s*%%|#\\s*\\<codecell\\>|#\\s*In\\[\\d*?\\]|#\\s*In\\[ \\])",
              "markdownExpression": "^(#\\s*%%\\s*\\[markdown\\]|#\\s*\\<markdowncell\\>)",
              "defaultCellMarker" : "# %%"
            },
            {
                "language": "markdown",
                "codeExpression": "^(```python|```\\{code-cell\\}\\s+ipython)",
                "markdownExpression": "^(```)",
                "defaultCellMarker" : "```python"
            }
        ],
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

export async function openNotebook(
    serviceContainer: IServiceContainer,
    ipynbFile: string,
    options: { ignoreSavingOldNotebooks?: boolean; isNotTrusted?: boolean } = { ignoreSavingOldNotebooks: true }
) {
    if (!options.isNotTrusted) {
        traceInfo(`Trust notebook before opening ${ipynbFile}`);
        await trustNotebook(ipynbFile);
    }
    traceInfo(`Opening notebook ${ipynbFile}`);
    const cmd = serviceContainer.get<ICommandManager>(ICommandManager);
    await cmd.executeCommand(Commands.OpenNotebook, Uri.file(ipynbFile), undefined, CommandSource.commandPalette);
    const editorProvider = serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
    traceInfo('Wait for notebook to be the active editor');
    await waitForCondition(
        async () =>
            editorProvider.editors.length > 0 &&
            !!editorProvider.activeEditor &&
            editorProvider.activeEditor.file.fsPath.endsWith(path.basename(ipynbFile)),
        30_000,
        'Notebook not opened'
    );

    if (
        options.ignoreSavingOldNotebooks &&
        editorProvider.activeEditor &&
        editorProvider.activeEditor instanceof NativeEditorOldWebView
    ) {
        // We don't care about changes, no need to save them.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (editorProvider.activeEditor as any).askForSave = () => Promise.resolve(AskForSaveResult.No);
    }
    traceInfo(`Opened notebook ${ipynbFile} & trusted= ${editorProvider.activeEditor?.model.isTrusted}`);
}
