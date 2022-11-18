// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
suite('Dummy6', () => {
    test('dummy6', () => {
        //
    });
});

// // Copyright (c) Microsoft Corporation.
// // Licensed under the MIT License.
// 'use strict';
// import assert from 'assert';
// import * as fs from 'fs-extra';
// import { parse } from 'node-html-parser';
// import * as os from 'os';
// import * as path from 'path';
// import * as TypeMoq from 'typemoq';
// import { Disposable, Memento, Selection, TextDocument, TextEditor, Uri } from 'vscode';

// import type * as nbformat from '@jupyterlab/nbformat';
// import { ReactWrapper } from 'enzyme';
// import { anything, when } from 'ts-mockito';
// import { IApplicationShell, IDocumentManager } from '../../platform/common/application/types';
// import { IFileSystem } from '../../platform/common/platform/types';
// import { GLOBAL_MEMENTO, IJupyterSettings, IMemento } from '../../platform/common/types';
// import { createDeferred, sleep, waitForPromise } from '../../platform/common/utils/async';
// import { noop } from '../../platform/common/utils/misc';
// import { EXTENSION_ROOT_DIR } from '../../platform/constants';
// import { generateCellsFromDocument } from '../../platform/datascience/cellFactory';
// import { AllowedCellOutputKeys } from '../../platform/datascience/common';
// import { EditorContexts } from '../../platform/datascience/constants';
// import { InteractiveWindowMessages } from '../../platform/datascience/interactive-common/interactiveWindowTypes';
// import { InteractiveWindow } from '../../platform/datascience/interactive-window/interactiveWindow';
// import { AskedForPerFileSettingKey } from '../../platform/datascience/interactive-window/interactiveWindowProvider';
// import { IInteractiveWindowProvider, IWebviewExtensibility } from '../../platform/datascience/types';
// import { IInterpreterService } from '../../platform/interpreter/contracts';
// import { concatMultilineString } from '../../webviews/webview-side/common';
// import { InteractivePanel } from '../../webviews/webview-side/history-react/interactivePanel';
// import { IKeyboardEvent } from '../../webviews/webview-side/react-common/event';
// import { ImageButton } from '../../webviews/webview-side/react-common/imageButton';
// import { InterpreterService } from '../interpreters/interpreterService';
// import { DataScienceIocContainer } from './dataScienceIocContainer';
// import { createDocument } from './editor-integration/helpers';
// import { defaultDataScienceSettings, takeSnapshot, writeDiffSnapshot } from './helpers';
// import {
//     addCode,
//     closeInteractiveWindow,
//     createCodeWatcher,
//     getInteractiveCellResults,
//     getOrCreateInteractiveWindow,
//     runCodeLens,
//     runTest
// } from './interactiveWindowTestHelpers';
// import { MockDocumentManager } from './mockDocumentManager';
// import { MockEditor } from './mockTextEditor';
// import { addCell, createNewEditor } from './nativeEditorTestHelpers';
// import {
//     addContinuousMockData,
//     addInputMockData,
//     addMockData,
//     CellInputState,
//     CellPosition,
//     enterEditorKey,
//     enterInput,
//     escapePath,
//     findButton,
//     getInteractiveEditor,
//     getLastOutputCell,
//     srcDirectory,
//     submitInput,
//     toggleCellExpansion,
//     typeCode,
//     verifyHtmlOnCell,
//     verifyLastCellInputState
// } from './testHelpers';
// import { ITestInteractiveWindowProvider } from './testInteractiveWindowProvider';
// import { InteractiveWindowMessageListener } from '../../platform/datascience/interactive-common/interactiveWindowMessageListener';
// import { IExportDialog } from '../../platform/datascience/export/types';
// // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
// const _escape = require('lodash/escape') as typeof import('lodash/escape'); // NOSONAR

// /* eslint-disable , comma-dangle, @typescript-eslint/no-explicit-any, no-multi-str */
// suite('Interactive Window output tests', () => {
//     const disposables: Disposable[] = [];
//     let ioc: DataScienceIocContainer;
//     const defaultCellMarker = '# %%';
//     let snapshot: any;

//     suiteSetup(() => {
//         snapshot = takeSnapshot();
//     });
//     setup(async () => {
//         ioc = new DataScienceIocContainer();
//         ioc.registerDataScienceTypes();
//         return ioc.activate();
//     });

//     suiteTeardown(() => {
//         writeDiffSnapshot(snapshot, 'Interactive Window');
//     });

//     teardown(async () => {
//         for (const disposable of disposables) {
//             if (!disposable) {
//                 continue;
//             }
//             // eslint-disable-next-line @typescript-eslint/no-explicit-any
//             const promise = disposable.dispose() as Promise<any>;
//             if (promise) {
//                 await promise;
//             }
//         }
//         await ioc.dispose();
//     });

//     async function forceSettingsChange(newSettings: Partial<IJupyterSettings>) {
//         const { mount } = await getOrCreateInteractiveWindow(ioc);
//         const update = mount.waitForMessage(InteractiveWindowMessages.SettingsUpdated);
//         ioc.forceDataScienceSettingsChanged(newSettings);
//         return update;
//     }

//     function simulateKeyPressOnEditor(
//         editorControl: ReactWrapper<any, Readonly<{}>, React.Component> | undefined,
//         keyboardEvent: Partial<IKeyboardEvent> & { code: string }
//     ) {
//         enterEditorKey(editorControl, keyboardEvent);
//     }

//     function verifyHtmlOnInteractiveCell(html: string | undefined | RegExp, cellIndex: number | CellPosition) {
//         const iw = ioc.getInteractiveWebPanel(undefined).wrapper;
//         iw.update();
//         verifyHtmlOnCell(iw, 'InteractiveCell', html, cellIndex);
//     }

//     runTest(
//         'Export',
//         async () => {
//             // Export should cause the export dialog to come up. Remap appshell so we can check
//             const dummyDisposable = {
//                 dispose: () => {
//                     return;
//                 }
//             };
//             const dsfs = ioc.get<IFileSystem>(IFileSystem);
//             const tf = await dsfs.createTemporaryLocalFile('.ipynb');
//             try {
//                 let exportCalled = false;
//                 const appShell = TypeMoq.Mock.ofType<IApplicationShell>();
//                 const exportDialog = TypeMoq.Mock.ofType<IExportDialog>();
//                 appShell
//                     .setup((a) => a.showErrorMessage(TypeMoq.It.isAnyString()))
//                     .returns((e) => {
//                         throw e;
//                     });
//                 appShell
//                     .setup((a) => a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
//                     .returns(() => Promise.resolve(''));
//                 exportDialog
//                     .setup((a) => a.showDialog(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
//                     .returns(() => {
//                         exportCalled = true;
//                         return Promise.resolve(Uri.file(tf.filePath));
//                     });
//                 appShell.setup((a) => a.setStatusBarMessage(TypeMoq.It.isAny())).returns(() => dummyDisposable);
//                 ioc.serviceManager.rebindInstance<IApplicationShell>(IApplicationShell, appShell.object);
//                 ioc.serviceManager.rebindInstance<IExportDialog>(IExportDialog, exportDialog.object);
//                 const exportCode = `
// for i in range(100):
//     time.sleep(0.1)
//     raise Exception('test')
// `;

//                 // Make sure to create the interactive window after the rebind or it gets the wrong application shell.
//                 addMockData(ioc, exportCode, 'NameError', 'type/error', 'error', [
//                     '\u001b[1;31m---------------------------------------------------------------------------\u001b[0m',
//                     '\u001b[1;31mNameError\u001b[0m                                 Traceback (most recent call last)',
//                     "\u001b[1;32md:\\Source\\Testing_3\\manualTestFile.py\u001b[0m in \u001b[0;36m<module>\u001b[1;34m\u001b[0m\n\u001b[0;32m      1\u001b[0m \u001b[1;32mfor\u001b[0m \u001b[0mi\u001b[0m \u001b[1;32min\u001b[0m \u001b[0mrange\u001b[0m\u001b[1;33m(\u001b[0m\u001b[1;36m100\u001b[0m\u001b[1;33m)\u001b[0m\u001b[1;33m:\u001b[0m\u001b[1;33m\u001b[0m\u001b[1;33m\u001b[0m\u001b[0m\n\u001b[1;32m----> 2\u001b[1;33m     \u001b[0mtime\u001b[0m\u001b[1;33m.\u001b[0m\u001b[0msleep\u001b[0m\u001b[1;33m(\u001b[0m\u001b[1;36m0.1\u001b[0m\u001b[1;33m)\u001b[0m\u001b[1;33m\u001b[0m\u001b[1;33m\u001b[0m\u001b[0m\n\u001b[0m\u001b[0;32m      3\u001b[0m     \u001b[1;32mraise\u001b[0m \u001b[0mException\u001b[0m\u001b[1;33m(\u001b[0m\u001b[1;34m'test'\u001b[0m\u001b[1;33m)\u001b[0m\u001b[1;33m\u001b[0m\u001b[1;33m\u001b[0m\u001b[0m\n",
//                     "\u001b[1;31mNameError\u001b[0m: name 'time' is not defined"
//                 ]);
//                 await addCode(ioc, exportCode);
//                 const { window, mount } = await getOrCreateInteractiveWindow(ioc);

//                 // Export should cause exportCalled to change to true
//                 const exportPromise = mount.waitForMessage(InteractiveWindowMessages.ReturnAllCells);
//                 window.exportCells();
//                 await exportPromise;
//                 await sleep(100); // Give time for appshell to come up
//                 assert.equal(exportCalled, true, 'Export is not being called during export');

//                 // Read file contents into a jupyter structure. Make sure we have only the expected values
//                 const contents = await dsfs.readLocalFile(tf.filePath);
//                 const struct = JSON.parse(contents) as nbformat.INotebookContent;
//                 assert.strictEqual(struct.cells.length, 1, 'Wrong number of cells');
//                 const outputs = struct.cells[0].outputs as nbformat.IOutput[];
//                 assert.strictEqual(outputs.length, 1, 'Not correct number of outputs');
//                 assert.strictEqual(outputs[0].output_type, 'error', 'Error not found');
//                 const allowedKeys = [...AllowedCellOutputKeys.error];
//                 const actualKeys = Object.keys(outputs[0]);
//                 assert.deepStrictEqual(allowedKeys, actualKeys, 'Invalid keys in output');

//                 // Remove the cell
//                 const exportButton = findButton(mount.wrapper, InteractivePanel, 6);
//                 const undo = findButton(mount.wrapper, InteractivePanel, 2);

//                 // Now verify if we undo, we have no cells
//                 const afterUndo = await getInteractiveCellResults(ioc, () => {
//                     undo!.simulate('click');
//                     return Promise.resolve();
//                 });

//                 assert.equal(afterUndo.length, 1, 'Undo should remove cells');

//                 // Then verify we cannot click the button (it should be disabled)
//                 exportCalled = false;
//                 exportButton!.simulate('click');
//                 await sleep(100);
//                 assert.equal(exportCalled, false, 'Export should not be called when no cells visible');
//             } finally {
//                 tf.dispose();
//             }
//         },
//         () => {
//             return ioc;
//         }
//     );
//     runTest(
//         'Restart with session failure',
//         async () => {
//             // Prime the pump
//             await addCode(ioc, 'a=1\na');
//             verifyHtmlOnInteractiveCell('1', CellPosition.Last);

//             // Then something that could possibly timeout
//             addContinuousMockData(ioc, 'import time\r\ntime.sleep(1000)', (_c) => {
//                 return Promise.resolve({ result: '', haveMore: true });
//             });

//             // Then get our mock session and force it to not restart ever.
//             if (ioc.mockJupyter) {
//                 const currentSession = ioc.mockJupyter.getCurrentSession();
//                 if (currentSession) {
//                     currentSession.prolongRestarts();
//                 }
//             }

//             // Then try executing our long running cell and restarting in the middle
//             const { window } = await getOrCreateInteractiveWindow(ioc);
//             const executed = createDeferred();
//             // We have to wait until the execute goes through before we reset.
//             if (window.onExecutedCode) {
//                 window.onExecutedCode(() => executed.resolve());
//             }
//             const added = window.addCode('import time\r\ntime.sleep(1000)', Uri.file('foo'), 0);
//             await executed.promise;
//             await window.restartKernel();
//             await added;

//             // Now see if our wrapper still works. Interactive window should have forced a restart
//             await window.addCode('a=1\na', Uri.file('foo'), 0);
//             verifyHtmlOnInteractiveCell('1', CellPosition.Last);
//         },
//         () => {
//             return ioc;
//         }
//     );

//     runTest(
//         'LiveLossPlot',
//         async () => {
//             // Only run this test when not mocking. Too complicated to mimic otherwise
//             if (!ioc.mockJupyter) {
//                 // Load all of our cells
//                 const testFile = path.join(srcDirectory(), 'liveloss.py');
//                 const version = 1;
//                 const inputText = await fs.readFile(testFile, 'utf-8');
//                 const document = createDocument(inputText, testFile, version, TypeMoq.Times.atLeastOnce(), true);
//                 const cells = generateCellsFromDocument(document.object);
//                 assert.ok(cells, 'No cells generated');
//                 assert.equal(cells.length, 2, 'Not enough cells generated');

//                 // Run the first cell
//                 await addCode(ioc, concatMultilineString(cells[0].data.source));

//                 // Last cell should generate a series of updates. Verify we end up with a single image
//                 await addCode(ioc, concatMultilineString(cells[1].data.source));
//                 const cell = getLastOutputCell(ioc.getInteractiveWebPanel(undefined).wrapper, 'InteractiveCell');

//                 const output = cell!.find('div.cell-output');
//                 assert.ok(output.length > 0, 'No output cell found');
//                 const outHtml = output.html();

//                 const root = parse(outHtml) as any;
//                 const png = root.querySelectorAll('img') as HTMLElement[];
//                 assert.ok(png, 'No pngs found');
//                 assert.equal(png.length, 1, 'Wrong number of pngs');
//             }
//         },
//         () => {
//             return ioc;
//         }
//     );

//     runTest(
//         'Copy back to source',
//         async (_wrapper) => {
//             ioc.addDocument(`${defaultCellMarker}${os.EOL}print("bar")`, 'foo.py');
//             const docManager = ioc.get<IDocumentManager>(IDocumentManager);
//             docManager.showTextDocument(docManager.textDocuments[0]);
//             const { window } = await getOrCreateInteractiveWindow(ioc);
//             const interactiveWindow = window as InteractiveWindow;
//             await interactiveWindow.copyCode({ source: 'print("baz")' });
//             assert.equal(
//                 docManager.textDocuments[0].getText(),
//                 `${defaultCellMarker}${os.EOL}print("baz")${os.EOL}${defaultCellMarker}${os.EOL}print("bar")`,
//                 'Text not inserted'
//             );
//             const activeEditor = docManager.activeTextEditor as MockEditor;
//             activeEditor.selection = new Selection(1, 2, 1, 2);
//             await interactiveWindow.copyCode({ source: 'print("baz")' });
//             assert.equal(
//                 docManager.textDocuments[0].getText(),
//                 `${defaultCellMarker}${os.EOL}${defaultCellMarker}${os.EOL}print("baz")${os.EOL}${defaultCellMarker}${os.EOL}print("baz")${os.EOL}${defaultCellMarker}${os.EOL}print("bar")`,
//                 'Text not inserted'
//             );
//         },
//         () => {
//             return ioc;
//         }
//     );

//     runTest(
//         'Limit text output',
//         async () => {
//             await forceSettingsChange({ textOutputLimit: 8 });

//             // Output should be trimmed to just two lines of output
//             const code = `print("hello\\nworld\\nhow\\nare\\nyou")`;
//             addMockData(ioc, code, 'are\nyou\n');
//             await addCode(ioc, code);

//             verifyHtmlOnInteractiveCell('>are\nyou', CellPosition.Last);
//         },
//         () => {
//             return ioc;
//         }
//     );

//     runTest(
//         'Type in input',
//         async () => {
//             when(ioc.applicationShell.showInputBox(anything())).thenReturn(Promise.resolve('typed input'));
//             // Send in some special input
//             const code = `b = input('Test')\nb`;
//             addInputMockData(ioc, code, 'typed input');
//             await addCode(ioc, code);

//             verifyHtmlOnInteractiveCell('typed input', CellPosition.Last);
//         },
//         () => {
//             return ioc;
//         }
//     );
//     runTest(
//         'Update display data',
//         async (context) => {
//             if (ioc.mockJupyter) {
//                 context.skip();
//             } else {
//                 // Create 3 cells. Last cell should update the second
//                 await addCode(ioc, 'dh = display(display_id=True)');
//                 await addCode(ioc, 'dh.display("Hello")');
//                 verifyHtmlOnInteractiveCell('Hello', CellPosition.Last);
//                 await addCode(ioc, 'dh.update("Goodbye")');
//                 verifyHtmlOnInteractiveCell('<div></div>', CellPosition.Last);
//                 verifyHtmlOnInteractiveCell('Goodbye', 1);
//             }
//         },
//         () => {
//             return ioc;
//         }
//     );

//     test('Open notebook and interactive at the same time', async () => {
//         addMockData(ioc, 'a=1\na', 1, 'text/plain');
//         addMockData(ioc, 'b=2\nb', 2, 'text/plain');

//         // Mount two different webviews
//         const ne = await createNewEditor(ioc);
//         let iw = await getOrCreateInteractiveWindow(ioc);

//         // Run code in both
//         await addCode(ioc, 'a=1\na');
//         await addCell(ne.mount, 'a=1\na', true);

//         // Make sure both are correct
//         verifyHtmlOnCell(iw.mount.wrapper, 'InteractiveCell', '1', CellPosition.Last);
//         verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', '1', CellPosition.Last);

//         // Close the interactive editor.
//         await closeInteractiveWindow(ioc, iw.window);

//         // Run another cell and make sure it works in the notebook
//         await addCell(ne.mount, 'b=2\nb', true);
//         verifyHtmlOnCell(ne.mount.wrapper, 'NativeCell', '2', CellPosition.Last);

//         // Rerun the interactive window
//         iw = await getOrCreateInteractiveWindow(ioc);
//         await addCode(ioc, 'a=1\na');

//         verifyHtmlOnCell(iw.mount.wrapper, 'InteractiveCell', '1', CellPosition.Last);
//     });
//     test('Multiple interactive windows', async () => {
//         ioc.forceDataScienceSettingsChanged({ interactiveWindowMode: 'multiple' });
//         const pair1 = await getOrCreateInteractiveWindow(ioc);
//         const pair2 = await getOrCreateInteractiveWindow(ioc);
//         assert.notEqual(pair1.window.title, pair2.window.title, 'Two windows were not created.');
//         assert.notEqual(pair1.mount.wrapper, pair2.mount.wrapper, 'Two windows were not created.');
//     });
//     const fooCode = `x = 'foo'\nx`;
//     const barCode = `y = 'bar'\ny`;
//     test('Multiple executes go to last active window', async () => {
//         addMockData(ioc, fooCode, 'foo');
//         addMockData(ioc, barCode, 'bar');

//         ioc.forceDataScienceSettingsChanged({ interactiveWindowMode: 'multiple' });
//         const globalMemento = ioc.get<Memento>(IMemento, GLOBAL_MEMENTO);
//         await globalMemento.update(AskedForPerFileSettingKey, true);

//         const pair1 = await getOrCreateInteractiveWindow(ioc);

//         // Run a cell from a document
//         const fooWatcher = createCodeWatcher(`# %%\n${fooCode}`, 'foo.py', ioc);
//         const lenses = fooWatcher?.getCodeLenses();
//         assert.equal(lenses?.length, 6, 'No code lenses found');
//         await runCodeLens(fooWatcher!.uri!, lenses ? lenses[0] : undefined, ioc);
//         verifyHtmlOnCell(pair1.mount.wrapper, 'InteractiveCell', 'foo', CellPosition.Last);

//         // Create another window, run a cell again
//         const pair2 = await getOrCreateInteractiveWindow(ioc);
//         await runCodeLens(fooWatcher!.uri!, lenses ? lenses[0] : undefined, ioc);
//         verifyHtmlOnCell(pair2.mount.wrapper, 'InteractiveCell', 'foo', CellPosition.Last);

//         // Make the first window active
//         pair2.mount.changeViewState(false, false);
//         pair1.mount.changeViewState(true, true);

//         // Run another file
//         const barWatcher = createCodeWatcher(`# %%\n${barCode}`, 'bar.py', ioc);
//         const lenses2 = barWatcher?.getCodeLenses();
//         assert.equal(lenses2?.length, 6, 'No code lenses found');
//         await runCodeLens(barWatcher!.uri!, lenses2 ? lenses2[0] : undefined, ioc);
//         verifyHtmlOnCell(pair1.mount.wrapper, 'InteractiveCell', 'bar', CellPosition.Last);
//     });
//     test('Per file', async () => {
//         addMockData(ioc, fooCode, 'foo');
//         addMockData(ioc, barCode, 'bar');
//         ioc.forceDataScienceSettingsChanged({ interactiveWindowMode: 'perFile' });
//         const interactiveWindowProvider = ioc.get<ITestInteractiveWindowProvider>(IInteractiveWindowProvider);

//         // Run a cell from a document
//         const fooWatcher = createCodeWatcher(`# %%\n${fooCode}`, 'foo.py', ioc);
//         const lenses = fooWatcher?.getCodeLenses();
//         assert.equal(lenses?.length, 6, 'No code lenses found');
//         await runCodeLens(fooWatcher!.uri!, lenses ? lenses[0] : undefined, ioc);
//         assert.equal(interactiveWindowProvider.windows.length, 1, 'Interactive window not created');
//         const mounted1 = interactiveWindowProvider.getMountedWebView(interactiveWindowProvider.windows[0]);
//         verifyHtmlOnCell(mounted1.wrapper, 'InteractiveCell', 'foo', CellPosition.Last);

//         // Create another window, run a cell again
//         const barWatcher = createCodeWatcher(`# %%\n${barCode}`, 'bar.py', ioc);
//         const lenses2 = barWatcher?.getCodeLenses();
//         await runCodeLens(barWatcher!.uri!, lenses2 ? lenses2[0] : undefined, ioc);
//         assert.equal(interactiveWindowProvider.windows.length, 2, 'Interactive window not created');
//         const mounted2 = interactiveWindowProvider.getMountedWebView(
//             interactiveWindowProvider.windows.find((w) => w.title.includes('bar'))
//         );
//         verifyHtmlOnCell(mounted2.wrapper, 'InteractiveCell', 'bar', CellPosition.Last);
//     });
//     test('Per file asks and changes titles', async () => {
//         addMockData(ioc, fooCode, 'foo');
//         addMockData(ioc, barCode, 'bar');
//         ioc.forceDataScienceSettingsChanged({ interactiveWindowMode: 'multiple' });
//         const interactiveWindowProvider = ioc.get<ITestInteractiveWindowProvider>(IInteractiveWindowProvider);
//         const globalMemento = ioc.get<Memento>(IMemento, GLOBAL_MEMENTO);
//         await globalMemento.update(AskedForPerFileSettingKey, false);

//         // Run a cell from a document
//         const fooWatcher = createCodeWatcher(`# %%\n${fooCode}`, 'foo.py', ioc);
//         const lenses = fooWatcher?.getCodeLenses();
//         assert.equal(lenses?.length, 6, 'No code lenses found');
//         await runCodeLens(fooWatcher!.uri!, lenses ? lenses[0] : undefined, ioc);
//         assert.equal(interactiveWindowProvider.windows.length, 1, 'Interactive window not created');
//         const mounted1 = interactiveWindowProvider.getMountedWebView(interactiveWindowProvider.windows[0]);
//         verifyHtmlOnCell(mounted1.wrapper, 'InteractiveCell', 'foo', CellPosition.Last);

//         // Create another window, run a cell again
//         const barWatcher = createCodeWatcher(`# %%\n${barCode}`, 'bar.py', ioc);
//         const lenses2 = barWatcher?.getCodeLenses();
//         await runCodeLens(barWatcher!.uri!, lenses2 ? lenses2[0] : undefined, ioc);
//         assert.equal(interactiveWindowProvider.windows.length, 2, 'Interactive window not created');
//         const mounted2 = interactiveWindowProvider.getMountedWebView(
//             interactiveWindowProvider.windows.find((w) => w.title.includes('bar'))
//         );
//         verifyHtmlOnCell(mounted2.wrapper, 'InteractiveCell', 'bar', CellPosition.Last);

//         // First window should now have foo in the title too
//         assert.ok(interactiveWindowProvider.windows[0].title.includes('foo'), 'Title of first window did not change');
//     });

//     test('Click External Button', async () => {
//         let success = false;
//         // Register a test command
//         const api = ioc.get<IWebviewExtensibility>(IWebviewExtensibility);

//         api.registerCellToolbarButton(
//             () => {
//                 success = true;
//                 return Promise.resolve();
//             },
//             'add',
//             [1, 2, 3, 4],
//             'testing'
//         );

//         // Create an interactive window so that it listens to the results.
//         const { mount, window } = await getOrCreateInteractiveWindow(ioc);

//         // We need to update the view state to get the external buttons
//         // eslint-disable-next-line @typescript-eslint/no-explicit-any
//         const listener = (window as any).messageListener as InteractiveWindowMessageListener;
//         // eslint-disable-next-line @typescript-eslint/no-explicit-any
//         listener.onChangeViewState((window as any).webPanel);

//         // Then enter some code.
//         await enterInput(mount, 'a=1\na', 'InteractiveCell');
//         verifyHtmlOnInteractiveCell('1', CellPosition.Last);
//         const ImageButtons = getLastOutputCell(mount.wrapper, 'InteractiveCell').find(ImageButton);
//         const externalButton = ImageButtons.at(3);

//         // Then click the gather code button
//         const externalButtonPromise = mount.waitForMessage(InteractiveWindowMessages.ExecuteExternalCommand);
//         externalButton.simulate('click');
//         await externalButtonPromise;

//         const updateButtons = mount.waitForMessage(InteractiveWindowMessages.UpdateExternalCellButtons);
//         await updateButtons;

//         assert.ok(success, 'External callback was not called');
//     });
// });
