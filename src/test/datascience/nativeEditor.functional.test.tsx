// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { assert, expect, use } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as dedent from 'dedent';
import { ReactWrapper } from 'enzyme';
import * as fs from 'fs-extra';
import { IDisposable } from 'monaco-editor';
import * as path from 'path';
import * as sinon from 'sinon';
import { anything, objectContaining, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { CustomEditorProvider, Disposable, TextDocument, TextEditor, Uri, WindowState } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import {
    IApplicationShell,
    ICommandManager,
    ICustomEditorService,
    IDocumentManager,
    IWorkspaceService
} from '../../client/common/application/types';
import { IFileSystem } from '../../client/common/platform/types';
import { ICryptoUtils, IExtensionContext } from '../../client/common/types';
import { createDeferred, sleep, waitForPromise } from '../../client/common/utils/async';
import { noop } from '../../client/common/utils/misc';
import { Commands, Identifiers } from '../../client/datascience/constants';
import { InteractiveWindowMessages } from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { NativeEditor as NativeEditorWebView } from '../../client/datascience/interactive-ipynb/nativeEditor';
import { IKernelSpecQuickPickItem } from '../../client/datascience/jupyter/kernels/types';
import { KeyPrefix } from '../../client/datascience/notebookStorage/nativeEditorStorage';
import { NativeEditorNotebookModel } from '../../client/datascience/notebookStorage/notebookModel';
import {
    ICell,
    IDataScienceErrorHandler,
    IJupyterExecution,
    INotebookEditor,
    INotebookEditorProvider,
    INotebookExporter,
    ITrustService
} from '../../client/datascience/types';
import { concatMultilineString } from '../../datascience-ui/common';
import { Editor } from '../../datascience-ui/interactive-common/editor';
import { ExecutionCount } from '../../datascience-ui/interactive-common/executionCount';
import { CommonActionType } from '../../datascience-ui/interactive-common/redux/reducers/types';
import { NativeCell } from '../../datascience-ui/native-editor/nativeCell';
import { NativeEditor } from '../../datascience-ui/native-editor/nativeEditor';
import { IKeyboardEvent } from '../../datascience-ui/react-common/event';
import { ImageButton } from '../../datascience-ui/react-common/imageButton';
import { IMonacoEditorState, MonacoEditor } from '../../datascience-ui/react-common/monacoEditor';
import { waitForCondition } from '../common';
import { createTemporaryFile } from '../utils/fs';
import { DataScienceIocContainer } from './dataScienceIocContainer';
import { MockCustomEditorService } from './mockCustomEditorService';
import { MockDocumentManager } from './mockDocumentManager';
import { IMountedWebView, WaitForMessageOptions } from './mountedWebView';
import {
    addCell,
    closeNotebook,
    createNewEditor,
    getNativeCellResults,
    openEditor,
    runMountedTest
} from './nativeEditorTestHelpers';
import { createPythonService, startRemoteServer } from './remoteTestHelpers';
import {
    addContinuousMockData,
    addMockData,
    CellPosition,
    enterEditorKey,
    escapePath,
    findButton,
    getLastOutputCell,
    getNativeFocusedEditor,
    getOutputCell,
    injectCode,
    isCellFocused,
    isCellMarkdown,
    isCellSelected,
    srcDirectory,
    typeCode,
    verifyCellIndex,
    verifyCellSource,
    verifyHtmlOnCell,
    verifyServerStatus
} from './testHelpers';
import { ITestNativeEditorProvider } from './testNativeEditorProvider';

use(chaiAsPromised);

/* eslint-disable , comma-dangle, @typescript-eslint/no-explicit-any, no-multi-str, no-invalid-this */
async function updateFileConfig(ioc: DataScienceIocContainer, key: string, value: any) {
    return ioc.get<IWorkspaceService>(IWorkspaceService).getConfiguration('file').update(key, value);
}
function waitForMessage(ioc: DataScienceIocContainer, message: string, options?: WaitForMessageOptions): Promise<void> {
    return ioc.getNativeWebPanel(undefined).waitForMessage(message, options);
}
suite('DataScience Native Editor', () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(
        window.navigator,
        'platform',
        ((value: string) => {
            return {
                get: () => value,
                set: (v: string) => (value = v)
            };
        })(originalPlatform)
    );

    [false, true].forEach((useCustomEditorApi) => {
        //import { asyncDump } from '../common/asyncDump';
        suite(`${useCustomEditorApi ? 'With' : 'Without'} Custom Editor API`, () => {
            function createFileCell(cell: any, data: any): ICell {
                const newCell = {
                    type: 'preview',
                    id: 'FakeID',
                    file: Identifiers.EmptyFileName,
                    line: 0,
                    state: 2,
                    ...cell
                };
                newCell.data = {
                    cell_type: 'code',
                    execution_count: null,
                    metadata: {},
                    outputs: [],
                    source: '',
                    ...data
                };

                return newCell;
            }
            suite('Editor tests', () => {
                const disposables: Disposable[] = [];
                let ioc: DataScienceIocContainer;
                let tempNotebookFile: {
                    filePath: string;
                    cleanupCallback: Function;
                };

                setup(async function () {
                    console.log(`Start Test ${this.currentTest?.title}`);
                    ioc = new DataScienceIocContainer();
                    ioc.registerDataScienceTypes(useCustomEditorApi);
                    await ioc.activate();

                    const appShell = TypeMoq.Mock.ofType<IApplicationShell>();
                    appShell
                        .setup((a) => a.showErrorMessage(TypeMoq.It.isAnyString()))
                        .returns((_e) => Promise.resolve(''));
                    appShell
                        .setup((a) => a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                        .returns(() => Promise.resolve(''));
                    appShell
                        .setup((a) =>
                            a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny())
                        )
                        .returns((_a1: string, a2: string, _a3: string) => Promise.resolve(a2));
                    appShell
                        .setup((a) =>
                            a.showInformationMessage(
                                TypeMoq.It.isAny(),
                                TypeMoq.It.isAny(),
                                TypeMoq.It.isAny(),
                                TypeMoq.It.isAny()
                            )
                        )
                        .returns((_a1: string, _a2: any, _a3: string, a4: string) => Promise.resolve(a4));
                    appShell
                        .setup((a) => a.showSaveDialog(TypeMoq.It.isAny()))
                        .returns(() => Promise.resolve(Uri.file('foo.ipynb')));
                    ioc.serviceManager.rebindInstance<IApplicationShell>(IApplicationShell, appShell.object);
                    tempNotebookFile = await createTemporaryFile('.ipynb');
                    // Stub trustService.isNotebookTrusted. Some tests do not write to storage,
                    // so explicitly calling trustNotebook on the tempNotebookFile doesn't work
                    try {
                        sinon
                            .stub(ioc.serviceContainer.get<ITrustService>(ITrustService), 'isNotebookTrusted')
                            .resolves(true);
                    } catch (e) {
                        // eslint-disable-next-line no-console
                        console.log(`Stub failure ${e}`);
                    }
                    console.log(`Start Test completed ${this.currentTest?.title}`);
                });

                teardown(async function () {
                    console.log(`End Test ${this.currentTest?.title}`);
                    for (const disposable of disposables) {
                        if (!disposable) {
                            continue;
                        }
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const promise = disposable.dispose() as Promise<any>;
                        if (promise) {
                            await promise;
                        }
                    }
                    await ioc.dispose();
                    try {
                        tempNotebookFile.cleanupCallback();
                    } catch {
                        noop();
                    }
                });

                runMountedTest('Simple text', async () => {
                    // Create an editor so something is listening to messages
                    const { mount } = await createNewEditor(ioc);

                    // Add a cell into the UI and wait for it to render
                    await addCell(mount, 'a=1\na');

                    verifyHtmlOnCell(mount.wrapper, 'NativeCell', '1', 1);
                });

                runMountedTest('Simple text with no python', async () => {
                    ioc.forceDataScienceSettingsChanged({ disableJupyterAutoStart: true });
                    ioc.setPythonExtensionState(false);

                    // Create an editor so something is listening to messages
                    const { mount } = await createNewEditor(ioc);

                    // Add a cell into the UI and don't execute. If conda installed,
                    // without the python extension we cannot run a cell
                    await addCell(mount, 'a=1\na', ioc.isRawKernel && !process.env.CI_PYTHON_PATH?.includes('conda'));

                    assert.notOk(
                        ioc.attemptedPythonExtension,
                        'Python extension installation should not happen on simple open'
                    );
                });

                runMountedTest('Export with no python', async () => {
                    ioc.forceDataScienceSettingsChanged({ disableJupyterAutoStart: true });
                    ioc.setPythonExtensionState(false);

                    // Create an editor so something is listening to messages
                    const { mount } = await createNewEditor(ioc);

                    // Add a cell into the UI and wait for it to render
                    await addCell(mount, 'a=1\na', ioc.isRawKernel);

                    const exportButton = findButton(mount.wrapper, NativeEditor, 9);
                    exportButton!.simulate('click');

                    // Give it some time
                    await sleep(100);

                    // Should have asked to install
                    assert.ok(ioc.attemptedPythonExtension, 'Python extension installation should happen on export');
                });

                runMountedTest('Invalid session still runs', async (context) => {
                    if (ioc.mockJupyter) {
                        // Can only do this with the mock. Have to force the first call to waitForIdle on the
                        // the jupyter session to fail
                        ioc.mockJupyter.forcePendingIdleFailure();

                        // Create an editor so something is listening to messages
                        const { mount } = await createNewEditor(ioc);

                        // Run the first cell. Should fail but then ask for another
                        await addCell(mount, 'a=1\na');

                        verifyHtmlOnCell(mount.wrapper, 'NativeCell', '1', 1);
                    } else {
                        context.skip();
                    }
                });

                runMountedTest('Save on close', async (_context) => {
                    // Close should cause the save as to come up. Remap appshell so we can check
                    const dummyDisposable = {
                        dispose: () => {
                            return;
                        }
                    };
                    const appShell = TypeMoq.Mock.ofType<IApplicationShell>();
                    appShell
                        .setup((a) => a.showErrorMessage(TypeMoq.It.isAnyString()))
                        .returns((e) => {
                            throw e;
                        });
                    appShell
                        .setup((a) =>
                            a.showInformationMessage(
                                TypeMoq.It.isAny(),
                                TypeMoq.It.isAny(),
                                TypeMoq.It.isAny(),
                                TypeMoq.It.isAny()
                            )
                        )
                        .returns((_a1, _a2, a3, _a4) => Promise.resolve(a3));
                    appShell
                        .setup((a) => a.showSaveDialog(TypeMoq.It.isAny()))
                        .returns(() => {
                            return Promise.resolve(Uri.file(tempNotebookFile.filePath));
                        });
                    appShell.setup((a) => a.setStatusBarMessage(TypeMoq.It.isAny())).returns(() => dummyDisposable);
                    ioc.serviceManager.rebindInstance<IApplicationShell>(IApplicationShell, appShell.object);

                    // Create an editor
                    const ne = await createNewEditor(ioc);

                    // Add a cell
                    await addCell(ne.mount, 'a=1\na');

                    // Close the editor. It should ask for save as (if not custom editor)
                    if (useCustomEditorApi) {
                        // For custom editor do what VS code would do on close
                        const notebookEditorProvider = ioc.get<ITestNativeEditorProvider>(INotebookEditorProvider);
                        const customDoc = notebookEditorProvider.getCustomDocument(ne.editor.file);
                        assert.ok(customDoc, 'No custom document for new notebook');
                        const customEditorProvider = (notebookEditorProvider as any) as CustomEditorProvider;
                        await customEditorProvider.saveCustomDocumentAs(
                            customDoc!,
                            Uri.file(tempNotebookFile.filePath),
                            CancellationToken.None
                        );
                    }
                    await ne.editor.dispose();

                    // Open the temp file to make sure it has the new cell
                    const opened = await openEditor(ioc, '', tempNotebookFile.filePath);

                    verifyCellSource(opened.mount.wrapper, 'NativeCell', 'a=1\na', CellPosition.Last);
                });

                function getHashedFileName(file: Uri): string {
                    const crypto = ioc.get<ICryptoUtils>(ICryptoUtils);
                    const context = ioc.get<IExtensionContext>(IExtensionContext);
                    const key = `${KeyPrefix}${file.toString()}`;
                    const name = `${crypto.createHash(key, 'string')}.ipynb`;
                    return path.join(context.globalStoragePath, name);
                }

                runMountedTest('Save on shutdown', async (context) => {
                    // The tests end up using mocked file system.
                    return context.skip();
                    // Skip this test is using custom editor. VS code handles this situation
                    if (useCustomEditorApi) {
                        context.skip();
                    } else {
                        // When we dispose act like user wasn't able to hit anything
                        const appShell = TypeMoq.Mock.ofType<IApplicationShell>();
                        appShell
                            .setup((a) => a.showErrorMessage(TypeMoq.It.isAnyString()))
                            .returns((e) => {
                                throw e;
                            });
                        appShell
                            .setup((a) =>
                                a.showInformationMessage(
                                    TypeMoq.It.isAny(),
                                    TypeMoq.It.isAny(),
                                    TypeMoq.It.isAny(),
                                    TypeMoq.It.isAny()
                                )
                            )
                            .returns((_a1, _a2, _a3, _a4) => Promise.resolve(undefined));
                        appShell
                            .setup((a) => a.showSaveDialog(TypeMoq.It.isAny()))
                            .returns(() => {
                                return Promise.resolve(Uri.file(tempNotebookFile.filePath));
                            });
                        ioc.serviceManager.rebindInstance<IApplicationShell>(IApplicationShell, appShell.object);

                        // Turn off auto save so that backup works.
                        await updateFileConfig(ioc, 'autoSave', 'off');

                        // Create an editor with a specific path
                        const ne = await openEditor(ioc, '', tempNotebookFile.filePath);

                        // Figure out the backup file name
                        const deferred = createDeferred<boolean>();
                        const backupFileName = getHashedFileName(Uri.file(tempNotebookFile.filePath));
                        fs.watchFile(backupFileName, (c, p) => {
                            if (p.mtime < c.mtime) {
                                deferred.resolve(true);
                            }
                        });

                        try {
                            // Add a cell
                            await addCell(ne.mount, 'a=1\na');

                            // Wait for write. It should have written to backup
                            const result = await waitForPromise(deferred.promise, 5000);
                            assert.ok(result, 'Backup file did not write');

                            // Prevent reopen (we want to act like shutdown)
                            (ne.editor as any).reopen = noop;
                            await closeNotebook(ioc, ne.editor);
                        } finally {
                            fs.unwatchFile(backupFileName);
                        }

                        // Reopen and verify
                        const opened = await openEditor(ioc, '', tempNotebookFile.filePath);
                        verifyCellSource(opened.mount.wrapper, 'NativeCell', 'a=1\na', CellPosition.Last);
                    }
                });

                runMountedTest('Invalid kernel still runs', async (context) => {
                    if (ioc.mockJupyter) {
                        const kernelDesc = {
                            name: 'foobar',
                            display_name: 'foobar'
                        };
                        const invalidKernel = {
                            name: 'foobar',
                            display_name: 'foobar',
                            language: 'python',
                            path: '/foo/bar/python',
                            argv: [],
                            env: undefined
                        };

                        // Allow the invalid kernel to be used
                        const kernelServiceMock = ioc.kernelService;
                        when(
                            kernelServiceMock.findMatchingKernelSpec(
                                objectContaining(kernelDesc),
                                anything(),
                                anything()
                            )
                        ).thenResolve(invalidKernel);

                        // Can only do this with the mock. Have to force the first call to changeKernel on the
                        // the jupyter session to fail
                        ioc.mockJupyter.forcePendingKernelChangeFailure();

                        // Create an editor so something is listening to messages
                        const ne = await createNewEditor(ioc);

                        // Force an update to the editor so that it has a new kernel
                        const editor = (ne.editor as any) as NativeEditorWebView;
                        await editor.updateNotebookOptions({ kernelSpec: invalidKernel, kind: 'startUsingKernelSpec' });

                        // Run the first cell. Should fail but then ask for another
                        await addCell(ne.mount, 'a=1\na');

                        verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', '1', 1);
                    } else {
                        context.skip();
                    }
                });

                runMountedTest('Invalid kernel can be switched', async (context) => {
                    if (ioc.mockJupyter) {
                        ioc.forceDataScienceSettingsChanged({
                            jupyterLaunchRetries: 1,
                            disableJupyterAutoStart: true
                        });

                        // Can only do this with the mock. Have to force the first call to idle on the
                        // the jupyter session to fail
                        ioc.mockJupyter.forcePendingIdleFailure();

                        // Create an editor so something is listening to messages
                        const ne = await createNewEditor(ioc);

                        // Run a cell. It should fail.
                        await addCell(ne.mount, 'a=1\na');
                        verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', undefined, 1);

                        // Now switch to another kernel
                        ((ne.editor as any) as NativeEditorWebView).onMessage(
                            InteractiveWindowMessages.SelectKernel,
                            undefined
                        );

                        // Verify we picked the valid kernel.
                        await addCell(ne.mount, 'a=1\na');

                        verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', '1', 2);
                    } else {
                        context.skip();
                    }
                });

                runMountedTest('Remote kernel can be switched and remembered', async function () {
                    // Turn off raw kernel for this test as it's testing remote
                    ioc.forceDataScienceSettingsChanged({ disableZMQSupport: true });

                    const pythonService = await createPythonService(ioc, 2);

                    // Skip test for older python and raw kernel
                    if (!pythonService || ioc.mockJupyter) {
                        return this.skip();
                    }

                    const uri = await startRemoteServer(ioc, pythonService, [
                        '-m',
                        'jupyter',
                        'notebook',
                        '--NotebookApp.open_browser=False',
                        '--NotebookApp.ip=*',
                        '--NotebookApp.port=9999'
                    ]);

                    // Set this as the URI to use when connecting
                    await ioc.setServerUri(uri);

                    // Create a notebook and run a cell.
                    const notebook = await createNewEditor(ioc);
                    await addCell(notebook.mount, 'a=12\na', true);
                    verifyHtmlOnCell(notebook.mount.wrapper, 'NativeCell', '12', CellPosition.Last);

                    // Create another notebook and connect it to the already running kernel of the other one
                    when(ioc.applicationShell.showQuickPick(anything(), anything(), anything())).thenCall(
                        async (o: IKernelSpecQuickPickItem[]) => {
                            const existing = o.filter(
                                (s) =>
                                    s.selection.kind === 'connectToLiveKernel' &&
                                    s.selection.kernelModel.numberOfConnections
                            );

                            // Might be more than one. Get the oldest one. It has the actual activity.
                            const sorted = existing.sort((a, b) => {
                                if (
                                    a.selection.kind !== 'connectToLiveKernel' ||
                                    b.selection.kind !== 'connectToLiveKernel'
                                ) {
                                    return 0;
                                }
                                return (
                                    b.selection.kernelModel.lastActivityTime.getTime() -
                                    a.selection.kernelModel.lastActivityTime.getTime()
                                );
                            });
                            if (sorted && sorted.length) {
                                return sorted[0];
                            }
                        }
                    );
                    const n2 = await openEditor(ioc, '', 'kernel_share.ipynb');

                    // Have to do this by sending the switch kernel command
                    await ioc.get<ICommandManager>(ICommandManager).executeCommand(Commands.SwitchJupyterKernel, {
                        identity: n2.editor.file,
                        resource: n2.editor.file,
                        currentKernelDisplayName: undefined
                    });

                    // Execute a cell that should indicate using the same kernel as the first notebook
                    await addCell(n2.mount, 'a', true);
                    verifyHtmlOnCell(n2.mount.wrapper, 'NativeCell', '12', CellPosition.Last);

                    // Now close the notebook and reopen. Should still be using the same kernel
                    await closeNotebook(ioc, n2.editor);
                    const n3 = await openEditor(ioc, '', 'kernel_share.ipynb');
                    await addCell(n3.mount, 'a', true);
                    verifyHtmlOnCell(n3.mount.wrapper, 'NativeCell', '12', CellPosition.Last);
                });

                runMountedTest('Mime Types', async () => {
                    // Create an editor so something is listening to messages
                    await createNewEditor(ioc);

                    const badPanda = `import pandas as pd
df = pd.read("${escapePath(path.join(srcDirectory(), 'DefaultSalesReport.csv'))}")
df.head()`;
                    const goodPanda = `import pandas as pd
df = pd.read_csv("${escapePath(path.join(srcDirectory(), 'DefaultSalesReport.csv'))}")
df.head()`;
                    const matPlotLib =
                        'import matplotlib.pyplot as plt\r\nimport numpy as np\r\nx = np.linspace(0,20,100)\r\nplt.plot(x, np.sin(x))\r\nplt.show()';
                    const matPlotLibResults = 'img';
                    const spinningCursor = dedent`import sys
                    import time
                    def spinning_cursor():
                        while True:
                            for cursor in '|/-\\\\':
                                yield cursor
                    spinner = spinning_cursor()
                    for _ in range(50):
                        sys.stdout.write(next(spinner))
                        sys.stdout.flush()
                        time.sleep(0.1)
                        sys.stdout.write('\\r')`;
                    const alternating = `from IPython.display import display\r\nprint('foo')\r\ndisplay('foo')\r\nprint('bar')\r\ndisplay('bar')`;
                    const alternatingResults = ['foo\n', 'foo', 'bar\n', 'bar'];

                    const clearalternating = `from IPython.display import display, clear_output\r\nprint('foo')\r\ndisplay('foo')\r\nclear_output(True)\r\nprint('bar')\r\ndisplay('bar')`;
                    const clearalternatingResults = ['foo\n', 'foo', '', 'bar\n', 'bar'];

                    addMockData(ioc, badPanda, `pandas has no attribute 'read'`, 'text/html', 'error');
                    addMockData(ioc, goodPanda, `<td>A table</td>`, 'text/html');
                    addMockData(ioc, matPlotLib, matPlotLibResults, 'text/html');
                    addMockData(ioc, alternating, alternatingResults, ['text/plain', 'stream', 'text/plain', 'stream']);
                    addMockData(ioc, clearalternating, clearalternatingResults, [
                        'text/plain',
                        'stream',
                        'clear_true',
                        'text/plain',
                        'stream'
                    ]);
                    const cursors = ['|', '/', '-', '\\'];
                    let cursorPos = 0;
                    let loops = 3;
                    addContinuousMockData(ioc, spinningCursor, async (_c) => {
                        const result = `${cursors[cursorPos]}\r`;
                        cursorPos += 1;
                        if (cursorPos >= cursors.length) {
                            cursorPos = 0;
                            loops -= 1;
                        }
                        return Promise.resolve({ result: result, haveMore: loops > 0 });
                    });

                    const mount = ioc.getNativeWebPanel(undefined);
                    const wrapper = mount.wrapper;
                    await addCell(mount, badPanda, true);
                    verifyHtmlOnCell(wrapper, 'NativeCell', `has no attribute 'read'`, CellPosition.Last);

                    await addCell(mount, goodPanda, true);
                    verifyHtmlOnCell(wrapper, 'NativeCell', `<td>`, CellPosition.Last);

                    await addCell(mount, matPlotLib, true);
                    verifyHtmlOnCell(wrapper, 'NativeCell', /img|Figure/, CellPosition.Last);

                    await addCell(mount, spinningCursor, true);
                    verifyHtmlOnCell(wrapper, 'NativeCell', '<div>', CellPosition.Last);

                    await addCell(mount, alternating, true);
                    verifyHtmlOnCell(wrapper, 'NativeCell', /.*foo\n.*foo.*bar\n.*bar/m, CellPosition.Last);
                    await addCell(mount, clearalternating, true);
                    verifyHtmlOnCell(wrapper, 'NativeCell', /.*bar\n.*bar/m, CellPosition.Last);
                });

                runMountedTest('Click buttons', async () => {
                    // Goto source should cause the visible editor to be picked as long as its filename matches
                    const showedEditor = createDeferred();
                    const textEditors: TextEditor[] = [];
                    const docManager = TypeMoq.Mock.ofType<IDocumentManager>();
                    const visibleEditor = TypeMoq.Mock.ofType<TextEditor>();
                    const dummyDocument = TypeMoq.Mock.ofType<TextDocument>();
                    dummyDocument.setup((d) => d.fileName).returns(() => Uri.file('foo.py').fsPath);
                    visibleEditor.setup((v) => v.show()).returns(() => showedEditor.resolve());
                    visibleEditor.setup((v) => v.revealRange(TypeMoq.It.isAny())).returns(noop);
                    visibleEditor.setup((v) => v.document).returns(() => dummyDocument.object);
                    textEditors.push(visibleEditor.object);
                    docManager.setup((a) => a.visibleTextEditors).returns(() => textEditors);
                    ioc.serviceManager.rebindInstance<IDocumentManager>(IDocumentManager, docManager.object);
                    // Create an editor so something is listening to messages
                    const ne = await createNewEditor(ioc);
                    const wrapper = ne.mount.wrapper;

                    // Get a cell into the list
                    await addCell(ne.mount, 'a=1\na');

                    // find the buttons on the cell itself
                    let cell = getLastOutputCell(wrapper, 'NativeCell');
                    let ImageButtons = cell.find(ImageButton);
                    assert.equal(ImageButtons.length, 6, 'Cell buttons not found'); // Note, run by line is there as a button, it's just disabled.
                    let deleteButton = ImageButtons.at(5);

                    // Make sure delete works
                    let afterDelete = await getNativeCellResults(ne.mount, async () => {
                        deleteButton.simulate('click');
                        return Promise.resolve();
                    });
                    assert.equal(afterDelete.length, 1, `Delete should remove a cell`);

                    // Secondary delete should NOT delete the cell as there should ALWAYS be at
                    // least one cell in the file.
                    cell = getLastOutputCell(wrapper, 'NativeCell');
                    ImageButtons = cell.find(ImageButton);
                    assert.equal(ImageButtons.length, 6, 'Cell buttons not found');
                    deleteButton = ImageButtons.at(5);

                    afterDelete = await getNativeCellResults(
                        ne.mount,
                        async () => {
                            deleteButton.simulate('click');
                            return Promise.resolve();
                        },
                        () => Promise.resolve()
                    );
                    assert.equal(afterDelete.length, 1, `Delete should NOT remove the last cell`);
                });

                runMountedTest('Select Jupyter Server', async () => {
                    // eslint-disable-next-line no-console
                    console.log('Test skipped until user can change jupyter server selection again');
                    // let selectorCalled = false;

                    // ioc.datascience.setup(ds => ds.selectJupyterURI()).returns(() => {
                    //     selectorCalled = true;
                    //     return Promise.resolve();
                    // });

                    // await createNewEditor(ioc);
                    // const editor = wrapper.find(NativeEditor);
                    // const kernelSelectionUI = editor.find(KernelSelection);
                    // const buttons = kernelSelectionUI.find('div');
                    // buttons!.at(1).simulate('click');

                    // assert.equal(selectorCalled, true, 'Server Selector should have been called');
                });

                runMountedTest('Select Jupyter Kernel', async (_wrapper) => {
                    // eslint-disable-next-line no-console
                    console.log('Tests skipped, as we need better tests');
                    // let selectorCalled = false;

                    // ioc.datascience.setup(ds => ds.selectLocalJupyterKernel()).returns(() => {
                    //     selectorCalled = true;
                    //     const spec: kernelConnectionMetadata = {};
                    //     return Promise.resolve(spec);
                    // });

                    // await createNewEditor(ioc);
                    // // Create an editor so something is listening to messages
                    // await createNewEditor(ioc);

                    // // Add a cell into the UI and wait for it to render
                    // await addCell(mount, 'a=1\na');

                    // const editor = wrapper.find(NativeEditor);
                    // const kernelSelectionUI = editor.find(KernelSelection);
                    // const buttons = kernelSelectionUI.find('div');
                    // buttons!.at(4).simulate('click');

                    // assert.equal(selectorCalled, true, 'Kernel Selector should have been called');
                });

                runMountedTest('Server already loaded', async (context) => {
                    if (ioc.mockJupyter) {
                        await ioc.activate();
                        ioc.forceDataScienceSettingsChanged({
                            disableJupyterAutoStart: false
                        });

                        // Create an editor so something is listening to messages
                        const editor = await createNewEditor(ioc);

                        // Wait a bit to let async activation to work
                        await sleep(2000);

                        // Make sure it has a server
                        assert.ok(editor.editor.notebook, 'Notebook did not start with a server');
                        // Make sure it does have a name though
                        verifyServerStatus(editor.mount.wrapper, 'local');
                    } else {
                        context.skip();
                    }
                });

                runMountedTest('Server load skipped', async (context) => {
                    if (ioc.mockJupyter) {
                        ioc.forceDataScienceSettingsChanged({
                            disableJupyterAutoStart: true
                        });
                        await ioc.activate();

                        // Create an editor so something is listening to messages
                        const editor = await createNewEditor(ioc);

                        // Wait a bit to let async activation to work
                        await sleep(500);

                        // Make sure it does not have a server
                        assert.notOk(editor.editor.notebook, 'Notebook should not start with a server');

                        // Make sure it does have a name though
                        verifyServerStatus(editor.mount.wrapper, 'local');
                    } else {
                        context.skip();
                    }
                });

                runMountedTest('Convert to python', async () => {
                    // Export should cause the export dialog to come up. Remap appshell so we can check
                    const dummyDisposable = {
                        dispose: () => {
                            return;
                        }
                    };
                    const appShell = TypeMoq.Mock.ofType<IApplicationShell>();
                    appShell
                        .setup((a) => a.showErrorMessage(TypeMoq.It.isAnyString()))
                        .returns((e) => {
                            throw e;
                        });
                    appShell
                        .setup((a) => a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                        .returns(() => Promise.resolve(''));
                    appShell
                        .setup((a) => a.showSaveDialog(TypeMoq.It.isAny()))
                        .returns(() => {
                            return Promise.resolve(Uri.file(tempNotebookFile.filePath));
                        });
                    appShell.setup((a) => a.setStatusBarMessage(TypeMoq.It.isAny())).returns(() => dummyDisposable);
                    ioc.serviceManager.rebindInstance<IApplicationShell>(IApplicationShell, appShell.object);

                    // Make sure to create the editor after the rebind or it gets the wrong application shell.
                    const ne = await createNewEditor(ioc);
                    const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                    await addCell(ne.mount, 'a=1\na');
                    await dirtyPromise;

                    // Export should cause exportCalled to change to true
                    const saveButton = findButton(ne.mount.wrapper, NativeEditor, 8);
                    const saved = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);
                    saveButton!.simulate('click');
                    await saved;

                    // Click export and wait for a document to change
                    const commandFired = createDeferred();
                    const commandManager = TypeMoq.Mock.ofType<ICommandManager>();
                    const editor = ne.editor;
                    const model = editor.model;
                    ioc.serviceManager.rebindInstance<ICommandManager>(ICommandManager, commandManager.object);
                    commandManager
                        .setup((cmd) =>
                            cmd.executeCommand(
                                Commands.Export,
                                model.getContent(),
                                model.file,
                                undefined,
                                editor.notebook?.getMatchingInterpreter()
                            )
                        )
                        .returns(() => {
                            commandFired.resolve();
                            return Promise.resolve();
                        });

                    const exportButton = findButton(ne.mount.wrapper, NativeEditor, 9);
                    exportButton!.simulate('click');

                    // This can be slow, hence wait for a max of 60.
                    await waitForPromise(commandFired.promise, 60_000);
                });

                runMountedTest('Save As', async () => {
                    if (useCustomEditorApi) {
                        return;
                    }
                    const initialFileContents = (await fs.readFile(tempNotebookFile.filePath, 'utf8')).toString();
                    // Export should cause the export dialog to come up. Remap appshell so we can check
                    const dummyDisposable = {
                        dispose: () => {
                            return;
                        }
                    };
                    const appShell = TypeMoq.Mock.ofType<IApplicationShell>();
                    appShell
                        .setup((a) => a.showErrorMessage(TypeMoq.It.isAnyString()))
                        .returns((e) => {
                            throw e;
                        });
                    appShell
                        .setup((a) => a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                        .returns(() => Promise.resolve(''));
                    appShell
                        .setup((a) => a.showSaveDialog(TypeMoq.It.isAny()))
                        .returns(() => {
                            return Promise.resolve(Uri.file(tempNotebookFile.filePath));
                        });
                    appShell.setup((a) => a.setStatusBarMessage(TypeMoq.It.isAny())).returns(() => dummyDisposable);
                    ioc.serviceManager.rebindInstance<IApplicationShell>(IApplicationShell, appShell.object);

                    // Make sure to create the interactive window after the rebind or it gets the wrong application shell.
                    const ne = await createNewEditor(ioc);
                    const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                    await addCell(ne.mount, 'a=1\na');
                    await dirtyPromise;

                    // Export should cause exportCalled to change to true
                    const saveButton = findButton(ne.mount.wrapper, NativeEditor, 8);
                    const saved = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);
                    saveButton!.simulate('click');
                    await saved;

                    const newFileContents = (await fs.readFile(tempNotebookFile.filePath, 'utf8')).toString();
                    // File should have been modified.
                    assert.notEqual(initialFileContents, newFileContents);
                    // Should be a valid json with 2 cells.
                    const nbContent = JSON.parse(newFileContents) as nbformat.INotebookContent;
                    assert.equal(nbContent.cells.length, 2);
                });

                runMountedTest('RunAllCells', async () => {
                    // Make sure we don't write to storage for the notebook. It messes up other tests
                    await updateFileConfig(ioc, 'autoSave', 'onFocusChange');
                    addMockData(ioc, 'print(1)\na=1', 1);
                    addMockData(ioc, 'a=a+1\nprint(a)', 2);
                    addMockData(ioc, 'print(a+1)', 3);

                    const baseFile = [
                        { id: 'NotebookImport#0', data: { source: 'print(1)\na=1' } },
                        { id: 'NotebookImport#1', data: { source: 'a=a+1\nprint(a)' } },
                        { id: 'NotebookImport#2', data: { source: 'print(a+1)' } }
                    ];
                    const runAllCells = baseFile.map((cell) => {
                        return createFileCell(cell, cell.data);
                    });
                    const notebook = await ioc
                        .get<INotebookExporter>(INotebookExporter)
                        .translateToNotebook(runAllCells, undefined);
                    const ne = await openEditor(ioc, JSON.stringify(notebook));

                    const runAllButton = findButton(ne.mount.wrapper, NativeEditor, 0);
                    // The render method needs to be executed 3 times for three cells.
                    const threeCellsUpdated = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered, {
                        numberOfTimes: 3
                    });
                    runAllButton!.simulate('click');
                    await threeCellsUpdated;

                    verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', `1`, 0);
                    verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', `2`, 1);
                    verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', `3`, 2);
                });

                runMountedTest('Roundtrip with jupyter', async () => {
                    // Write out a temporary file
                    const baseFile = `
{
 "cells": [
  {
   "cell_type": "code",
   "execution_count": 1,
   "metadata": {
    "collapsed": true
   },
   "outputs": [
    {
     "data": {
      "text/plain": [
       "'<1>'"
      ]
     },
     "execution_count": 1,
     "metadata": {},
     "output_type": "execute_result"
    }
   ],
   "source": [
    "a='<1>'\\n",
    "a"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 2,
   "metadata": {},
   "outputs": [
    {
     "output_type": "stream",
     "text": [
         "Hello World 9!\\n"
     ],
     "name": "stdout"
    }
   ],
   "source": [
    "from IPython.display import clear_output\\n",
    "for i in range(10):\\n",
    "    clear_output()\\n",
    "    print(\\"Hello World {0}!\\".format(i))\\n"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 3,
   "metadata": {},
   "outputs": [
    {
     "data": {
      "text/plain": [
       "3"
      ]
     },
     "execution_count": 3,
     "metadata": {},
     "output_type": "execute_result"
    }
   ],
   "source": [
    "c=3\\n",
    "c"
   ]
  }
 ],
 "metadata": {
  "file_extension": ".py",
  "kernelspec": {
   "display_name": "Python 3",
   "language": "python",
   "name": "python3"
  },
  "language_info": {
   "codemirror_mode": {
    "name": "ipython",
    "version": 3
   },
   "file_extension": ".py",
   "mimetype": "text/x-python",
   "name": "python",
   "nbconvert_exporter": "python",
   "pygments_lexer": "ipython3",
   "version": "3.7.4"
  },
  "mimetype": "text/x-python",
  "name": "python",
  "npconvert_exporter": "python",
  "pygments_lexer": "ipython3",
  "version": 3
 },
 "nbformat": 4,
 "nbformat_minor": 2
}`;
                    addMockData(ioc, `a='<1>'\na`, `'<1>'`);
                    addContinuousMockData(
                        ioc,
                        'from IPython.display import clear_output\nfor i in range(10):\n    clear_output()\n    print("Hello World {0}!".format(i))\n',
                        async () => {
                            return { result: 'Hello World 9!\n', haveMore: false };
                        }
                    );
                    addMockData(ioc, 'c=3\nc', 3);
                    const dsfs = ioc.get<IFileSystem>(IFileSystem);
                    const tf = await dsfs.createTemporaryLocalFile('.ipynb');
                    try {
                        await dsfs.writeLocalFile(tf.filePath, baseFile);

                        // File should exist. Open and run all cells
                        const n = await openEditor(ioc, '', tf.filePath);
                        assert.equal((n.editor.model as NativeEditorNotebookModel).cells.length, 3, 'Cells not loaded');
                        const threeCellsUpdated = n.mount.waitForMessage(InteractiveWindowMessages.ExecutionRendered, {
                            numberOfTimes: 3
                        });
                        n.editor.runAllCells();
                        await threeCellsUpdated;

                        // Save the file
                        const saveButton = findButton(n.mount.wrapper, NativeEditor, 8);
                        const saved = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);
                        saveButton!.simulate('click');
                        await saved;

                        // Read in the file contents. Should match the original
                        const savedContents = await dsfs.readLocalFile(tf.filePath);
                        const savedJSON = JSON.parse(savedContents);
                        const baseJSON = JSON.parse(baseFile);

                        // Don't compare kernelspec names
                        delete savedJSON.metadata.kernelspec.display_name;
                        delete baseJSON.metadata.kernelspec.display_name;

                        // Don't compare python versions
                        delete savedJSON.metadata.language_info.version;
                        delete baseJSON.metadata.language_info.version;

                        assert.deepEqual(savedJSON, baseJSON, 'File contents were changed by execution');
                    } finally {
                        tf.dispose();
                    }
                });

                runMountedTest('Startup and shutdown', async () => {
                    // Turn off raw kernel for this test as it's testing jupyterserver start / shutdown
                    ioc.forceDataScienceSettingsChanged({ disableZMQSupport: true });
                    addMockData(ioc, 'b=2\nb', 2);
                    addMockData(ioc, 'c=3\nc', 3);

                    const baseFile = [
                        { id: 'NotebookImport#0', data: { source: 'a=1\na' } },
                        { id: 'NotebookImport#1', data: { source: 'b=2\nb' } },
                        { id: 'NotebookImport#2', data: { source: 'c=3\nc' } }
                    ];
                    const runAllCells = baseFile.map((cell) => {
                        return createFileCell(cell, cell.data);
                    });
                    const notebook = await ioc
                        .get<INotebookExporter>(INotebookExporter)
                        .translateToNotebook(runAllCells, undefined);
                    let editor = await openEditor(ioc, JSON.stringify(notebook));

                    // Run everything
                    let threeCellsUpdated = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered, {
                        numberOfTimes: 3
                    });
                    let runAllButton = findButton(editor.mount.wrapper, NativeEditor, 0);
                    runAllButton!.simulate('click');
                    await threeCellsUpdated;

                    // Close editor. Should still have the server up
                    await closeNotebook(ioc, editor.editor);
                    const jupyterExecution = ioc.serviceManager.get<IJupyterExecution>(IJupyterExecution);
                    const server = await jupyterExecution.getServer({
                        allowUI: () => false,
                        purpose: Identifiers.HistoryPurpose
                    });
                    assert.ok(server, 'Server was destroyed on notebook shutdown');

                    // Reopen, and rerun
                    editor = await openEditor(ioc, JSON.stringify(notebook));

                    threeCellsUpdated = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered, {
                        numberOfTimes: 3
                    });
                    runAllButton = findButton(editor.mount.wrapper, NativeEditor, 0);
                    runAllButton!.simulate('click');
                    await threeCellsUpdated;
                    verifyHtmlOnCell(editor.mount.wrapper, 'NativeCell', `1`, 0);
                });

                test('Failure', async () => {
                    let fail = true;
                    const errorThrownDeferred = createDeferred<Error>();

                    // Turn off raw kernel for this test as it's testing jupyter usable error
                    ioc.forceDataScienceSettingsChanged({ disableZMQSupport: true });

                    // REmap the functions in the execution and error handler. Note, we can't rebind them as
                    // they've already been injected into the INotebookProvider
                    const execution = ioc.serviceManager.get<IJupyterExecution>(IJupyterExecution);
                    const errorHandler = ioc.serviceManager.get<IDataScienceErrorHandler>(IDataScienceErrorHandler);
                    const originalGetUsable = execution.getUsableJupyterPython.bind(execution);
                    execution.getUsableJupyterPython = () => {
                        if (fail) {
                            return Promise.resolve(undefined);
                        }
                        return originalGetUsable();
                    };
                    errorHandler.handleError = (exc: Error) => {
                        errorThrownDeferred.resolve(exc);
                        return Promise.resolve();
                    };

                    addMockData(ioc, 'a=1\na', 1);
                    const ne = await createNewEditor(ioc);
                    const result = await Promise.race([addCell(ne.mount, 'a=1\na', true), errorThrownDeferred.promise]);
                    assert.ok(result, 'Error not found');
                    assert.ok(result instanceof Error, 'Error not found');

                    // Fix failure and try again
                    fail = false;
                    const cell = getOutputCell(ne.mount.wrapper, 'NativeCell', 1);
                    assert.ok(cell, 'Cannot find the first cell');
                    const imageButtons = cell!.find(ImageButton);
                    assert.equal(imageButtons.length, 6, 'Cell buttons not found');
                    const runButton = imageButtons.findWhere((w) => w.props().tooltip === 'Run cell');
                    assert.equal(runButton.length, 1, 'No run button found');
                    const update = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered, {
                        numberOfTimes: 3
                    });
                    runButton.simulate('click');
                    await update;
                    verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', `1`, 1);
                });
            });

            suite('Editor tests', () => {
                let wrapper: ReactWrapper<any, Readonly<{}>, React.Component>;
                let mount: IMountedWebView;
                let notebookEditor: INotebookEditor;
                const disposables: Disposable[] = [];
                let ioc: DataScienceIocContainer;
                const baseFile = `
{
 "cells": [
  {
   "cell_type": "code",
   "execution_count": 1,
   "metadata": {
    "collapsed": true
   },
   "outputs": [
    {
     "data": {
      "text/plain": [
       "1"
      ]
     },
     "execution_count": 1,
     "metadata": {},
     "output_type": "execute_result"
    }
   ],
   "source": [
    "a=1\\n",
    "a"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 2,
   "metadata": {},
   "outputs": [
    {
     "data": {
      "text/plain": [
       "2"
      ]
     },
     "execution_count": 2,
     "metadata": {},
     "output_type": "execute_result"
    }
   ],
   "source": [
    "b=2\\n",
    "b"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 3,
   "metadata": {},
   "outputs": [
    {
     "data": {
      "text/plain": [
       "3"
      ]
     },
     "execution_count": 3,
     "metadata": {},
     "output_type": "execute_result"
    }
   ],
   "source": [
    "c=3\\n",
    "c"
   ]
  }
 ],
 "metadata": {
  "file_extension": ".py",
  "kernelspec": {
   "display_name": "Python 3",
   "language": "python",
   "name": "python3"
  },
  "language_info": {
   "codemirror_mode": {
    "name": "ipython",
    "version": 3
   },
   "file_extension": ".py",
   "mimetype": "text/x-python",
   "name": "python",
   "nbconvert_exporter": "python",
   "pygments_lexer": "ipython3",
   "version": "3.7.4"
  },
  "mimetype": "text/x-python",
  "name": "python",
  "npconvert_exporter": "python",
  "pygments_lexer": "ipython3",
  "version": 3
 },
 "nbformat": 4,
 "nbformat_minor": 2
}`;
                const addedJSON = JSON.parse(baseFile);
                addedJSON.cells.splice(3, 0, {
                    cell_type: 'code',
                    execution_count: null,
                    metadata: {},
                    outputs: [],
                    source: ['a']
                });

                const addedJSONFile = JSON.stringify(addedJSON, null, ' ');

                let notebookFile: {
                    filePath: string;
                    cleanupCallback: Function;
                };
                function initIoc() {
                    ioc = new DataScienceIocContainer();
                    ioc.registerDataScienceTypes(useCustomEditorApi);
                    return ioc.activate();
                }
                async function setupFunction(this: Mocha.Context, fileContents?: any) {
                    addMockData(ioc, 'b=2\nb', 2);
                    addMockData(ioc, 'c=3\nc', 3);
                    // Use a real file so we can save notebook to a file.
                    // This is used in some tests (saving).
                    notebookFile = await createTemporaryFile('.ipynb');
                    await fs.writeFile(notebookFile.filePath, fileContents ? fileContents : baseFile);
                    const ne = await openEditor(ioc, fileContents ? fileContents : baseFile, notebookFile.filePath);
                    wrapper = ne.mount.wrapper;
                    mount = ne.mount;
                    notebookEditor = ne.editor;
                }

                teardown(async () => {
                    for (const disposable of disposables) {
                        if (!disposable) {
                            continue;
                        }
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const promise = disposable.dispose() as Promise<any>;
                        if (promise) {
                            await promise;
                        }
                    }
                    if (ioc) {
                        await ioc.dispose();
                    }
                    try {
                        notebookFile.cleanupCallback();
                    } catch {
                        noop();
                    }
                });

                function clickCell(cellIndex: number) {
                    wrapper.update();
                    wrapper.find(NativeCell).at(cellIndex).simulate('click');
                    wrapper.update();
                }

                function simulateKeyPressOnCell(
                    cellIndex: number,
                    keyboardEvent: Partial<IKeyboardEvent> & { code: string }
                ) {
                    // Check to see if we have an active focused editor
                    const editor = getNativeFocusedEditor(wrapper);

                    // If we do have one, send the input there, otherwise send it to the outer cell
                    if (editor) {
                        simulateKeyPressOnEditor(editor, keyboardEvent);
                    } else {
                        simulateKeyPressOnCellInner(cellIndex, keyboardEvent);
                    }
                }

                async function addMarkdown(code: string): Promise<void> {
                    const totalCells = wrapper.find('NativeCell').length;
                    const newCellIndex = totalCells;
                    await addCell(mount, code, false);
                    assert.equal(wrapper.find('NativeCell').length, totalCells + 1);

                    // First lose focus
                    clickCell(newCellIndex);
                    let update = waitForMessage(ioc, InteractiveWindowMessages.UnfocusedCellEditor);
                    simulateKeyPressOnCell(1, { code: 'Escape' });
                    await update;

                    // Switch to markdown
                    update = waitForMessage(ioc, CommonActionType.CHANGE_CELL_TYPE);
                    simulateKeyPressOnCell(newCellIndex, { code: 'm' });
                    await update;

                    clickCell(newCellIndex);

                    // Monaco editor should be rendered and the cell should be markdown
                    assert.ok(!isCellFocused(wrapper, 'NativeCell', newCellIndex));
                    assert.ok(isCellMarkdown(wrapper, 'NativeCell', newCellIndex));
                }

                function simulateKeyPressOnEditor(
                    editorControl: ReactWrapper<any, Readonly<{}>, React.Component> | undefined,
                    keyboardEvent: Partial<IKeyboardEvent> & { code: string }
                ) {
                    enterEditorKey(editorControl, keyboardEvent);
                }

                function simulateKeyPressOnCellInner(
                    cellIndex: number,
                    keyboardEvent: Partial<IKeyboardEvent> & { code: string }
                ) {
                    wrapper.update();
                    let nativeCell = wrapper.find(NativeCell).at(cellIndex);
                    if (nativeCell.exists()) {
                        nativeCell.simulate('keydown', {
                            key: keyboardEvent.code,
                            shiftKey: keyboardEvent.shiftKey,
                            ctrlKey: keyboardEvent.ctrlKey,
                            altKey: keyboardEvent.altKey,
                            metaKey: keyboardEvent.metaKey
                        });
                    }
                    wrapper.update();
                    // Requery for our cell as something like a 'dd' keydown command can delete it before the press and up
                    nativeCell = wrapper.find(NativeCell).at(cellIndex);
                    if (nativeCell.exists()) {
                        nativeCell.simulate('keypress', {
                            key: keyboardEvent.code,
                            shiftKey: keyboardEvent.shiftKey,
                            ctrlKey: keyboardEvent.ctrlKey,
                            altKey: keyboardEvent.altKey,
                            metaKey: keyboardEvent.metaKey
                        });
                    }
                    nativeCell = wrapper.find(NativeCell).at(cellIndex);
                    wrapper.update();
                    if (nativeCell.exists()) {
                        nativeCell.simulate('keyup', {
                            key: keyboardEvent.code,
                            shiftKey: keyboardEvent.shiftKey,
                            ctrlKey: keyboardEvent.ctrlKey,
                            altKey: keyboardEvent.altKey,
                            metaKey: keyboardEvent.metaKey
                        });
                    }
                    wrapper.update();
                }

                suite('Selection/Focus', () => {
                    setup(async function () {
                        await initIoc();
                        // eslint-disable-next-line no-invalid-this
                        await setupFunction.call(this);
                    });
                    test('None of the cells are selected by default', async () => {
                        assert.ok(!isCellSelected(wrapper, 'NativeCell', 0));
                        assert.ok(!isCellSelected(wrapper, 'NativeCell', 1));
                        assert.ok(!isCellSelected(wrapper, 'NativeCell', 2));
                    });

                    test('None of the cells are not focused by default', async () => {
                        assert.ok(!isCellFocused(wrapper, 'NativeCell', 0));
                        assert.ok(!isCellFocused(wrapper, 'NativeCell', 1));
                        assert.ok(!isCellFocused(wrapper, 'NativeCell', 2));
                    });

                    test('Select cells by clicking them', async () => {
                        // Click first cell, then second, then third.
                        clickCell(0);
                        assert.ok(isCellSelected(wrapper, 'NativeCell', 0));
                        assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                        assert.equal(isCellSelected(wrapper, 'NativeCell', 2), false);

                        clickCell(1);
                        assert.ok(isCellSelected(wrapper, 'NativeCell', 1));
                        assert.equal(isCellSelected(wrapper, 'NativeCell', 0), false);
                        assert.equal(isCellSelected(wrapper, 'NativeCell', 2), false);

                        clickCell(2);
                        assert.ok(isCellSelected(wrapper, 'NativeCell', 2));
                        assert.equal(isCellSelected(wrapper, 'NativeCell', 0), false);
                        assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                    });

                    test('Markdown saved when selecting another cell', async () => {
                        clickCell(0);

                        // Switch to markdown
                        let update = waitForMessage(ioc, CommonActionType.CHANGE_CELL_TYPE);
                        simulateKeyPressOnCell(0, { code: 'm' });
                        await update;

                        // Monaco editor should be rendered and the cell should be markdown
                        assert.ok(!isCellFocused(wrapper, 'NativeCell', 0));
                        assert.ok(isCellMarkdown(wrapper, 'NativeCell', 0));

                        // Focus the cell.
                        update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        simulateKeyPressOnCell(0, { code: 'Enter', editorInfo: undefined });
                        await update;

                        assert.ok(isCellFocused(wrapper, 'NativeCell', 0));
                        assert.equal(wrapper.find(NativeCell).at(0).find(MonacoEditor).length, 1);

                        // Verify cell content
                        const currentEditor = getNativeFocusedEditor(wrapper);
                        const reactEditor = currentEditor!.instance() as MonacoEditor;
                        const editor = reactEditor.state.editor;
                        if (editor) {
                            assert.equal(
                                editor.getModel()!.getValue(),
                                'a=1\na',
                                'Incorrect editor text in markdown cell'
                            );
                        }

                        typeCode(currentEditor, 'world');

                        if (editor) {
                            assert.equal(
                                editor.getModel()!.getValue(),
                                'worlda=1\na',
                                'Incorrect editor text in markdown cell'
                            );
                        }

                        // Now get the editor for the next cell and click it
                        update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        clickCell(1);
                        await update;

                        // Look back at the output for the first cell, not focused, not selected, text saved in output
                        assert.equal(isCellSelected(wrapper, 'NativeCell', 0), false);
                        assert.equal(isCellFocused(wrapper, 'NativeCell', 0), false);

                        verifyHtmlOnCell(wrapper, 'NativeCell', '<p>worlda=1\na</p>', 0);
                    });
                });

                suite('Model updates', () => {
                    setup(async function () {
                        await initIoc();
                        // eslint-disable-next-line no-invalid-this
                        await setupFunction.call(this);
                    });
                    async function undo(): Promise<void> {
                        const uri = Uri.file(notebookFile.filePath);
                        const update = waitForMessage(ioc, InteractiveWindowMessages.ReceivedUpdateModel);
                        const editorService = ioc.serviceManager.get<ICustomEditorService>(
                            ICustomEditorService
                        ) as MockCustomEditorService;
                        editorService.undo(uri);
                        return update;
                    }
                    async function redo(): Promise<void> {
                        const uri = Uri.file(notebookFile.filePath);
                        const update = waitForMessage(ioc, InteractiveWindowMessages.ReceivedUpdateModel);
                        const editorService = ioc.serviceManager.get<ICustomEditorService>(
                            ICustomEditorService
                        ) as MockCustomEditorService;
                        editorService.redo(uri);
                        return update;
                    }
                    test('Add a cell and undo', async () => {
                        // Add empty cell, else adding text is yet another thing that needs to be undone,
                        // we have tests for that.
                        await addCell(mount, '', false);

                        // Should have 4 cells
                        assert.equal(wrapper.find('NativeCell').length, 4, 'Cell not added');

                        // Send undo through the custom editor
                        await undo();

                        // Should have 3
                        assert.equal(wrapper.find('NativeCell').length, 3, 'Cell not removed');
                    });
                    test('Edit a cell and undo', async () => {
                        await addCell(mount, '', false);

                        // Should have 4 cells
                        assert.equal(wrapper.find('NativeCell').length, 4, 'Cell not added');

                        // Change the contents of the cell
                        const editorEnzyme = getNativeFocusedEditor(wrapper);

                        // Type in something with brackets
                        typeCode(editorEnzyme, 'some more');

                        // Verify cell content
                        const reactEditor = editorEnzyme!.instance() as MonacoEditor;
                        const editor = reactEditor.state.editor;
                        if (editor) {
                            assert.equal(editor.getModel()!.getValue(), 'some more', 'Text does not match');
                        }

                        // Add a new cell
                        await addCell(mount, '', false);

                        // Send undo a bunch of times. Should undo the add and the edits
                        await undo();
                        await undo();
                        await undo();

                        // Should have four again
                        assert.equal(wrapper.find('NativeCell').length, 4, 'Cell not removed on undo');

                        // Should have different content
                        if (editor) {
                            assert.equal(editor.getModel()!.getValue(), 'some mo', 'Text does not match after undo');
                        }

                        // Send redo to see if goes back
                        await redo();
                        if (editor) {
                            assert.equal(editor.getModel()!.getValue(), 'some mor', 'Text does not match');
                        }

                        // Send redo to see if goes back
                        await redo();
                        await redo();
                        assert.equal(wrapper.find('NativeCell').length, 5, 'Cell not readded on redo');
                    });
                    test('Remove, move, and undo', async () => {
                        await addCell(mount, '', false);

                        // Should have 4 cells
                        assert.equal(wrapper.find('NativeCell').length, 4, 'Cell not added');

                        // Delete the cell
                        let cell = getLastOutputCell(wrapper, 'NativeCell');
                        let imageButtons = cell.find(ImageButton);
                        assert.equal(imageButtons.length, 6, 'Cell buttons not found');
                        const deleteButton = imageButtons.at(5);
                        const afterDelete = await getNativeCellResults(mount, async () => {
                            deleteButton.simulate('click');
                            return Promise.resolve();
                        });
                        // Should have 3 cells
                        assert.equal(afterDelete.length, 3, 'Cell not deleted');

                        // Undo the delete
                        await undo();

                        // Should have 4 cells again
                        assert.equal(wrapper.find('NativeCell').length, 4, 'Cell delete not undone');

                        // Redo the delete
                        await redo();

                        // Should have 3 cells again
                        assert.equal(wrapper.find('NativeCell').length, 3, 'Cell delete not redone');

                        // Move some cells around
                        cell = getLastOutputCell(wrapper, 'NativeCell');
                        imageButtons = cell.find(ImageButton);
                        assert.equal(imageButtons.length, 6, 'Cell buttons not found');
                        const moveUpButton = imageButtons.at(0);
                        const afterMove = await getNativeCellResults(mount, async () => {
                            moveUpButton.simulate('click');
                            return Promise.resolve();
                        });

                        let foundCell = getOutputCell(afterMove, 'NativeCell', 2)?.instance() as NativeCell;
                        assert.equal(foundCell.props.cellVM.cell.id, 'NotebookImport#1', 'Cell did not move');
                        await undo();
                        foundCell = getOutputCell(wrapper, 'NativeCell', 2)?.instance() as NativeCell;
                        assert.equal(foundCell.props.cellVM.cell.id, 'NotebookImport#2', 'Cell did not move back');
                    });

                    test('Update as user types into editor (update redux store and model)', async () => {
                        const cellIndex = 3;
                        await addCell(mount, '', false);
                        assert.ok(isCellFocused(wrapper, 'NativeCell', cellIndex));
                        assert.equal(wrapper.find('NativeCell').length, 4, 'Cell not added');

                        const notebookEditorProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                        const model = (notebookEditorProvider.editors[0] as NativeEditorWebView).model;

                        // This is the string the user will type in a character at a time into the editor.
                        const stringToType = 'Hi! Bob!';

                        // We are expecting to receive multiple edits to the model in the backend/extension from react, one for each character.
                        // Lets create deferreds that we can await on, and each will be resolved with the edit it received.
                        // For first edit, we'll expect `H`, then `i`, then `!`
                        const modelEditsInExtension = stringToType.split('').map(createDeferred);
                        model?.changed((e) => {
                            if (e.kind === 'edit') {
                                // Find the first deferred that's no completed.
                                const deferred = modelEditsInExtension.find((d) => !d.completed);
                                // Resolve promise with the character/string it received as edit.
                                deferred?.resolve(e.forward.map((m) => m.text).join(''));
                            }
                        });

                        for (let index = 0; index < stringToType.length; index += 1) {
                            // Single character to be typed into the editor.
                            const characterToTypeIntoEditor = stringToType.substring(index, index + 1);

                            // Type a character into the editor.
                            const editorEnzyme = getNativeFocusedEditor(wrapper);
                            typeCode(editorEnzyme, characterToTypeIntoEditor);

                            const reactEditor = editorEnzyme!.instance() as MonacoEditor;
                            const editorValue = reactEditor.state.editor!.getModel()!.getValue();
                            const expectedString = stringToType.substring(0, index + 1);

                            // 1. Validate the value in the monaco editor.
                            // Confirms value in the editor is as expected.
                            assert.equal(editorValue, expectedString, 'Text does not match');

                            // 2. Validate the value in the redux state (props - update in redux, will push through to props).
                            // Confirms value in the props is as expected.
                            assert.equal(reactEditor.props.value, expectedString, 'Text does not match');

                            // 3. Validate the edit received by the extension from the react side.
                            // When user types `H`, then we'll expect to see `H` edit received in the model, then `i`, `!` & so on.
                            const expectedModelEditInExtension = modelEditsInExtension[index];
                            // Verify against the character the user typed.
                            await assert.eventually.equal(
                                expectedModelEditInExtension.promise,
                                characterToTypeIntoEditor
                            );
                        }
                    });
                    test('Exec Cell has the same value as the UI', async () => {
                        const cellIndex = 3;
                        await addCell(mount, '', false);
                        assert.ok(isCellFocused(wrapper, 'NativeCell', cellIndex));
                        assert.equal(wrapper.find('NativeCell').length, 4, 'Cell not added');

                        const notebookEditorProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                        const editor = notebookEditorProvider.editors[0];
                        const model = (editor as NativeEditorWebView).model;

                        // Add some code into the cell
                        const editorEnzyme = getNativeFocusedEditor(wrapper);
                        typeCode(editorEnzyme, 'print("foo")\n');

                        // Execute the cell without moving off of it
                        let executePromise = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered);
                        enterEditorKey(editorEnzyme, { code: 'Enter', editorInfo: undefined, ctrlKey: true });
                        await executePromise;

                        // Verify our model has the cell
                        assert.equal(
                            concatMultilineString(model.cells[3].data.source),
                            'print("foo")\n',
                            'Model not updated'
                        );

                        // Add some more code
                        typeCode(editorEnzyme, 'print("foo")\n');

                        executePromise = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered);
                        enterEditorKey(editorEnzyme, { code: 'Enter', editorInfo: undefined, ctrlKey: true });
                        await executePromise;

                        // Verify our model has the cell
                        assert.equal(
                            concatMultilineString(model.cells[3].data.source),
                            'print("foo")\nprint("foo")\n',
                            'Model not updated on second update'
                        );

                        // Delete some code and add some code
                        typeCode(editorEnzyme, '\b\b\bbar")\n');

                        executePromise = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered);
                        enterEditorKey(editorEnzyme, { code: 'Enter', editorInfo: undefined, ctrlKey: true });
                        await executePromise;

                        // Verify our model has the cell
                        assert.equal(
                            concatMultilineString(model.cells[3].data.source),
                            'print("foo")\nprint("foobar")\n',
                            'Model not updated on third update'
                        );
                    });
                    test('Updates are not lost when switching to markdown (update redux store and model)', async () => {
                        const cellIndex = 3;
                        await addCell(mount, '', false);
                        assert.ok(isCellFocused(wrapper, 'NativeCell', cellIndex));
                        assert.equal(wrapper.find('NativeCell').length, 4, 'Cell not added');

                        const notebookEditorProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                        const model = (notebookEditorProvider.editors[0] as NativeEditorWebView).model;

                        // This is the string the user will type in a character at a time into the editor.
                        const stringToType = 'Hi Bob!';

                        // We are expecting to receive multiple edits to the model in the backend/extension from react, one for each character.
                        // Lets create deferreds that we can await on, and each will be resolved with the edit it received.
                        // For first edit, we'll expect `H`, then `i`, then `!`
                        const modelEditsInExtension = createDeferred();
                        // Create deferred to detect changes to cellType.
                        const modelCellChangedInExtension = createDeferred();
                        model?.changed((e) => {
                            // Resolve promise when we receive last edit (the last character `!`).
                            if (e.kind === 'edit' && e.forward.map((m) => m.text).join('') === '!') {
                                modelEditsInExtension.resolve();
                            }
                            if (e.kind === 'changeCellType') {
                                modelCellChangedInExtension.resolve();
                            }
                        });

                        // Type into new cell in one go (e.g. a paste operation)
                        const editorEnzyme = getNativeFocusedEditor(wrapper);
                        typeCode(editorEnzyme, stringToType);

                        // Verify cell content
                        const reactEditor = editorEnzyme!.instance() as MonacoEditor;
                        const editorValue = reactEditor.state.editor!.getModel()!.getValue();

                        // 1. Validate the value in the monaco editor.
                        // Confirms value in the editor is as expected.
                        assert.equal(editorValue, stringToType, 'Text does not match');

                        // 2. Validate the value in the monaco editor state (redux state).
                        // Ensures we are keeping redux upto date.
                        assert.equal(reactEditor.props.value, stringToType, 'Text does not match');

                        // 3. Validate the edit received by the extension from the react side.
                        await modelEditsInExtension.promise;
                        assert.equal(concatMultilineString(model?.cells[3].data.source!), stringToType);

                        // Now hit escape.
                        let update = waitForMessage(ioc, InteractiveWindowMessages.UnfocusedCellEditor);
                        simulateKeyPressOnCell(cellIndex, { code: 'Escape' });
                        await update;

                        // Confirm it is no longer focused, and it is selected.
                        assert.equal(isCellSelected(wrapper, 'NativeCell', cellIndex), true);
                        assert.equal(isCellFocused(wrapper, 'NativeCell', cellIndex), false);

                        // Switch to markdown
                        update = waitForMessage(ioc, CommonActionType.CHANGE_CELL_TYPE);
                        simulateKeyPressOnCell(cellIndex, { code: 'm' });
                        await update;

                        // Monaco editor should be rendered and the cell should be markdown
                        assert.ok(!isCellFocused(wrapper, 'NativeCell', cellIndex), 'cell is not focused');
                        assert.ok(isCellMarkdown(wrapper, 'NativeCell', cellIndex), 'cell is not markdown');

                        // Confirm cell has been changed in model.
                        await modelCellChangedInExtension.promise;
                        // Verify the cell type.
                        assert.equal(model?.cells[3].data.cell_type, 'markdown');
                        // Verify that changing cell type didn't result in a loss of data.
                        assert.equal(concatMultilineString(model?.cells[3].data.source!), stringToType);
                    });
                });

                suite('Keyboard Shortcuts', () => {
                    setup(async function () {
                        (window.navigator as any).platform = originalPlatform;
                        await initIoc();
                        // eslint-disable-next-line no-invalid-this
                        await setupFunction.call(this);
                    });
                    teardown(() => ((window.navigator as any).platform = originalPlatform));
                    test('Traverse cells by using ArrowUp and ArrowDown, k and j', async () => {
                        const keyCodesAndPositions = [
                            // When we press arrow down in the first cell, then second cell gets selected.
                            { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 0, expectedSelectedCell: 1 },
                            { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 1, expectedSelectedCell: 2 },
                            // Arrow down on last cell is a noop.
                            { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 2, expectedSelectedCell: 2 },
                            // When we press arrow up in the last cell, then second cell (from bottom) gets selected.
                            { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 2, expectedSelectedCell: 1 },
                            { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 1, expectedSelectedCell: 0 },
                            // Arrow up on last cell is a noop.
                            { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 0, expectedSelectedCell: 0 },

                            // Same tests as above with k and j.
                            { keyCode: 'j', cellIndexToPressKeysOn: 0, expectedSelectedCell: 1 },
                            { keyCode: 'j', cellIndexToPressKeysOn: 1, expectedSelectedCell: 2 },
                            // Arrow down on last cell is a noop.
                            { keyCode: 'j', cellIndexToPressKeysOn: 2, expectedSelectedCell: 2 },
                            { keyCode: 'k', cellIndexToPressKeysOn: 2, expectedSelectedCell: 1 },
                            { keyCode: 'k', cellIndexToPressKeysOn: 1, expectedSelectedCell: 0 },
                            // Arrow up on last cell is a noop.
                            { keyCode: 'k', cellIndexToPressKeysOn: 0, expectedSelectedCell: 0 }
                        ];

                        // keypress on first cell, then second, then third.
                        // Test navigation through all cells, by traversing up and down.
                        for (const testItem of keyCodesAndPositions) {
                            simulateKeyPressOnCell(testItem.cellIndexToPressKeysOn, { code: testItem.keyCode });

                            // Check if it is selected.
                            // Only the cell at the index should be selected, as that's what we click.
                            assert.ok(isCellSelected(wrapper, 'NativeCell', testItem.expectedSelectedCell) === true);
                        }
                    });

                    test('Traverse cells by using ArrowUp and ArrowDown, k and j', async () => {
                        const keyCodesAndPositions = [
                            // When we press arrow down in the first cell, then second cell gets selected.
                            { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 0, expectedIndex: 1 },
                            { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 1, expectedIndex: 2 },
                            // Arrow down on last cell is a noop.
                            { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 2, expectedIndex: 2 },
                            // When we press arrow up in the last cell, then second cell (from bottom) gets selected.
                            { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 2, expectedIndex: 1 },
                            { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 1, expectedIndex: 0 },
                            // Arrow up on last cell is a noop.
                            { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 0, expectedIndex: 0 }
                        ];

                        // keypress on first cell, then second, then third.
                        // Test navigation through all cells, by traversing up and down.
                        for (const testItem of keyCodesAndPositions) {
                            simulateKeyPressOnCell(testItem.cellIndexToPressKeysOn, { code: testItem.keyCode });

                            // Check if it is selected.
                            // Only the cell at the index should be selected, as that's what we click.
                            assert.ok(isCellSelected(wrapper, 'NativeCell', testItem.expectedIndex) === true);
                        }
                    });

                    test("Pressing 'Enter' on a selected cell, results in focus being set to the code", async () => {
                        // For some reason we cannot allow setting focus to monaco editor.
                        // Tests are known to fall over if allowed.
                        wrapper.update();
                        const editor = wrapper.find(NativeCell).at(1).find(Editor).first();
                        (editor.instance() as Editor).giveFocus = () => editor.props().focused!();

                        const update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        clickCell(1);
                        simulateKeyPressOnCell(1, { code: 'Enter', editorInfo: undefined });
                        await update;

                        // The second cell should be selected.
                        assert.ok(isCellFocused(wrapper, 'NativeCell', 1));
                    });

                    test("Pressing 'Escape' on a focused cell results in the cell being selected", async () => {
                        // First focus the cell.
                        let update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        clickCell(1);
                        simulateKeyPressOnCell(1, { code: 'Enter', editorInfo: undefined });
                        await update;

                        // The second cell should be selected.
                        assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                        assert.equal(isCellFocused(wrapper, 'NativeCell', 1), true);

                        // Now hit escape.
                        update = waitForMessage(ioc, InteractiveWindowMessages.UnfocusedCellEditor);
                        simulateKeyPressOnCell(1, { code: 'Escape' });
                        await update;

                        // Confirm it is no longer focused, and it is selected.
                        assert.equal(isCellSelected(wrapper, 'NativeCell', 1), true);
                        assert.equal(isCellFocused(wrapper, 'NativeCell', 1), false);
                    }).retries(3);

                    test("Pressing 'Shift+Enter' on a selected cell executes the cell and advances to the next cell", async () => {
                        let update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        clickCell(1);
                        simulateKeyPressOnCell(1, { code: 'Enter', editorInfo: undefined });
                        await update;

                        // The 2nd cell should be focused
                        assert.ok(isCellFocused(wrapper, 'NativeCell', 1));

                        update = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered);
                        simulateKeyPressOnCell(1, { code: 'Enter', shiftKey: true, editorInfo: undefined });
                        await update;
                        wrapper.update();

                        // Ensure cell was executed.
                        verifyHtmlOnCell(wrapper, 'NativeCell', '2', 1);

                        // The third cell should be selected.
                        assert.ok(isCellSelected(wrapper, 'NativeCell', 2));

                        // The third cell should not be focused
                        assert.ok(!isCellFocused(wrapper, 'NativeCell', 2));

                        // Shift+enter on the last cell, it should behave differently. It should be selected and focused

                        // First focus the cell.
                        update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        clickCell(2);
                        simulateKeyPressOnCell(2, { code: 'Enter', editorInfo: undefined });
                        await update;

                        // The 3rd cell should be focused
                        assert.ok(isCellFocused(wrapper, 'NativeCell', 2));

                        update = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered);
                        simulateKeyPressOnCell(2, { code: 'Enter', shiftKey: true, editorInfo: undefined });
                        await update;
                        wrapper.update();

                        // The fourth cell should be focused and not selected.
                        assert.ok(!isCellSelected(wrapper, 'NativeCell', 3));

                        // The fourth cell should be focused
                        assert.ok(isCellFocused(wrapper, 'NativeCell', 3));
                    });

                    test("Pressing 'Ctrl+Enter' on a selected cell executes the cell and cell selection is not changed", async () => {
                        const update = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered);
                        clickCell(1);
                        simulateKeyPressOnCell(1, { code: 'Enter', ctrlKey: true, editorInfo: undefined });
                        await update;

                        // Ensure cell was executed.
                        verifyHtmlOnCell(wrapper, 'NativeCell', '2', 1);

                        // The first cell should be selected.
                        assert.ok(isCellSelected(wrapper, 'NativeCell', 1));
                    });

                    test("Pressing 'Alt+Enter' on a selected cell adds a new cell below it", async () => {
                        // Initially 3 cells.
                        wrapper.update();
                        assert.equal(wrapper.find('NativeCell').length, 3);

                        const update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        clickCell(1);
                        simulateKeyPressOnCell(1, { code: 'Enter', altKey: true, editorInfo: undefined });
                        await update;

                        // The second cell should be focused.
                        assert.ok(isCellFocused(wrapper, 'NativeCell', 2));
                        // There should be 4 cells.
                        assert.equal(wrapper.find('NativeCell').length, 4);
                    });

                    test('Auto brackets work', async () => {
                        wrapper.update();
                        // Initially 3 cells.
                        assert.equal(wrapper.find('NativeCell').length, 3);

                        // Give focus
                        let update = waitForMessage(ioc, InteractiveWindowMessages.SelectedCell);
                        clickCell(1);
                        await update;
                        update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        simulateKeyPressOnCell(1, { code: 'Enter', editorInfo: undefined });
                        await update;

                        // The first cell should be focused.
                        assert.ok(isCellFocused(wrapper, 'NativeCell', 1));

                        // Add cell
                        await addCell(mount, '', false);
                        assert.equal(wrapper.find('NativeCell').length, 4);

                        // New cell should have focus
                        assert.ok(isCellFocused(wrapper, 'NativeCell', 2));

                        const editorEnzyme = getNativeFocusedEditor(wrapper);

                        // Type in something with brackets
                        typeCode(editorEnzyme, 'a(');

                        // Verify cell content
                        const reactEditor = editorEnzyme!.instance() as MonacoEditor;
                        const editor = reactEditor.state.editor;
                        if (editor) {
                            assert.equal(editor.getModel()!.getValue(), 'a()', 'Text does not have brackets');
                        }
                    });

                    test('Navigating cells using up/down keys while focus is set to editor', async () => {
                        wrapper.update();

                        const firstCell = 0;
                        const secondCell = 1;

                        // Set focus to the first cell.
                        let update = waitForMessage(ioc, InteractiveWindowMessages.SelectedCell);
                        clickCell(firstCell);
                        await update;
                        update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        simulateKeyPressOnCell(firstCell, { code: 'Enter' });
                        await update;
                        assert.ok(isCellFocused(wrapper, 'NativeCell', firstCell));

                        // Now press the down arrow, and focus should go to the next cell.
                        update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        let monacoEditor = getNativeFocusedEditor(wrapper)!.instance() as MonacoEditor;
                        monacoEditor.getCurrentVisibleLine = () => 0;
                        monacoEditor.getVisibleLineCount = () => 1;
                        simulateKeyPressOnCell(firstCell, { code: 'ArrowDown' });
                        await update;

                        // The next cell must be focused, but not selected.
                        assert.isFalse(
                            isCellFocused(wrapper, 'NativeCell', firstCell),
                            'First new cell must not be focused'
                        );
                        assert.isTrue(
                            isCellFocused(wrapper, 'NativeCell', secondCell),
                            'Second new cell must be focused'
                        );
                        assert.isFalse(
                            isCellSelected(wrapper, 'NativeCell', firstCell),
                            'First new cell must not be selected'
                        );
                        assert.isFalse(
                            isCellSelected(wrapper, 'NativeCell', secondCell),
                            'Second new cell must not be selected'
                        );

                        // Now press the up arrow, and focus should go back to the first cell.
                        update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        monacoEditor = getNativeFocusedEditor(wrapper)!.instance() as MonacoEditor;
                        monacoEditor.getCurrentVisibleLine = () => 0;
                        monacoEditor.getVisibleLineCount = () => 1;
                        simulateKeyPressOnCell(firstCell, { code: 'ArrowUp' });
                        await update;

                        // The first cell must be focused, but not selected.
                        assert.isTrue(
                            isCellFocused(wrapper, 'NativeCell', firstCell),
                            'First new cell must not be focused'
                        );
                        assert.isFalse(
                            isCellFocused(wrapper, 'NativeCell', secondCell),
                            'Second new cell must be focused'
                        );
                        assert.isFalse(
                            isCellSelected(wrapper, 'NativeCell', firstCell),
                            'First new cell must not be selected'
                        );
                        assert.isFalse(
                            isCellSelected(wrapper, 'NativeCell', secondCell),
                            'Second new cell must not be selected'
                        );
                    });

                    test('Navigating cells using up/down keys through code & markdown cells, while focus is set to editor', async () => {
                        // Previously when pressing ArrowDown with mixture of markdown and code cells,
                        // the cursor would not go past a markdown cell (i.e. markdown editor will not get focus for ArrowDown to work).

                        wrapper.update();

                        // Add a markdown cell at the end.
                        await addMarkdown('4');
                        await addCell(mount, '5', false);
                        await addMarkdown('6');
                        await addCell(mount, '7', false);

                        // Access the code in the cells.
                        const notebookEditorProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                        const model = (notebookEditorProvider.editors[0] as NativeEditorWebView).model;

                        // Set focus to the first cell.
                        let update = waitForMessage(ioc, InteractiveWindowMessages.SelectedCell);
                        clickCell(0);
                        await update;
                        update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        simulateKeyPressOnCell(0, { code: 'Enter' });
                        await update;
                        assert.ok(isCellFocused(wrapper, 'NativeCell', 0));

                        for (let index = 0; index < 5; index += 1) {
                            // 1. Now press the down arrow, and focus should go to the next cell.
                            update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                            const monacoEditor = getNativeFocusedEditor(wrapper)!.instance() as MonacoEditor;
                            monacoEditor.getCurrentVisibleLine = () => 0;
                            monacoEditor.getVisibleLineCount = () => 1;
                            simulateKeyPressOnCell(index, { code: 'ArrowDown' });
                            await update;

                            // Next cell.
                            const expectedActiveCell = model?.cells[index + 1];
                            // The editor has focus, confirm the value in the active element/editor is the code.
                            const codeInActiveElement = ((document.activeElement as any).value as string).trim();
                            const expectedCode = concatMultilineString(expectedActiveCell!.data.source!).trim();
                            assert.equal(codeInActiveElement, expectedCode);
                        }
                    });

                    test("Pressing 'd' on a selected cell twice deletes the cell", async () => {
                        // Initially 3 cells.
                        wrapper.update();
                        assert.equal(wrapper.find('NativeCell').length, 3);

                        clickCell(2);
                        simulateKeyPressOnCell(2, { code: 'd' });
                        simulateKeyPressOnCell(2, { code: 'd' });

                        // There should be 2 cells.
                        assert.equal(wrapper.find('NativeCell').length, 2);
                    });

                    test("Pressing 'a' on a selected cell adds a cell at the current position", async () => {
                        // Initially 3 cells.
                        wrapper.update();
                        assert.equal(wrapper.find('NativeCell').length, 3);

                        clickCell(0);
                        const addedCell = waitForMessage(ioc, CommonActionType.INSERT_ABOVE_AND_FOCUS_NEW_CELL);
                        const update = waitForMessage(ioc, InteractiveWindowMessages.SelectedCell);
                        simulateKeyPressOnCell(0, { code: 'a' });
                        await Promise.all([update, addedCell]);

                        // There should be 4 cells.
                        assert.equal(wrapper.find('NativeCell').length, 4);

                        // Verify cell indexes of old items.
                        verifyCellIndex(wrapper, 'div[id="NotebookImport#0"]', 1);
                        verifyCellIndex(wrapper, 'div[id="NotebookImport#1"]', 2);
                        verifyCellIndex(wrapper, 'div[id="NotebookImport#2"]', 3);
                    });

                    test("Pressing 'b' on a selected cell adds a cell after the current position", async () => {
                        // Initially 3 cells.
                        wrapper.update();
                        assert.equal(wrapper.find('NativeCell').length, 3);

                        clickCell(1);
                        const addedCell = waitForMessage(ioc, CommonActionType.INSERT_BELOW_AND_FOCUS_NEW_CELL);
                        const update = waitForMessage(ioc, InteractiveWindowMessages.SelectedCell);
                        simulateKeyPressOnCell(1, { code: 'b' });
                        await Promise.all([update, addedCell]);

                        // There should be 4 cells.
                        assert.equal(wrapper.find('NativeCell').length, 4);

                        // Verify cell indexes of old items.
                        verifyCellIndex(wrapper, 'div[id="NotebookImport#0"]', 0);
                        verifyCellIndex(wrapper, 'div[id="NotebookImport#1"]', 1);
                        verifyCellIndex(wrapper, 'div[id="NotebookImport#2"]', 3);
                    });

                    test('Toggle visibility of output', async () => {
                        // First execute contents of last cell.
                        let update = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered);
                        clickCell(2);
                        simulateKeyPressOnCell(2, { code: 'Enter', ctrlKey: true, editorInfo: undefined });
                        await update;

                        // Ensure cell was executed.
                        verifyHtmlOnCell(wrapper, 'NativeCell', '3', 2);

                        // Hide the output
                        update = waitForMessage(ioc, InteractiveWindowMessages.OutputToggled);
                        simulateKeyPressOnCell(2, { code: 'o' });
                        await update;

                        // Ensure cell output is hidden (looking for cell results will throw an exception).
                        assert.throws(() => verifyHtmlOnCell(wrapper, 'NativeCell', '3', 2));

                        // Display the output
                        update = waitForMessage(ioc, InteractiveWindowMessages.OutputToggled);
                        simulateKeyPressOnCell(2, { code: 'o' });
                        await update;

                        // Ensure cell output is visible again.
                        verifyHtmlOnCell(wrapper, 'NativeCell', '3', 2);
                    });

                    test("Toggle line numbers using the 'l' key", async () => {
                        clickCell(1);

                        const monacoEditorComponent = wrapper.find(NativeCell).at(1).find(MonacoEditor).first();
                        const editor = (monacoEditorComponent.instance().state as IMonacoEditorState).editor!;
                        const optionsUpdated = sinon.spy(editor, 'updateOptions');

                        // Display line numbers.
                        simulateKeyPressOnCell(1, { code: 'l' });
                        // Confirm monaco editor got updated with line numbers set to turned on.
                        assert.equal(optionsUpdated.lastCall.args[0].lineNumbers, 'on');

                        // toggle the display of line numbers.
                        simulateKeyPressOnCell(1, { code: 'l' });
                        // Confirm monaco editor got updated with line numbers set to turned ff.
                        assert.equal(optionsUpdated.lastCall.args[0].lineNumbers, 'off');
                    });

                    test("Toggle markdown and code modes using 'y' and 'm' keys (cells should not be focused)", async () => {
                        clickCell(1);
                        // Switch to markdown
                        let update = waitForMessage(ioc, CommonActionType.CHANGE_CELL_TYPE);
                        simulateKeyPressOnCell(1, { code: 'm' });
                        await update;

                        // Monaco editor should be rendered and the cell should be markdown
                        assert.ok(!isCellFocused(wrapper, 'NativeCell', 1), '1st cell is not focused');
                        assert.ok(isCellMarkdown(wrapper, 'NativeCell', 1), '1st cell is not markdown');

                        // Switch to code
                        update = waitForMessage(ioc, CommonActionType.CHANGE_CELL_TYPE);
                        simulateKeyPressOnCell(1, { code: 'y' });
                        await update;

                        assert.ok(!isCellFocused(wrapper, 'NativeCell', 1), '1st cell is not focused 2nd time');
                        assert.ok(!isCellMarkdown(wrapper, 'NativeCell', 1), '1st cell is markdown second time');
                    });

                    test("Toggle markdown and code modes using 'y' and 'm' keys & ensure changes to cells is preserved", async () => {
                        clickCell(1);
                        // Switch to markdown
                        let update = waitForMessage(ioc, CommonActionType.CHANGE_CELL_TYPE);
                        simulateKeyPressOnCell(1, { code: 'm' });
                        await update;

                        // Monaco editor should be rendered and the cell should be markdown
                        assert.ok(!isCellFocused(wrapper, 'NativeCell', 1), '1st cell is not focused');
                        assert.ok(isCellMarkdown(wrapper, 'NativeCell', 1), '1st cell is not markdown');

                        // Focus the cell.
                        update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        simulateKeyPressOnCell(1, { code: 'Enter', editorInfo: undefined });
                        await update;

                        assert.ok(isCellFocused(wrapper, 'NativeCell', 1));
                        assert.equal(wrapper.find(NativeCell).at(1).find(MonacoEditor).length, 1);

                        // Change the markdown
                        let editor = getNativeFocusedEditor(wrapper);
                        injectCode(editor, 'foo');

                        // Switch back to code mode.
                        // First lose focus
                        update = waitForMessage(ioc, InteractiveWindowMessages.UnfocusedCellEditor);
                        simulateKeyPressOnCell(1, { code: 'Escape' });
                        await update;

                        // Confirm markdown output is rendered
                        assert.ok(!isCellFocused(wrapper, 'NativeCell', 1), '1st cell is focused');
                        assert.ok(isCellMarkdown(wrapper, 'NativeCell', 1), '1st cell is not markdown');
                        assert.equal(wrapper.find(NativeCell).at(1).find(MonacoEditor).length, 0);

                        // Switch to code
                        update = waitForMessage(ioc, CommonActionType.CHANGE_CELL_TYPE);
                        simulateKeyPressOnCell(1, { code: 'y' });
                        await update;

                        assert.ok(!isCellFocused(wrapper, 'NativeCell', 1), '1st cell is not focused 2nd time');
                        assert.ok(!isCellMarkdown(wrapper, 'NativeCell', 1), '1st cell is markdown second time');

                        // Focus the cell.
                        update = waitForMessage(ioc, InteractiveWindowMessages.FocusedCellEditor);
                        simulateKeyPressOnCell(1, { code: 'Enter', editorInfo: undefined });
                        await update;

                        // Confirm editor still has the same text
                        editor = getNativeFocusedEditor(wrapper);
                        const monacoEditor = editor!.instance() as MonacoEditor;
                        assert.equal('foo', monacoEditor.state.editor!.getValue(), 'Changing cell type lost input');
                    });

                    test("Test undo using the key 'z'", async function () {
                        if (useCustomEditorApi) {
                            // eslint-disable-next-line no-invalid-this
                            return this.skip();
                        }
                        clickCell(0);

                        // Add, then undo, keep doing at least 3 times and confirm it works as expected.
                        for (let i = 0; i < 3; i += 1) {
                            // Add a new cell
                            let update = waitForMessage(ioc, InteractiveWindowMessages.SelectedCell);
                            simulateKeyPressOnCell(0, { code: 'a' });
                            await update;

                            // Wait a bit for the time out to try and set focus a second time (this will be
                            // fixed when we switch to redux)
                            await sleep(100);

                            // There should be 4 cells and first cell is selected.
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 0), true);
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                            assert.equal(isCellFocused(wrapper, 'NativeCell', 0), false);
                            assert.equal(isCellFocused(wrapper, 'NativeCell', 1), false);
                            assert.equal(wrapper.find('NativeCell').length, 4);

                            // Press 'ctrl+z'. This should do nothing
                            simulateKeyPressOnCell(0, { code: 'z', ctrlKey: true });
                            await sleep(100);

                            // There should be 4 cells and first cell is selected.
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 0), true);
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                            assert.equal(isCellFocused(wrapper, 'NativeCell', 0), false);
                            assert.equal(isCellFocused(wrapper, 'NativeCell', 1), false);
                            assert.equal(wrapper.find('NativeCell').length, 4);
                            // Verify our model is correct
                            assert.equal(
                                notebookEditor?.model.cellCount,
                                4,
                                'Undo is not changing cell count in model'
                            );

                            // Press 'meta+z'. This should do nothing
                            simulateKeyPressOnCell(0, { code: 'z', metaKey: true });
                            await sleep(100);

                            // There should be 4 cells and first cell is selected.
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 0), true);
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                            assert.equal(isCellFocused(wrapper, 'NativeCell', 0), false);
                            assert.equal(isCellFocused(wrapper, 'NativeCell', 1), false);
                            assert.equal(wrapper.find('NativeCell').length, 4);

                            // Press 'z' to undo.
                            // Technically not really rendering, but it fires when the cell count changes
                            update = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered);
                            simulateKeyPressOnCell(0, { code: 'z' });
                            await update;

                            // There should be 3 cells and first cell is selected & nothing focused.
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 0), true);
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                            assert.equal(wrapper.find('NativeCell').length, 3);
                            // Verify our model is correct
                            assert.equal(
                                notebookEditor?.model.cellCount,
                                3,
                                'Undo is not changing cell count in model'
                            );

                            // Press 'shift+z' to redo
                            update = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered);
                            simulateKeyPressOnCell(0, { code: 'z', shiftKey: true });
                            await update;

                            // There should be 4 cells and first cell is selected.
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 0), true);
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                            assert.equal(isCellFocused(wrapper, 'NativeCell', 0), false);
                            assert.equal(isCellFocused(wrapper, 'NativeCell', 1), false);
                            assert.equal(wrapper.find('NativeCell').length, 4);
                            // Verify our model is correct
                            assert.equal(
                                notebookEditor?.model.cellCount,
                                4,
                                'Redo is not changing cell count in model'
                            );

                            // Press 'z' to undo.
                            update = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered);
                            simulateKeyPressOnCell(0, { code: 'z' });
                            await update;

                            // There should be 3 cells and first cell is selected & nothing focused.
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 0), true);
                            assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                            assert.equal(wrapper.find('NativeCell').length, 3);

                            // Verify our model is correct
                            assert.equal(
                                notebookEditor?.model.cellCount,
                                3,
                                'Undo is not changing cell count in model'
                            );
                        }
                    });

                    test("Test save using the key 'ctrl+s' on Windows", async function () {
                        if (useCustomEditorApi) {
                            // eslint-disable-next-line no-invalid-this
                            return this.skip();
                        }
                        (window.navigator as any).platform = 'Win';
                        clickCell(0);

                        const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                        await addCell(mount, 'a=1\na', true);
                        await dirtyPromise;

                        const notebookEditorProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                        const editor = notebookEditorProvider.editors[0];
                        assert.ok(editor, 'No editor when saving');
                        const savedPromise = createDeferred();
                        editor.saved(() => savedPromise.resolve());

                        const clean = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);
                        simulateKeyPressOnCell(1, { code: 's', ctrlKey: true });
                        await waitForCondition(
                            () => savedPromise.promise.then(() => true).catch(() => false),
                            10_000,
                            'Timedout'
                        );
                        await clean;
                        assert.ok(!editor!.isDirty, 'Editor should not be dirty after saving');
                    });

                    test("Test save using the key 'ctrl+s' on Mac", async function () {
                        if (useCustomEditorApi) {
                            // eslint-disable-next-line no-invalid-this
                            return this.skip();
                        }
                        (window.navigator as any).platform = 'Mac';
                        clickCell(0);

                        const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                        await addCell(mount, 'a=1\na', true);
                        await dirtyPromise;

                        const notebookEditorProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                        const editor = notebookEditorProvider.editors[0];
                        assert.ok(editor, 'No editor when saving');
                        const savedPromise = createDeferred();
                        editor.saved(() => savedPromise.resolve());

                        simulateKeyPressOnCell(1, { code: 's', ctrlKey: true });

                        await expect(
                            waitForCondition(
                                () => savedPromise.promise.then(() => true).catch(() => false),
                                1_000,
                                'Timedout'
                            )
                        ).to.eventually.be.rejected;

                        assert.ok(editor!.isDirty, 'Editor be dirty as nothing got saved');
                    });

                    test("Test save using the key 'cmd+s' on a Mac", async function () {
                        if (useCustomEditorApi) {
                            // eslint-disable-next-line no-invalid-this
                            return this.skip();
                        }
                        (window.navigator as any).platform = 'Mac';

                        clickCell(0);

                        const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                        await addCell(mount, 'a=1\na', true);
                        await dirtyPromise;

                        const notebookEditorProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                        const editor = notebookEditorProvider.editors[0];
                        assert.ok(editor, 'No editor when saving');
                        const savedPromise = createDeferred();
                        editor.saved(() => savedPromise.resolve());

                        simulateKeyPressOnCell(1, { code: 's', metaKey: true });

                        const clean = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);
                        await waitForCondition(
                            () => savedPromise.promise.then(() => true).catch(() => false),
                            1_000,
                            'Timedout'
                        );
                        await clean;

                        assert.ok(!editor!.isDirty, 'Editor should not be dirty after saving');
                    });
                    test("Test save using the key 'cmd+s' on a Windows", async function () {
                        if (useCustomEditorApi) {
                            // eslint-disable-next-line no-invalid-this
                            return this.skip();
                        }
                        (window.navigator as any).platform = 'Win';

                        clickCell(0);

                        await addCell(mount, 'a=1\na', true);

                        const notebookEditorProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                        const editor = notebookEditorProvider.editors[0];
                        assert.ok(editor, 'No editor when saving');
                        const savedPromise = createDeferred();
                        editor.saved(() => savedPromise.resolve());

                        // CMD+s won't work on Windows.
                        simulateKeyPressOnCell(1, { code: 's', metaKey: true });

                        await expect(
                            waitForCondition(
                                () => savedPromise.promise.then(() => true).catch(() => false),
                                1_000,
                                'Timedout'
                            )
                        ).to.eventually.be.rejected;

                        assert.ok(editor!.isDirty, 'Editor be dirty as nothing got saved');
                    });
                });

                suite('Auto Save', () => {
                    let windowStateChangeHandlers: ((e: WindowState) => any)[] = [];
                    setup(async function () {
                        if (useCustomEditorApi) {
                            // eslint-disable-next-line no-invalid-this
                            return this.skip();
                        }
                        await initIoc();

                        const eventCallback = (
                            listener: (e: WindowState) => any,
                            _thisArgs?: any,
                            _disposables?: IDisposable[] | Disposable
                        ) => {
                            windowStateChangeHandlers.push(listener);
                            return {
                                dispose: noop
                            };
                        };
                        windowStateChangeHandlers = [];
                        // Keep track of all handlers for the onDidChangeWindowState event.
                        when(ioc.applicationShell.onDidChangeWindowState).thenReturn(eventCallback);

                        // eslint-disable-next-line no-invalid-this
                        await setupFunction.call(this);
                    });
                    teardown(() => sinon.restore());

                    /**
                     * Make some kind of a change to the notebook.
                     *
                     * @param {number} cellIndex
                     */
                    async function modifyNotebook() {
                        // (Add a cell into the UI)
                        await addCell(mount, 'a', false);
                    }

                    test('Auto save notebook every 1s', async () => {
                        // Configure notebook to save automatically ever 1s.
                        await updateFileConfig(ioc, 'autoSave', 'afterDelay');
                        await updateFileConfig(ioc, 'autoSaveDelay', 1_000);
                        ioc.forceDataScienceSettingsChanged({});

                        /**
                         * Make some changes to a cell of a notebook, then verify the notebook is auto saved.
                         *
                         * @param {number} cellIndex
                         */
                        async function makeChangesAndConfirmFileIsUpdated() {
                            const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');
                            const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                            const cleanPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);

                            await modifyNotebook();
                            await dirtyPromise;

                            // At this point a message should be sent to extension asking it to save.
                            // After the save, the extension should send a message to react letting it know that it was saved successfully.
                            await cleanPromise;

                            // Confirm file has been updated as well.
                            const newFileContents = await fs.readFile(notebookFile.filePath, 'utf8');
                            assert.notEqual(newFileContents, notebookFileContents);
                        }

                        // Make changes & validate (try a couple of times).
                        await makeChangesAndConfirmFileIsUpdated();
                        await makeChangesAndConfirmFileIsUpdated();
                        await makeChangesAndConfirmFileIsUpdated();
                    }).retries(2);

                    test('File saved with same format', async () => {
                        // Configure notebook to save automatically ever 1s.
                        await updateFileConfig(ioc, 'autoSave', 'afterDelay');
                        await updateFileConfig(ioc, 'autoSaveDelay', 2_000);

                        ioc.forceDataScienceSettingsChanged({});
                        const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');
                        const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                        const cleanPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);

                        await modifyNotebook();
                        await dirtyPromise;

                        // At this point a message should be sent to extension asking it to save.
                        // After the save, the extension should send a message to react letting it know that it was saved successfully.
                        await cleanPromise;

                        // Confirm file is not the same. There should be a single cell that's been added
                        const newFileContents = await fs.readFile(notebookFile.filePath, 'utf8');
                        assert.notEqual(newFileContents, notebookFileContents);
                        assert.equal(newFileContents, addedJSONFile);
                    });

                    test('Should not auto save notebook, ever', async () => {
                        const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');

                        // Configure notebook to to never save.
                        await updateFileConfig(ioc, 'autoSave', 'off');
                        await updateFileConfig(ioc, 'autoSaveDelay', 1_000);

                        // Update the settings and wait for the component to receive it and process it.
                        const promise = waitForMessage(ioc, InteractiveWindowMessages.SettingsUpdated);
                        ioc.forceDataScienceSettingsChanged({
                            showCellInputCode: false
                        });
                        await promise;

                        const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                        const cleanPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean, {
                            timeoutMs: 5_000
                        });

                        await modifyNotebook();
                        await dirtyPromise;

                        // Now that the notebook is dirty, change the active editor.
                        const docManager = ioc.get<IDocumentManager>(IDocumentManager) as MockDocumentManager;
                        docManager.didChangeActiveTextEditorEmitter.fire({} as any);
                        // Also, send notification about changes to window state.
                        windowStateChangeHandlers.forEach((item) => item({ focused: false }));
                        windowStateChangeHandlers.forEach((item) => item({ focused: true }));

                        // Confirm the message is not clean, trying to wait for it to get saved will timeout (i.e. rejected).
                        await expect(cleanPromise).to.eventually.be.rejected;
                        // Confirm file has not been updated as well.
                        assert.equal(await fs.readFile(notebookFile.filePath, 'utf8'), notebookFileContents);
                    }).timeout(10_000);

                    async function testAutoSavingWhenEditorFocusChanges(newEditor: TextEditor | undefined) {
                        const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');
                        const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                        const cleanPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);

                        await modifyNotebook();
                        await dirtyPromise;

                        // Configure notebook to save when active editor changes.
                        await updateFileConfig(ioc, 'autoSave', 'onFocusChange');
                        ioc.forceDataScienceSettingsChanged({});

                        // Now that the notebook is dirty, change the active editor.
                        const docManager = ioc.get<IDocumentManager>(IDocumentManager) as MockDocumentManager;
                        docManager.didChangeActiveTextEditorEmitter.fire(newEditor!);

                        // At this point a message should be sent to extension asking it to save.
                        // After the save, the extension should send a message to react letting it know that it was saved successfully.
                        await cleanPromise;

                        // Confirm file has been updated as well.
                        assert.notEqual(await fs.readFile(notebookFile.filePath, 'utf8'), notebookFileContents);
                    }

                    test('Auto save notebook when focus changes from active editor to none', () =>
                        testAutoSavingWhenEditorFocusChanges(undefined));

                    test('Auto save notebook when focus changes from active editor to something else', () =>
                        testAutoSavingWhenEditorFocusChanges(TypeMoq.Mock.ofType<TextEditor>().object));

                    test('Should not auto save notebook when active editor changes', async () => {
                        const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');
                        const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                        const cleanPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean, {
                            timeoutMs: 5_000
                        });

                        await modifyNotebook();
                        await dirtyPromise;

                        // Configure notebook to save when window state changes.
                        await updateFileConfig(ioc, 'autoSave', 'onWindowChange');
                        ioc.forceDataScienceSettingsChanged({});

                        // Now that the notebook is dirty, change the active editor.
                        // This should not trigger a save of notebook (as its configured to save only when window state changes).
                        const docManager = ioc.get<IDocumentManager>(IDocumentManager) as MockDocumentManager;
                        docManager.didChangeActiveTextEditorEmitter.fire({} as any);

                        // Confirm the message is not clean, trying to wait for it to get saved will timeout (i.e. rejected).
                        await expect(cleanPromise).to.eventually.be.rejected;
                        // Confirm file has not been updated as well.
                        assert.equal(await fs.readFile(notebookFile.filePath, 'utf8'), notebookFileContents);
                    }).timeout(10_000);

                    async function testAutoSavingWithChangesToWindowState(
                        configSetting: 'onFocusChange' | 'onWindowChange',
                        focused: boolean
                    ) {
                        const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');
                        const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                        const cleanPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);

                        await modifyNotebook();
                        await dirtyPromise;

                        // Configure notebook to save when active editor changes.
                        await updateFileConfig(ioc, 'autoSave', configSetting);
                        ioc.forceDataScienceSettingsChanged({});

                        // Now that the notebook is dirty, send notification about changes to window state.
                        windowStateChangeHandlers.forEach((item) => item({ focused }));

                        // At this point a message should be sent to extension asking it to save.
                        // After the save, the extension should send a message to react letting it know that it was saved successfully.
                        await cleanPromise;

                        // Confirm file has been updated as well.
                        assert.notEqual(await fs.readFile(notebookFile.filePath, 'utf8'), notebookFileContents);
                    }

                    test('Auto save notebook when window state changes to being not focused', async () =>
                        testAutoSavingWithChangesToWindowState('onWindowChange', false));
                    test('Auto save notebook when window state changes to being focused', async () =>
                        testAutoSavingWithChangesToWindowState('onWindowChange', true));
                    test('Auto save notebook when window state changes to being focused for focusChange', async () =>
                        testAutoSavingWithChangesToWindowState('onFocusChange', true));
                    test('Auto save notebook when window state changes to being not focused for focusChange', async () =>
                        testAutoSavingWithChangesToWindowState('onFocusChange', false));

                    test('Auto save notebook when view state changes', async () => {
                        const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');
                        const dirtyPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                        const cleanPromise = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);

                        await modifyNotebook();
                        await dirtyPromise;

                        // Configure notebook to save when active editor changes.
                        await updateFileConfig(ioc, 'autoSave', 'onFocusChange');
                        ioc.forceDataScienceSettingsChanged({});

                        // Force a view state change
                        mount.changeViewState(true, false);

                        // At this point a message should be sent to extension asking it to save.
                        // After the save, the extension should send a message to react letting it know that it was saved successfully.
                        await cleanPromise;

                        // Confirm file has been updated as well.
                        assert.notEqual(await fs.readFile(notebookFile.filePath, 'utf8'), notebookFileContents);
                    });
                });

                const oldJson: nbformat.INotebookContent = {
                    nbformat: 4,
                    nbformat_minor: 2,
                    cells: [
                        {
                            cell_type: 'code',
                            execution_count: 1,
                            metadata: {
                                collapsed: true
                            },
                            outputs: [
                                {
                                    data: {
                                        'text/plain': ['1']
                                    },
                                    output_type: 'execute_result',
                                    execution_count: 1,
                                    metadata: {}
                                }
                            ],
                            source: ['a=1\n', 'a']
                        },
                        {
                            cell_type: 'code',
                            execution_count: 2,
                            metadata: {},
                            outputs: [
                                {
                                    data: {
                                        'text/plain': ['2']
                                    },
                                    output_type: 'execute_result',
                                    execution_count: 2,
                                    metadata: {}
                                }
                            ],
                            source: ['b=2\n', 'b']
                        },
                        {
                            cell_type: 'code',
                            execution_count: 3,
                            metadata: {},
                            outputs: [
                                {
                                    data: {
                                        'text/plain': ['3']
                                    },
                                    output_type: 'execute_result',
                                    execution_count: 3,
                                    metadata: {}
                                }
                            ],
                            source: ['c=3\n', 'c']
                        }
                    ],
                    metadata: {
                        orig_nbformat: 4,
                        kernelspec: {
                            display_name: 'JUNK',
                            name: 'JUNK'
                        },
                        language_info: {
                            name: 'python',
                            version: '1.2.3'
                        }
                    }
                };

                suite('Stop On Error', () => {
                    let notebookEditor: { editor: INotebookEditor; mount: IMountedWebView };
                    setup(async () => {
                        await initIoc();

                        // Set up a file where the second cell throws an exception
                        addMockData(ioc, 'print("hello")', 'hello');
                        addMockData(ioc, 'raise Exception("stop")', undefined, undefined, 'error');
                        addMockData(ioc, 'print("world")', 'world');

                        const errorFile = [
                            { id: 'NotebookImport#0', data: { source: 'print("hello")' } },
                            { id: 'NotebookImport#1', data: { source: 'raise Exception("stop")' } },
                            { id: 'NotebookImport#2', data: { source: 'print("world")' } }
                        ];
                        const runAllCells = errorFile.map((cell) => {
                            return createFileCell(cell, cell.data);
                        });
                        const notebook = await ioc
                            .get<INotebookExporter>(INotebookExporter)
                            .translateToNotebook(runAllCells, undefined);
                        notebookEditor = await openEditor(ioc, JSON.stringify(notebook));
                    });

                    test('Stop On Error On', async () => {
                        const ne = notebookEditor;

                        const runAllButton = findButton(ne.mount.wrapper, NativeEditor, 0);
                        // The render method needs to be executed 3 times for three cells.
                        const threeCellsUpdated = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered, {
                            numberOfTimes: 3
                        });
                        runAllButton!.simulate('click');
                        await threeCellsUpdated;

                        verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', `hello`, 0);
                        // There should be no output on the third cell as it's blocked by the exception on the second cell
                        assert.throws(() => verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', `world`, 2));
                    });

                    test('Stop On Error Off', async () => {
                        const ne = notebookEditor;

                        // Force our settings to not stop on error
                        ioc.forceDataScienceSettingsChanged({ stopOnError: false });

                        const runAllButton = findButton(ne.mount.wrapper, NativeEditor, 0);
                        // The render method needs to be executed 3 times for three cells.
                        const threeCellsUpdated = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered, {
                            numberOfTimes: 3
                        });
                        runAllButton!.simulate('click');
                        await threeCellsUpdated;

                        verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', `hello`, 0);
                        // There should be output on the third cell, even with an error on the second
                        verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', `world`, 2);
                    });
                });

                suite('Update Metadata', () => {
                    setup(async function () {
                        await initIoc();
                        // eslint-disable-next-line no-invalid-this
                        await setupFunction.call(this, JSON.stringify(oldJson));
                    });

                    test('Update notebook metadata on execution', async () => {
                        const notebookEditorProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                        const editor = notebookEditorProvider.editors[0];
                        assert.ok(editor, 'No editor when saving');

                        // add cells, run them and save
                        await addCell(mount, 'a=1\na');
                        const runAllButton = findButton(wrapper, NativeEditor, 0);
                        const threeCellsUpdated = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered, {
                            numberOfTimes: 3
                        });
                        runAllButton!.simulate('click');
                        await threeCellsUpdated;

                        const saveButton = findButton(wrapper, NativeEditor, 8);
                        const saved = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);
                        saveButton!.simulate('click');
                        await saved;

                        // the file has output and execution count
                        const fileContent = await fs.readFile(notebookFile.filePath, 'utf8');
                        const fileObject = JSON.parse(fileContent);

                        // First cell should still have the 'collapsed' metadata
                        assert.ok(fileObject.cells[0].metadata.collapsed, 'Metadata erased during execution');

                        // Some tests don't have a kernelspec, in which case we should remove it
                        // If there is a spec, we should update the name and display name
                        const isRollingBuild = process.env ? process.env.VSC_FORCE_REAL_JUPYTER !== undefined : false;
                        if (isRollingBuild && fileObject.metadata.kernelspec) {
                            // Old language info should be changed by the new execution
                            assert.notEqual(fileObject.metadata.language_info.version, '1.2.3');
                            assert.notEqual(fileObject.metadata.kernelspec.display_name, 'JUNK');
                            assert.notEqual(fileObject.metadata.kernelspec.name, 'JUNK');
                            assert.notEqual(
                                fileObject.metadata.kernelspec.name,
                                fileObject.metadata.kernelspec.display_name,
                                'Kernel display name should be different than the name'
                            );
                        }
                    });
                });

                suite('Clear Outputs', () => {
                    setup(async function () {
                        await initIoc();
                        // eslint-disable-next-line no-invalid-this
                        await setupFunction.call(this, JSON.stringify(oldJson));
                    });

                    function verifyExecutionCount(cellIndex: number, executionCountContent: string) {
                        assert.equal(wrapper.find(ExecutionCount).at(cellIndex).props().count, executionCountContent);
                    }

                    test('Clear Outputs in WebView', async () => {
                        const runAllButton = findButton(wrapper, NativeEditor, 0);
                        const threeCellsUpdated = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered, {
                            numberOfTimes: 3
                        });
                        runAllButton!.simulate('click');
                        await threeCellsUpdated;

                        verifyExecutionCount(0, '1');
                        verifyExecutionCount(1, '2');
                        verifyExecutionCount(2, '3');

                        // Press clear all outputs
                        const clearAllOutput = waitForMessage(ioc, InteractiveWindowMessages.ClearAllOutputs);
                        const clearAllOutputButton = findButton(wrapper, NativeEditor, 6);
                        clearAllOutputButton!.simulate('click');
                        await clearAllOutput;

                        verifyExecutionCount(0, '-');
                        verifyExecutionCount(1, '-');
                        verifyExecutionCount(2, '-');
                    });

                    test('Clear execution_count and outputs in notebook', async () => {
                        const notebookEditorProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                        const editor = notebookEditorProvider.editors[0];
                        assert.ok(editor, 'No editor when saving');
                        // add cells, run them and save
                        // await addCell(mount, 'a=1\na');
                        const runAllButton = findButton(wrapper, NativeEditor, 0);
                        const threeCellsUpdated = waitForMessage(ioc, InteractiveWindowMessages.ExecutionRendered, {
                            numberOfTimes: 3
                        });
                        runAllButton!.simulate('click');
                        await threeCellsUpdated;

                        const saveButton = findButton(wrapper, NativeEditor, 8);
                        let saved = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);
                        saveButton!.simulate('click');
                        await saved;

                        // press clear all outputs, and save
                        const cleared = waitForMessage(ioc, InteractiveWindowMessages.NotebookDirty);
                        const clearAllOutputButton = findButton(wrapper, NativeEditor, 6);
                        clearAllOutputButton!.simulate('click');
                        await cleared;

                        saved = waitForMessage(ioc, InteractiveWindowMessages.NotebookClean);
                        saveButton!.simulate('click');
                        await saved;
                        await sleep(1000); // Make sure file finishes writing.

                        const nb = JSON.parse(
                            await fs.readFile(notebookFile.filePath, 'utf8')
                        ) as nbformat.INotebookContent;
                        assert.equal(nb.cells[0].execution_count, null);
                        assert.equal(nb.cells[1].execution_count, null);
                        assert.equal(nb.cells[2].execution_count, null);
                        expect(nb.cells[0].outputs).to.be.lengthOf(0);
                        expect(nb.cells[1].outputs).to.be.lengthOf(0);
                        expect(nb.cells[2].outputs).to.be.lengthOf(0);
                    });
                });
            });
        });
    });
});
