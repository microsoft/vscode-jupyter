// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

suite('Dummy1a', () => {
    test('dummy1a', () => {
        //
    });
});
// /* eslint-disable , comma-dangle, @typescript-eslint/no-explicit-any, no-multi-str */
// import '../../platform/common/extensions.node';

// import type * as nbformat from '@jupyterlab/nbformat';
// import assert from 'assert';
// import { mount, ReactWrapper } from 'enzyme';
// import * as sinon from 'sinon';
// import { parse } from 'node-html-parser';
// import * as React from 'react';
// import uuid from 'uuid/v4';
// import { Disposable } from 'vscode';
// const telemetry = require('../../telemetry/index');
// import { Identifiers, Telemetry } from '../../platform/datascience/constants';
// import {
//     DataViewerMessages,
//     IDataViewer,
//     IDataViewerDataProvider,
//     IDataViewerFactory
// } from '../../platform/datascience/data-viewing/types';
// import { getDefaultInteractiveIdentity } from '../../platform/datascience/interactive-window/identity';
// import {
//     IJupyterVariable,
//     IJupyterVariableDataProviderFactory,
//     INotebook,
//     INotebookProvider
// } from '../../platform/datascience/types';
// import { MainPanel } from '../../webviews/webview-side/data-explorer/mainPanel';
// import { ReactSlickGrid } from '../../webviews/webview-side/data-explorer/reactSlickGrid';
// import { noop, sleep } from '../core';
// import { DataScienceIocContainer } from './dataScienceIocContainer';
// import { takeSnapshot, writeDiffSnapshot } from './helpers';
// import { IMountedWebView } from './mountedWebView';
// import { SliceControl } from '../../webviews/webview-side/data-explorer/sliceControl';
// import { Dropdown } from '@fluentui/react';
// import { CheckboxState, SliceOperationSource } from '../../telemetry/constants';
// import { range } from 'lodash';

// interface ISliceControlTestInterface {
//     toggleEnablement: () => void;
//     applyDropdownsToInputBox: () => void;
// }

// // import { asyncDump } from '../common/asyncDump';
// suite('DataViewer tests', () => {
//     const disposables: Disposable[] = [];
//     let dataViewerFactory: IDataViewerFactory;
//     let jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory;
//     let ioc: DataScienceIocContainer;
//     let notebook: INotebook | undefined;
//     const snapshot = takeSnapshot();
//     let sandbox = sinon.createSandbox();
//     let sendTelemetryStub: sinon.SinonStub;

//     suiteTeardown(() => {
//         writeDiffSnapshot(snapshot, 'DataViewer');
//     });

//     setup(async () => {
//         ioc = new DataScienceIocContainer();
//         ioc.registerDataScienceTypes();
//         sendTelemetryStub = sandbox.stub(telemetry, 'sendTelemetryEvent');
//         return ioc.activate();
//     });

//     function mountWebView() {
//         // Setup our webview panel
//         const mounted = ioc.createWebView(
//             () => mount(<MainPanel skipDefault={true} baseTheme={'vscode-light'} testMode={true} />),
//             'default'
//         );

//         // Make sure the data explorer provider and execution factory in the container is created (the extension does this on startup in the extension)
//         dataViewerFactory = ioc.get<IDataViewerFactory>(IDataViewerFactory);
//         jupyterVariableDataProviderFactory = ioc.get<IJupyterVariableDataProviderFactory>(
//             IJupyterVariableDataProviderFactory
//         );

//         return mounted;
//     }

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
//         delete (global as any).ascquireVsCodeApi;
//         sandbox.restore();
//     });

//     function createJupyterVariable(variable: string, type: string, shape: string): IJupyterVariable {
//         return {
//             name: variable,
//             value: '',
//             supportsDataExplorer: true,
//             type,
//             size: 0,
//             truncated: true,
//             shape,
//             count: 0
//         };
//     }

//     async function createJupyterVariableDataProvider(
//         jupyterVariable: IJupyterVariable
//     ): Promise<IDataViewerDataProvider> {
//         return jupyterVariableDataProviderFactory.create(jupyterVariable, notebook!);
//     }

//     async function createDataViewer(dataProvider: IDataViewerDataProvider, title: string): Promise<IDataViewer> {
//         return dataViewerFactory.create(dataProvider, title);
//     }

//     async function createJupyterVariableDataViewer(
//         variable: string,
//         type: string,
//         shape: string = ''
//     ): Promise<IDataViewer> {
//         const jupyterVariable: IJupyterVariable = createJupyterVariable(variable, type, shape);
//         const jupyterVariableDataProvider: IDataViewerDataProvider = await createJupyterVariableDataProvider(
//             jupyterVariable
//         );
//         return createDataViewer(jupyterVariableDataProvider, jupyterVariable.name);
//     }

//     async function injectCode(code: string): Promise<INotebook | undefined> {
//         const notebookProvider = ioc.get<INotebookProvider>(INotebookProvider);
//         notebook = await notebookProvider.getOrCreateNotebook({
//             identity: getDefaultInteractiveIdentity(),
//             resource: undefined
//         });
//         if (notebook) {
//             await executeCode(code, notebook);
//             return notebook;
//         }
//     }

//     async function executeCode(code: string, notebook: INotebook) {
//         const cells = await notebook.execute(code, Identifiers.EmptyFileName, 0, uuid());
//         assert.equal(cells.length, 1, `Wrong number of cells returned`);
//         assert.equal(cells[0].data.cell_type, 'code', `Wrong type of cell returned`);
//         const cell = cells[0].data as nbformat.ICodeCell;
//         if (cell.outputs.length > 0) {
//             const error = cell.outputs[0].evalue;
//             if (error) {
//                 assert.fail(`Unexpected error: ${error}`);
//             }
//         }
//     }

//     function getCompletedPromise(mountedWebView: IMountedWebView): Promise<void> {
//         return mountedWebView.waitForMessage(DataViewerMessages.CompletedData);
//     }

//     // eslint-disable-next-line @typescript-eslint/no-explicit-any
//     function runMountedTest(name: string, testFunc: (mount: IMountedWebView) => Promise<void>) {
//         test(name, async () => {
//             const wrapper = mountWebView();
//             try {
//                 await testFunc(wrapper);
//             } finally {
//                 // Make sure to unmount the wrapper or it will interfere with other tests
//                 wrapper.dispose();
//             }
//         });
//     }

//     function findGrid(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>) {
//         const mainPanelWrapper = wrapper.find(MainPanel);
//         assert.ok(mainPanelWrapper && mainPanelWrapper.length > 0, 'Grid not found to sort on');
//         const mainPanel = mainPanelWrapper.instance() as MainPanel;
//         assert.ok(mainPanel, 'Main panel instance not found');
//         const reactGrid = (mainPanel as any).grid.current as ReactSlickGrid;
//         assert.ok(reactGrid, 'Grid control not found');
//         return reactGrid;
//     }

//     function sortRows(
//         wrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
//         sortCol: string,
//         sortAsc: boolean
//     ): void {
//         // Cause our sort
//         const reactGrid = findGrid(wrapper);
//         if (reactGrid.state.grid) {
//             const cols = reactGrid.state.grid.getColumns();
//             const col = cols.find((c) => c.field === sortCol);
//             assert.ok(col, `${sortCol} is not a column of the grid`);
//             reactGrid.sort(new Slick.EventData(), {
//                 sortCol: col,
//                 sortAsc,
//                 multiColumnSort: false,
//                 grid: reactGrid.state.grid
//             });
//         }
//     }

//     async function filterRows(
//         wrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
//         filterCol: string,
//         filterText: string
//     ): Promise<void> {
//         // Cause our sort
//         const reactGrid = findGrid(wrapper);
//         if (reactGrid.state.grid) {
//             const cols = reactGrid.state.grid.getColumns();
//             const col = cols.find((c) => c.field === filterCol);
//             assert.ok(col, `${filterCol} is not a column of the grid`);
//             reactGrid.filterChanged(filterText, col!);
//             await sleep(100);
//             wrapper.update();
//         }
//     }

//     function verifyRows(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>, rows: (string | number)[]) {
//         const mainPanel = wrapper.find('.main-panel');
//         assert.ok(mainPanel.length >= 1, "Didn't find any cells being rendered");
//         wrapper.update();

//         // Force the main panel to actually render.
//         const html = mainPanel.html();
//         const root = parse(html) as any;
//         const cells = root.querySelectorAll('.react-grid-cell') as HTMLElement[];
//         assert.ok(cells, 'No cells found');
//         assert.ok(cells.length >= rows.length, 'Not enough cells found');
//         // Cells should be an array that matches up to the values we expect.
//         for (let i = 0; i < rows.length; i += 1) {
//             // Span should have our value (based on the CellFormatter's output)
//             const span = cells[i].querySelector('div.cell-formatter span') as HTMLSpanElement;
//             assert.ok(span, `Span ${i} not found`);
//             const val = rows[i].toString();
//             assert.equal(span.innerHTML, val, `Row ${i} not matching. ${span.innerHTML} !== ${val}`);
//         }
//     }

//     function editCell(
//         wrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
//         dataViewRow: number,
//         dataViewColumn: number
//     ) {
//         const reactGrid = findGrid(wrapper);
//         reactGrid.state.grid?.setActiveCell(dataViewRow, dataViewColumn);
//         reactGrid.state.grid?.render();
//         reactGrid.state.grid?.editActiveCell();
//         wrapper.update();
//     }

//     function cancelEdits(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>) {
//         const reactGrid = findGrid(wrapper);
//         reactGrid.state.grid?.getEditorLock().cancelCurrentEdit();
//         wrapper.update();
//     }

//     function verifyInputIncludes(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>, text: string) {
//         const mainPanel = wrapper.find('.main-panel');
//         assert.ok(mainPanel.length >= 1, "Didn't find any cells being rendered");
//         wrapper.update();
//         const html = mainPanel.html();
//         const root = parse(html) as any;
//         const cells = root.querySelectorAll('.editor-text') as HTMLInputElement[];
//         assert.ok(cells.length === 1, 'Did not find input cell');
//         const cell = cells[0];
//         assert.ok(cell.outerHTML.includes(text));
//     }

//     runMountedTest('Data Frame', async (wrapper) => {
//         await injectCode('import pandas as pd\r\ndf = pd.DataFrame([0, 1, 2, 3])');
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('df', 'DataFrame');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;

//         verifyRows(wrapper.wrapper, [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
//     });

//     runMountedTest('Transposed Data Frame', async (wrapper) => {
//         await injectCode(
//             'import pandas as pd\r\ndata = [["tom", 10], ["nick", 15], ["juli", 14]]\r\ndf = pd.DataFrame(data, columns=["Name", "Age"])\r\ndf = df.transpose()'
//         );
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('df', 'DataFrame');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;

//         verifyRows(wrapper.wrapper, [0, 'Name', 'tom', 'nick', 'juli', 1, 'Age', '10', '15', '14']);
//     });

//     runMountedTest('List', async (wrapper) => {
//         await injectCode('ls = [0, 1, 2, 3]');
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('ls', 'list');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;

//         verifyRows(wrapper.wrapper, [0, 0, 1, 1, 2, 2, 3, 3]);
//     });

//     runMountedTest('Series', async (wrapper) => {
//         await injectCode('import pandas as pd\r\ns = pd.Series([0, 1, 2, 3])');
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('s', 'Series');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;

//         verifyRows(wrapper.wrapper, [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
//     });

//     runMountedTest('np.array', async (wrapper) => {
//         await injectCode('import numpy as np\r\nx = np.array([0, 1, 2, 3])');
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('x', 'ndarray');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;

//         verifyRows(wrapper.wrapper, [0, 0, 1, 1, 2, 2, 3, 3]);
//     });

//     runMountedTest('Failure', async (_wrapper) => {
//         await injectCode('import numpy as np\r\nx = np.array([0, 1, 2, 3])');
//         try {
//             await createJupyterVariableDataViewer('unknown variable', 'ndarray');
//             assert.fail('Exception should have been thrown');
//         } catch {
//             noop();
//         }
//     });

//     runMountedTest('Sorting numbers', async (wrapper) => {
//         await injectCode('import numpy as np\r\nx = np.array([np.nan, 1, 2, 3, np.inf, -np.inf, np.nan])');
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('x', 'ndarray');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;

//         verifyRows(wrapper.wrapper, [0, 'nan', 1, 1, 2, 2, 3, 3, 4, 'inf', 5, '-inf', 6, 'nan']);
//         sortRows(wrapper.wrapper, '0', false);
//         verifyRows(wrapper.wrapper, [0, 'nan', 6, 'nan', 4, 'inf', 3, 3, 2, 2, 1, 1, 5, '-inf']);
//         sortRows(wrapper.wrapper, '0', true);
//         verifyRows(wrapper.wrapper, [5, '-inf', 1, 1, 2, 2, 3, 3, 4, 'inf', 0, 'nan', 6, 'nan']);
//     });

//     runMountedTest('Sorting strings', async (wrapper) => {
//         await injectCode(
//             'import pandas as pd\r\nimport numpy as np\r\ndata = ["Alice", np.nan, "Tracy", "Bob", np.nan]\r\ndf = pd.DataFrame(data)'
//         );
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('df', 'DataFrame');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;

//         verifyRows(wrapper.wrapper, [0, 0, 'Alice', 1, 1, 'NaN', 2, 2, 'Tracy', 3, 3, 'Bob', 4, 4, 'NaN']);
//         sortRows(wrapper.wrapper, '0', false);
//         verifyRows(wrapper.wrapper, [1, 1, 'NaN', 4, 4, 'NaN', 2, 2, 'Tracy', 3, 3, 'Bob', 0, 0, 'Alice']);
//         sortRows(wrapper.wrapper, '0', true);
//         verifyRows(wrapper.wrapper, [0, 0, 'Alice', 3, 3, 'Bob', 2, 2, 'Tracy', 1, 1, 'NaN', 4, 4, 'NaN']);
//     });

//     runMountedTest('Filter booleans', async (wrapper) => {
//         await injectCode(
//             'import pandas as pd\r\ndata = [False, True, True, False]\r\ndf = pd.DataFrame(data, dtype=bool)'
//         );
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('df', 'DataFrame');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [0, 0, 'false', 1, 1, 'true', 2, 2, 'true', 3, 3, 'false']);

//         const filtersAndExpectedResults = {
//             true: [1, 1, 'true', 2, 2, 'true'],
//             false: [0, 0, 'false', 3, 3, 'false'],
//             '': [0, 0, 'false', 1, 1, 'true', 2, 2, 'true', 3, 3, 'false']
//         };

//         for (const [filter, expectedResult] of Object.entries(filtersAndExpectedResults)) {
//             await filterRows(wrapper.wrapper, '0', filter);
//             verifyRows(wrapper.wrapper, expectedResult);
//         }
//     });

//     runMountedTest('Filter strings with wildcards', async (wrapper) => {
//         await injectCode(
//             'import pandas as pd\r\ndata = ["stable", "unstable", "able", "barely stable", "st4ble"]\r\ndf = pd.DataFrame(data)'
//         );
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('df', 'DataFrame');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [
//             0,
//             0,
//             'stable',
//             1,
//             1,
//             'unstable',
//             2,
//             2,
//             'able',
//             3,
//             3,
//             'barely stable',
//             4,
//             4,
//             'st4ble'
//         ]);

//         const filtersAndExpectedResults = {
//             stable: [0, 0, 'stable', 3, 3, 'barely stable'],
//             unstable: [1, 1, 'unstable'],
//             '*': [0, 0, 'stable', 1, 1, 'unstable', 2, 2, 'able', 3, 3, 'barely stable', 4, 4, 'st4ble'],
//             '*stable': [0, 0, 'stable', 1, 1, 'unstable', 3, 3, 'barely stable'],
//             '*tab*': [0, 0, 'stable', 1, 1, 'unstable', 3, 3, 'barely stable']
//         };

//         for (const [filter, expectedResult] of Object.entries(filtersAndExpectedResults)) {
//             await filterRows(wrapper.wrapper, '0', filter);
//             verifyRows(wrapper.wrapper, expectedResult);
//         }
//     });

//     runMountedTest('Filter numerical', async (wrapper) => {
//         await injectCode('import numpy as np\r\nx = np.array([0, 1, 2, 3, np.inf, -np.inf, np.nan])');
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('x', 'ndarray');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [0, 0, 1, 1, 2, 2, 3, 3, 4, 'inf', 5, '-inf', 6, 'nan']);

//         const filtersAndExpectedResults = {
//             '> 1': [2, 2, 3, 3, 4, 'inf'],
//             '0': [0, 0],
//             // Search for inf, -inf, nan
//             inf: [4, 'inf'],
//             Inf: [4, 'inf'],
//             '-inf': [5, '-inf'],
//             '-INF': [5, '-inf'],
//             nan: [6, 'nan'],
//             NaN: [6, 'nan'],
//             // inf comparison
//             '> inf': [],
//             '>= inf': [4, 'inf'],
//             '= inf': [4, 'inf'],
//             '== inf': [4, 'inf'],
//             '<= inf': [0, 0, 1, 1, 2, 2, 3, 3, 4, 'inf', 5, '-inf'],
//             '< inf': [0, 0, 1, 1, 2, 2, 3, 3, 5, '-inf'],
//             // -inf comparison
//             '> -inf': [0, 0, 1, 1, 2, 2, 3, 3, 4, 'inf'],
//             '>= -inf': [0, 0, 1, 1, 2, 2, 3, 3, 4, 'inf', 5, '-inf'],
//             '= -inf': [5, '-inf'],
//             '== -inf': [5, '-inf'],
//             '<= -inf': [5, '-inf'],
//             '< -inf': [],
//             // nan comparison
//             '= nan': [6, 'nan'],
//             '== nan': [6, 'nan'],
//             '>= nan': [6, 'nan'],
//             '<= nan': [6, 'nan'],
//             '> nan': [],
//             '< nan': []
//         };

//         for (const [filter, expectedResult] of Object.entries(filtersAndExpectedResults)) {
//             await filterRows(wrapper.wrapper, '0', filter);
//             verifyRows(wrapper.wrapper, expectedResult);
//         }
//     });

//     runMountedTest('Filter numerical - other column has strings', async (wrapper) => {
//         await injectCode(
//             'import numpy as np\r\nx = np.array([["Bob", 2], ["Alice", 4], ["Gina", -np.inf], ["John", np.inf], ["Trudy", np.nan]])'
//         );
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('x', 'ndarray');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [
//             0,
//             'Bob',
//             2,
//             1,
//             'Alice',
//             4,
//             2,
//             'Gina',
//             '-inf',
//             3,
//             'John',
//             'inf',
//             4,
//             'Trudy',
//             'nan'
//         ]);

//         const filtersAndExpectedResults = {
//             '2': [0, 'Bob', 2],
//             '4': [1, 'Alice', 4],
//             '-inf': [2, 'Gina', '-inf'],
//             inf: [3, 'John', 'inf'],
//             nan: [4, 'Trudy'],
//             '> 2': [1, 'Alice', 4, 3, 'John', 'inf'],
//             '>= 2': [0, 'Bob', 2, 1, 'Alice', 4, 3, 'John', 'inf'],
//             '< 4': [0, 'Bob', 2, 2, 'Gina', '-inf']
//         };

//         for (const [filter, expectedResult] of Object.entries(filtersAndExpectedResults)) {
//             await filterRows(wrapper.wrapper, '1', filter);
//             verifyRows(wrapper.wrapper, expectedResult);
//         }
//     });

//     runMountedTest('Filter 2D PyTorch tensors', async (wrapper) => {
//         await injectCode('import torch\r\nfoo = torch.tensor([0, 1, 2, 3, 4, 5])');
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('foo', 'Tensor');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;

//         await filterRows(wrapper.wrapper, '0', '> 0');
//         verifyRows(wrapper.wrapper, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
//     });

//     runMountedTest('2D PyTorch tensors', async (wrapper) => {
//         await injectCode(
//             "import torch\r\nimport numpy as np\r\nfoo = torch.tensor([0, 1, np.inf, float('-inf'), np.nan])"
//         );
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('foo', 'Tensor');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [0, 0, 1, 1, 2, 'inf', 3, '-inf', 4, 'nan']);
//     });

//     runMountedTest('2D TensorFlow tensors', async (wrapper) => {
//         await injectCode(
//             "import tensorflow as tf\r\nimport numpy as np\r\nbar = tf.constant([0, 1, np.inf, float('-inf'), np.nan])"
//         );
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('bar', 'EagerTensor');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [0, 0, 1, 1, 2, 'inf', 3, '-inf', 4, 'nan']);
//     });

//     runMountedTest('Filter 2D xarray DataArrays', async (wrapper) => {
//         await injectCode(
//             'import xarray as xr\r\nfoo = xr.DataArray([[1,2,3],[4,5,6],[7,8,9]], dims=list("ab"), coords=dict(a=["x","y","z"], b=["m","n","o"]))'
//         );
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('foo', 'DataArray');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;

//         await filterRows(wrapper.wrapper, '0', '> 1');
//         verifyRows(wrapper.wrapper, [1, 4, 5, 6, 2, 7, 8, 9]);
//     });

//     runMountedTest('2D xarray DataArrays', async (wrapper) => {
//         await injectCode(
//             'import xarray as xr\r\nfoo = xr.DataArray([[1,2,3],[4,5,6]], dims=list("ab"), coords=dict(a=["x","y"], b=["m","n","o"]))'
//         );
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('foo', 'DataArray');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [0, 1, 2, 3, 1, 4, 5, 6]);
//     });

//     runMountedTest('Ragged 1D numpy array', async (wrapper) => {
//         await injectCode("import numpy as np\r\nfoo = np.array(['hello', 42, ['hi', 'hey']])");
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('foo', 'ndarray', '(3, )');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [0, 'hello', 1, 42, 2, "['hi', 'hey']"]);
//     });

//     runMountedTest('Ragged 2D numpy array', async (wrapper) => {
//         await injectCode("import numpy as np\r\nfoo = np.array([[1, 2, 3, float('inf')], [4, np.nan, 5]])");
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('foo', 'ndarray', '(2, )');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [0, '[1, 2, 3, inf]', 1, '[4, nan, 5]']);
//     });

//     runMountedTest('Ragged 3D numpy array', async (wrapper) => {
//         // Should be able to successfully create data viewer for ragged 3D numpy arrays
//         await injectCode('import numpy as np\r\nfoo = np.array([[[1, 2, 3], [4, 5]], [[6, 7, 8, 9]]])');
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('foo', 'ndarray', '(2, )');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [0, `[[1, 2, 3], [4, 5]]`, 1, '[[6, 7, 8, 9]]']);
//     });

//     runMountedTest('Simple refresh', async (wrapper) => {
//         // Run some code
//         const notebook = await injectCode('import numpy as np\r\na = np.array([0, 1, 2, 3])');
//         // Open the data viewer
//         const gotAllRows = getCompletedPromise(wrapper);
//         const dv = await createJupyterVariableDataViewer('a', 'ndarray');
//         assert.ok(dv, 'DataViewer not created');
//         await gotAllRows;
//         verifyRows(wrapper.wrapper, [0, 0, 1, 1, 2, 2, 3, 3]);

//         // Run code that updates the previous variable
//         const gotAllRows2 = getCompletedPromise(wrapper);
//         await executeCode('a = np.array([[4, 5, 6]])', notebook!);
//         // Ideally we'd execute the refresh command but this test doesn't run in vscode,
//         // so this test doesn't verify that command execution results in the correct
//         // data viewer being refreshed
//         await dv.refreshData();
//         await gotAllRows2;
//         // Verify that the data viewer's contents have updated
//         verifyRows(wrapper.wrapper, [0, 4, 5, 6]);
//     });

//     suite('Data viewer slice data', async () => {
//         function findSliceControlPanel(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>) {
//             const sliceControlWrapper = wrapper.find(SliceControl);
//             sliceControlWrapper.update();
//             assert.ok(sliceControlWrapper && sliceControlWrapper.length > 0, 'Slice control not found');
//             return sliceControlWrapper;
//         }

//         function verifyReadonlyIndicator(
//             wrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
//             currentSlice: string
//         ) {
//             const sliceControl = wrapper.find(SliceControl);
//             const html = sliceControl.html();
//             const root = parse(html) as any;
//             wrapper.render();
//             const cells = root.querySelectorAll('.current-slice') as HTMLSpanElement[];
//             assert.ok(cells.length === 1, 'No readonly indicator found');
//             assert.ok(cells[0].innerHTML === currentSlice, 'Readonly indicator contents did not match');
//         }

//         function verifyDropdowns(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>, rows: (string | number)[]) {
//             const sliceControl = wrapper.find(SliceControl);
//             const html = sliceControl.html();
//             const root = parse(html) as any;
//             const cells = root.querySelectorAll('.ms-Dropdown-title');
//             assert.ok(cells.length >= rows.length, 'Not enough dropdowns found');
//             // Now verify the list of dropdowns have the expected values
//             for (let i = 0; i < rows.length; i += 1) {
//                 // Span reflects the dropdown's current selection
//                 const span = cells[i] as HTMLSpanElement;
//                 assert.ok(span, `Span ${i} not found`);
//                 const val = rows[i].toString();
//                 assert.equal(span.innerHTML, val, `Dropdown ${i} selection not matching. ${span.innerHTML} !== ${val}`);
//             }
//         }

//         function toggleCheckbox(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>) {
//             const sliceControl = findSliceControlPanel(wrapper);
//             // Enable slicing by toggling checkbox
//             const instance = (sliceControl.instance() as any) as ISliceControlTestInterface;
//             instance.toggleEnablement(); // simulate('click') doesn't suffice: https://github.com/facebook/react/issues/4950#issuecomment-255408709
//             wrapper.render();
//         }

//         function verifyControlsDisabled(
//             wrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
//             expectedNumberOfDropdowns: number,
//             initialReadonlyIndicator: string
//         ) {
//             // Open the slice panel
//             findSliceControlPanel(wrapper);
//             // Verify that all controls are initially disabled
//             let input = wrapper.find('.slice-data');
//             const html = input.html();
//             assert.ok(html.includes('disabled'), 'Input field was not initially disabled');
//             const dropdowns = wrapper.find(Dropdown);
//             assert.ok(dropdowns.length === expectedNumberOfDropdowns, 'Unexpected number of dropdowns found');
//             // Verify no readonly indicator as we're not slicing yet
//             assert.throws(
//                 () => verifyReadonlyIndicator(wrapper, initialReadonlyIndicator),
//                 'Readonly indicator rendered when not slicing'
//             );
//         }

//         function editInputValue(wrapper: IMountedWebView, slice: string) {
//             const inputElement = wrapper.wrapper.find('.slice-data').getDOMNode() as HTMLInputElement;
//             inputElement.value = slice;
//             wrapper.wrapper.find('.slice-data').simulate('change');
//         }

//         function verifySliceEnablementStateChangeTelemetry(newState: CheckboxState) {
//             assert.ok(
//                 sendTelemetryStub.calledWithExactly(Telemetry.DataViewerSliceEnablementStateChanged, undefined, {
//                     newState
//                 })
//             );
//         }

//         function verifyDataDimensionalityTelemetry(numberOfDimensions: number) {
//             assert.ok(
//                 sendTelemetryStub.calledWithExactly(Telemetry.DataViewerDataDimensionality, undefined, {
//                     numberOfDimensions
//                 })
//             );
//         }

//         function verifySliceOperationTelemetry(source: SliceOperationSource) {
//             assert.ok(sendTelemetryStub.calledWithExactly(Telemetry.DataViewerSliceOperation, undefined, { source }));
//         }

//         async function applySliceAndVerifyReadonlyIndicator(wrapper: IMountedWebView, slice: string) {
//             // Apply a slice to input box
//             const gotSlice = getCompletedPromise(wrapper);
//             editInputValue(wrapper, slice);
//             wrapper.wrapper.find('form').first().simulate('submit');
//             await gotSlice;
//             // Ensure readonly indicator updates after slicing
//             verifyReadonlyIndicator(wrapper.wrapper, slice);
//         }

//         async function changeDropdown(
//             wrapper: IMountedWebView,
//             dropdownType: 'Axis' | 'Index',
//             dropdownRow: number,
//             newValue: number | string
//         ) {
//             const gotSlice = getCompletedPromise(wrapper);
//             const sliceControl = findSliceControlPanel(wrapper.wrapper);
//             // Do a setstate because we don't have direct access to the dropdown selection change handler
//             const newState = { [`selected${dropdownType}${dropdownRow}`]: newValue };
//             sliceControl.setState(newState);
//             const instance = (sliceControl.instance() as any) as ISliceControlTestInterface;
//             // This is what gets called in the dropdown change handler. Manually call it because
//             // simulating a change event on the Dropdown node doesn't seem to do anything
//             instance.applyDropdownsToInputBox();
//             wrapper.wrapper.render();
//             await gotSlice;
//         }

//         runMountedTest('Presentation of 3D PyTorch tensors', async (wrapper) => {
//             // Should be able to successfully create data viewer for 3D data
//             await injectCode('import torch\r\nfoo = torch.LongTensor([[[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]]])');
//             const gotAllRows = getCompletedPromise(wrapper);
//             const dv = await createJupyterVariableDataViewer('foo', 'Tensor', '(1, 2, 6)');
//             assert.ok(dv, 'DataViewer not created');
//             await gotAllRows;

//             // By default show sliced
//             verifyRows(wrapper.wrapper, [0, 1, 2, 3, 4, 5, 6, 1, 7, 8, 9, 10, 11, 12]);
//             verifyDataDimensionalityTelemetry(3);

//             // Uncheck slicing to restore to flattened view
//             const disableSlicing = getCompletedPromise(wrapper);
//             toggleCheckbox(wrapper.wrapper);
//             await disableSlicing;
//             verifySliceEnablementStateChangeTelemetry(CheckboxState.Unchecked);
//             verifyRows(wrapper.wrapper, [0, '[1, 2, 3, 4, 5, 6]', '[7, 8, 9, 10, 11, 12]']);
//             wrapper.wrapper.update();

//             // Put cell into edit mode and verify that input value is updated to be the non-truncated, stringified value
//             editCell(wrapper.wrapper, 0, 1);
//             verifyInputIncludes(wrapper.wrapper, 'value="[1, 2, 3, 4, 5, 6]"');

//             // Data should still be there after exiting edit mode
//             cancelEdits(wrapper.wrapper);
//             verifyRows(wrapper.wrapper, [0, '[1, 2, 3, 4, 5, 6]', '[7, 8, 9, 10, 11, 12]']);
//         });

//         runMountedTest('Presentation of 4D numpy ndarrays', async (wrapper) => {
//             // Should be able to successfully create data viewer for >2D numpy ndarrays
//             await injectCode('import numpy as np\r\nfoo = np.arange(24).reshape((1, 2, 3, 4))');
//             const gotAllRows = getCompletedPromise(wrapper);
//             const dv = await createJupyterVariableDataViewer('foo', 'ndarray', '(1, 2, 3, 4)');
//             assert.ok(dv, 'DataViewer not created');
//             await gotAllRows;

//             // By default show sliced
//             verifyRows(wrapper.wrapper, [0, 0, 1, 2, 3, 1, 4, 5, 6, 7, 2, 8, 9, 10, 11]);
//             verifyDataDimensionalityTelemetry(4);

//             // Uncheck slicing to restore to flattened view
//             const disableSlicing = getCompletedPromise(wrapper);
//             toggleCheckbox(wrapper.wrapper);
//             await disableSlicing;
//             verifySliceEnablementStateChangeTelemetry(CheckboxState.Unchecked);
//             verifyRows(wrapper.wrapper, [
//                 0,
//                 `[[0, 1, 2, 3],
//  [4, 5, 6, 7],
//  [8, 9, 10, 11]]`,
//                 `[[12, 13, 14, 15],
//  [16, 17, 18, 19],
//  [20, 21, 22, 23]]`
//             ]);

//             // Put cell into edit mode and verify that input value is updated to be the non-truncated, stringified value
//             editCell(wrapper.wrapper, 0, 1);
//             verifyInputIncludes(wrapper.wrapper, `value="[[0, 1, 2, 3],\n [4, 5, 6, 7],\n [8, 9, 10, 11]]"`);

//             // Data should still be there after exiting edit mode
//             cancelEdits(wrapper.wrapper);
//             verifyRows(wrapper.wrapper, [
//                 0,
//                 `[[0, 1, 2, 3],
//  [4, 5, 6, 7],
//  [8, 9, 10, 11]]`,
//                 `[[12, 13, 14, 15],
//  [16, 17, 18, 19],
//  [20, 21, 22, 23]]`
//             ]);
//         });

//         runMountedTest('Slice 2D', async (wrapper) => {
//             const code = `import torch
// import numpy as np
// arr = np.arange(6).reshape(2, 3)
// foo = torch.tensor(arr)`;

//             // Create data viewer
//             await injectCode(code);
//             const gotAllRows = getCompletedPromise(wrapper);
//             const dv = await createJupyterVariableDataViewer('foo', 'Tensor', '(2, 3)');
//             assert.ok(dv, 'DataViewer not created');
//             await gotAllRows;
//             verifyRows(wrapper.wrapper, [0, 0, 1, 2, 1, 3, 4, 5]);
//             verifyControlsDisabled(wrapper.wrapper, 2, '');
//             assert.throws(
//                 () => verifyDataDimensionalityTelemetry(2),
//                 'Unexpectedly sent data dimensionality telemetry when no slice performed'
//             );

//             // Apply a slice via input box and verify that dropdowns update
//             toggleCheckbox(wrapper.wrapper);
//             await applySliceAndVerifyReadonlyIndicator(wrapper, '[1, :]');
//             verifyRows(wrapper.wrapper, [0, 3, 1, 4, 2, 5]);
//             verifyDropdowns(wrapper.wrapper, [0, 1]); // Axis 0, index 1
//             verifySliceEnablementStateChangeTelemetry(CheckboxState.Checked);
//             verifyDataDimensionalityTelemetry(2);
//             verifySliceOperationTelemetry(SliceOperationSource.TextBox);
//             sendTelemetryStub.resetHistory();

//             // Change the dropdowns and verify that the slice expression updates
//             await changeDropdown(wrapper, 'Axis', 0, 1);
//             verifyReadonlyIndicator(wrapper.wrapper, '[:, 1]');
//             verifyDropdowns(wrapper.wrapper, [1, 1]);
//             verifyRows(wrapper.wrapper, [0, 1, 1, 4]);
//             assert.ok(
//                 (wrapper.wrapper.find('.slice-data').getDOMNode() as HTMLInputElement).value === '[:, 1]',
//                 'Input box did not update to match slice'
//             );
//             assert.throws(
//                 () => verifyDataDimensionalityTelemetry(2),
//                 'Unexpectedly sent data dimensionality telemetry more than once'
//             );
//             verifySliceOperationTelemetry(SliceOperationSource.Dropdown);
//             sendTelemetryStub.resetHistory();

//             // Apply a slice with no corresponding dropdown
//             await applySliceAndVerifyReadonlyIndicator(wrapper, '[:, :2]');
//             verifyRows(wrapper.wrapper, [0, 0, 1, 1, 3, 4]);
//             verifyDropdowns(wrapper.wrapper, ['', '']); // Dropdowns should be unset
//             verifySliceOperationTelemetry(SliceOperationSource.TextBox);
//             sendTelemetryStub.resetHistory();

//             // Uncheck slice checkbox and verify original contents are restored
//             const disableSlicing = getCompletedPromise(wrapper);
//             toggleCheckbox(wrapper.wrapper);
//             await disableSlicing;
//             verifySliceEnablementStateChangeTelemetry(CheckboxState.Unchecked);
//             verifyRows(wrapper.wrapper, [0, 0, 1, 2, 1, 3, 4, 5]);
//             verifyControlsDisabled(wrapper.wrapper, 2, '');
//             sendTelemetryStub.resetHistory();

//             // Recheck slice checkbox and verify slice expression is restored
//             const reenableSlicing = getCompletedPromise(wrapper);
//             toggleCheckbox(wrapper.wrapper);
//             await reenableSlicing;
//             verifySliceEnablementStateChangeTelemetry(CheckboxState.Checked);
//             verifyRows(wrapper.wrapper, [0, 0, 1, 1, 3, 4]);

//             // Enter an invalid slice expression and verify error message is rendered
//             editInputValue(wrapper, '[:]');
//             assert.ok(
//                 wrapper.wrapper.find('.error-message').length === 1,
//                 'No error message rendered for invalid slice'
//             );
//         });

//         runMountedTest('Slice 3D', async (wrapper) => {
//             const code = `import torch
// import numpy as np
// arr = np.arange(24).reshape(2,4,3)
// foo = torch.tensor(arr)`;
//             // Create data viewer
//             await injectCode(code);
//             const gotAllRows = getCompletedPromise(wrapper);
//             const dv = await createJupyterVariableDataViewer('foo', 'Tensor', '(2, 4, 3)');
//             assert.ok(dv, 'DataViewer not created');
//             await gotAllRows;

//             // Slice should already be applied
//             verifyReadonlyIndicator(wrapper.wrapper, '[0, :, :]');
//             verifyRows(wrapper.wrapper, [0, 0, 1, 2, 1, 3, 4, 5, 2, 6, 7, 8, 3, 9, 10, 11]);
//             verifyDataDimensionalityTelemetry(3);
//             sendTelemetryStub.resetHistory();

//             // Change the dropdowns and verify that the slice expression updates
//             await changeDropdown(wrapper, 'Axis', 0, 1);
//             verifyReadonlyIndicator(wrapper.wrapper, '[:, 0, :]');
//             verifyDropdowns(wrapper.wrapper, [1, 0]);
//             verifyRows(wrapper.wrapper, [0, 0, 1, 2, 1, 12, 13, 14]);
//             assert.ok(
//                 (wrapper.wrapper.find('.slice-data').getDOMNode() as HTMLInputElement).value === '[:, 0, :]',
//                 'Input box did not update to match slice'
//             );
//             assert.throws(
//                 () => verifyDataDimensionalityTelemetry(3),
//                 'Unexpectedly sent data dimensionality telemetry more than once'
//             );
//             verifySliceOperationTelemetry(SliceOperationSource.Dropdown);
//             sendTelemetryStub.resetHistory();

//             // Apply a slice via input box and verify that dropdowns update
//             await applySliceAndVerifyReadonlyIndicator(wrapper, '[:, :, 2]');
//             verifyRows(wrapper.wrapper, [0, 2, 5, 8, 11, 1, 14, 17, 20, 23]);
//             verifyDropdowns(wrapper.wrapper, [2, 2]); // Axis 2, index 2
//             verifySliceOperationTelemetry(SliceOperationSource.TextBox);
//             sendTelemetryStub.resetHistory();

//             // Apply a slice with no corresponding dropdown
//             await applySliceAndVerifyReadonlyIndicator(wrapper, '[:, :1, :]');
//             verifyRows(wrapper.wrapper, [0, '[0, 1, 2]', 1, '[12, 13, 14]']);
//             verifyDropdowns(wrapper.wrapper, ['', '']); // Dropdowns should be unset
//             verifySliceOperationTelemetry(SliceOperationSource.TextBox);
//             sendTelemetryStub.resetHistory();

//             // Uncheck slice checkbox and verify original contents are restored
//             const disableSlicing = getCompletedPromise(wrapper);
//             toggleCheckbox(wrapper.wrapper);
//             await disableSlicing;
//             verifyRows(wrapper.wrapper, [
//                 0,
//                 '[0, 1, 2]',
//                 '[3, 4, 5]',
//                 '[6, 7, 8]',
//                 '[9, 10, 11]',
//                 1,
//                 '[12, 13, 14]',
//                 '[15, 16, 17]',
//                 '[18, 19, 20]',
//                 '[21, 22, 23]'
//             ]);
//             verifyControlsDisabled(wrapper.wrapper, 2, '');
//             verifySliceEnablementStateChangeTelemetry(CheckboxState.Unchecked);
//             sendTelemetryStub.resetHistory();

//             // Recheck slice checkbox and verify slice expression is restored
//             const reenableSlicing = getCompletedPromise(wrapper);
//             toggleCheckbox(wrapper.wrapper);
//             await reenableSlicing;
//             verifyRows(wrapper.wrapper, [0, '[0, 1, 2]', 1, '[12, 13, 14]']);
//             verifyReadonlyIndicator(wrapper.wrapper, '[:, :1, :]');
//             verifySliceEnablementStateChangeTelemetry(CheckboxState.Checked);
//             sendTelemetryStub.resetHistory();

//             // Enter an invalid slice expression and verify error message is rendered
//             editInputValue(wrapper, '[:]');
//             assert.ok(
//                 wrapper.wrapper.find('.error-message').length === 1,
//                 'No error message rendered for invalid slice'
//             );
//         });

//         runMountedTest('Slice 4D', async (wrapper) => {
//             const code = `import torch
// import numpy as np
// arr = np.arange(30).reshape(3, 5, 1, 2)
// foo = torch.tensor(arr)`;
//             // Create data viewer
//             await injectCode(code);
//             const gotAllRows = getCompletedPromise(wrapper);
//             const dv = await createJupyterVariableDataViewer('foo', 'Tensor', '(3, 5, 1, 2)');
//             assert.ok(dv, 'DataViewer not created');
//             await gotAllRows;

//             // Slice should already be applied
//             verifyReadonlyIndicator(wrapper.wrapper, '[0, 0, :, :]');
//             verifyRows(wrapper.wrapper, [0, 0, 1]);
//             verifyDataDimensionalityTelemetry(4);
//             sendTelemetryStub.resetHistory();

//             // Change the dropdowns and verify that the slice expression updates
//             await changeDropdown(wrapper, 'Index', 1, 2);
//             verifyReadonlyIndicator(wrapper.wrapper, '[0, 2, :, :]');
//             verifyDropdowns(wrapper.wrapper, [0, 0, 1, 2]);
//             verifyRows(wrapper.wrapper, [0, 4, 5]);
//             assert.ok(
//                 (wrapper.wrapper.find('.slice-data').getDOMNode() as HTMLInputElement).value === '[0, 2, :, :]',
//                 'Input box did not update to match slice'
//             );
//             verifySliceOperationTelemetry(SliceOperationSource.Dropdown);
//             sendTelemetryStub.resetHistory();

//             // Apply a slice via input box and verify that dropdowns update
//             await applySliceAndVerifyReadonlyIndicator(wrapper, '[:, 4, :, 1]');
//             verifyRows(wrapper.wrapper, [0, 9, 1, 19, 2, 29]);
//             verifyDropdowns(wrapper.wrapper, [1, 4, 3, 1]); // Axis 1 index 4, axis 3 index 1
//             verifySliceOperationTelemetry(SliceOperationSource.TextBox);
//             sendTelemetryStub.resetHistory();

//             // Apply a slice with no corresponding dropdown
//             await applySliceAndVerifyReadonlyIndicator(wrapper, '[1, 2, 0, :]');
//             verifyRows(wrapper.wrapper, [0, 14, 1, 15]);
//             verifyDropdowns(wrapper.wrapper, ['', '', '', '']); // Dropdowns should be unset
//             verifySliceOperationTelemetry(SliceOperationSource.TextBox);
//             sendTelemetryStub.resetHistory();

//             // Uncheck slice checkbox and verify original contents are restored
//             const disableSlicing = getCompletedPromise(wrapper);
//             toggleCheckbox(wrapper.wrapper);
//             await disableSlicing;
//             verifyRows(wrapper.wrapper, [
//                 0,
//                 '[[0, 1]]',
//                 `[[2, 3]]`,
//                 '[[4, 5]]',
//                 '[[6, 7]]',
//                 '[[8, 9]]',
//                 1,
//                 '[[10, 11]]',
//                 '[[12, 13]]',
//                 '[[14, 15]]',
//                 '[[16, 17]]',
//                 '[[18, 19]]',
//                 2,
//                 '[[20, 21]]',
//                 '[[22, 23]]',
//                 '[[24, 25]]',
//                 '[[26, 27]]',
//                 '[[28, 29]]'
//             ]);
//             verifyControlsDisabled(wrapper.wrapper, 4, '');
//             verifySliceEnablementStateChangeTelemetry(CheckboxState.Unchecked);
//             sendTelemetryStub.resetHistory();

//             // Recheck slice checkbox and verify slice expression is restored
//             const reenableSlicing = getCompletedPromise(wrapper);
//             toggleCheckbox(wrapper.wrapper);
//             await reenableSlicing;
//             verifyRows(wrapper.wrapper, [0, 14, 1, 15]);
//             verifyDropdowns(wrapper.wrapper, ['', '', '', '']); // Dropdowns should be unset
//             verifySliceEnablementStateChangeTelemetry(CheckboxState.Checked);
//             sendTelemetryStub.resetHistory();

//             // Enter an invalid slice expression and verify error message is rendered
//             editInputValue(wrapper, '[:]');
//             assert.ok(
//                 wrapper.wrapper.find('.error-message').length === 1,
//                 'No error message rendered for invalid slice'
//             );
//         });

//         runMountedTest('Refresh with slice applied', async (wrapper) => {
//             // Same shape, old slice is still valid, ensure update in place
//             const code = `import torch
// foo = torch.tensor([[[0, 1, 2], [3, 4, 5]]])`;
//             // Create data viewer
//             const notebook = await injectCode(code);
//             const gotAllRows = getCompletedPromise(wrapper);
//             const dv = await createJupyterVariableDataViewer('foo', 'Tensor', '(1, 2, 3)');
//             assert.ok(dv, 'DataViewer not created');
//             await gotAllRows;

//             // Slice should immediately be applied
//             verifyReadonlyIndicator(wrapper.wrapper, '[0, :, :]');
//             verifyRows(wrapper.wrapper, [0, 0, 1, 2, 1, 3, 4, 5]);

//             // Apply a slice via input box and verify that dropdowns update
//             await applySliceAndVerifyReadonlyIndicator(wrapper, '[:, 1, :]');
//             verifyRows(wrapper.wrapper, [0, 3, 4, 5]);
//             verifyDropdowns(wrapper.wrapper, [1, 1]); // Axis 1 index 1

//             // New variable value but same shape. Ensure slice updates in-place
//             await executeCode('foo = torch.tensor([[[6, 7, 8], [9, 10, 11]]])', notebook!);
//             const refreshPromise = getCompletedPromise(wrapper);
//             await dv.refreshData();
//             await refreshPromise;
//             verifyReadonlyIndicator(wrapper.wrapper, '[:, 1, :]');
//             verifyRows(wrapper.wrapper, [0, 9, 10, 11]);

//             // New variable shape invalidates old slice
//             await executeCode('foo = torch.tensor([[[0, 1]], [[2, 3]]])', notebook!);
//             // Ensure data updates
//             const invalidateSlicePromise = getCompletedPromise(wrapper);
//             await dv.refreshData();
//             await invalidateSlicePromise;
//             // Preselected slice is applied
//             verifyReadonlyIndicator(wrapper.wrapper, '[0, :, :]');
//             verifyRows(wrapper.wrapper, [0, 0, 1]);
//         });

//         runMountedTest('Large data', async (wrapper) => {
//             // Make sure data viewer is well-behaved when working with very large data
//             const numCols = 50;
//             const numRows = 6000;
//             await injectCode(
//                 `import numpy as np\r\nfoo = np.arange(${numRows} * ${numCols}).reshape(${numRows}, ${numCols})`
//             );
//             const gotAllRows = getCompletedPromise(wrapper);
//             const dv = await createJupyterVariableDataViewer('foo', 'ndarray');
//             assert.ok(dv, 'DataViewer not created');
//             await gotAllRows;

//             // Make sure sort works
//             const expectedCells: number[] = [];
//             for (let i = 5999; i >= 0; i++) {
//                 expectedCells.push(i);
//                 expectedCells.push(...range(i * numCols, i * numCols + numCols));
//             }
//             sortRows(wrapper.wrapper, '3', false);
//             verifyRows(wrapper.wrapper, expectedCells);

//             // Make sure filter works and there's no duplicated data
//             // Verifies https://github.com/microsoft/vscode-jupyter/issues/5200
//             await filterRows(wrapper.wrapper, '0', '92500');
//             // Should filter to row #18, containing 900-949 inclusive
//             verifyRows(wrapper.wrapper, [1850, ...range(92500, 92549)]);

//             // Make sure slicing + filter works
//             await applySliceAndVerifyReadonlyIndicator(wrapper, '[1850:1851, :5]');
//             verifyRows(wrapper.wrapper, [0, ...range(92500, 92505)]);
//         });
//     });

//     // https://github.com/microsoft/vscode-jupyter/issues/4706
//     // Disabled for now. Root cause is that pd.replace isn't recursive over objects in DataFrames,
//     // so our current inf/nan handling does not work for DataFrames whose cells are Series, ndarray, or list
//     // runMountedTest('Inf/NaN in DataFrame', async (wrapper) => {
//     //     await injectCode(
//     //         'import pandas as pd\r\nimport numpy as np\r\ndf = pd.DataFrame([], columns=["foo", "bar", "baz"])\r\ndf = df.append({"foo": [0, 1, np.inf], "bar": [-np.inf, 0, 1], "baz": [1, np.nan, 0]}, ignore_index=True)'
//     //     );
//     //     const gotAllRows = getCompletedPromise(wrapper);
//     //     const dv = await createJupyterVariableDataViewer('df', 'DataFrame');
//     //     assert.ok(dv, 'DataViewer not created');
//     //     await gotAllRows;

//     //     verifyRows(wrapper.wrapper, [0, '[0,1,inf]', '[-inf,0,1]', '[1,nan,0]']);
//     // });
// });
