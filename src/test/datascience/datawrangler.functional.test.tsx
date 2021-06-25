// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
/* eslint-disable , comma-dangle, @typescript-eslint/no-explicit-any, no-multi-str */
import '../../client/common/extensions';

import { nbformat } from '@jupyterlab/coreutils';
import * as path from 'path';
import * as assert from 'assert';
import { mount, ReactWrapper } from 'enzyme';
import * as sinon from 'sinon';
import { parse } from 'node-html-parser';
import * as React from 'react';
import * as uuid from 'uuid/v4';
import { Disposable } from 'vscode';
import { Identifiers } from '../../client/datascience/constants';
import { IDataWrangler, IDataWranglerFactory } from '../../client/datascience/data-viewing/data-wrangler/types';
import { getDefaultInteractiveIdentity } from '../../client/datascience/interactive-window/identity';
import {
    IJupyterVariable,
    IJupyterVariableDataProviderFactory,
    INotebook,
    INotebookProvider
} from '../../client/datascience/types';
import { MainPanel } from '../../datascience-ui/data-explorer/data-wrangler/mainPanel';
import { DataWranglerReactSlickGrid } from '../../datascience-ui/data-explorer/data-wrangler/dataWranglerReactSlickGrid';
import { noop, sleep } from '../core';
import { DataScienceIocContainer } from './dataScienceIocContainer';
import { takeSnapshot, writeDiffSnapshot } from './helpers';
import { IMountedWebView } from './mountedWebView';
import { DataViewerMessages, IDataViewerDataProvider } from '../../client/datascience/data-viewing/types';
import { escapePath, srcDirectory } from './testHelpers';

// import { asyncDump } from '../common/asyncDump';
suite('DataScience DataWrangler tests', () => {
    const disposables: Disposable[] = [];
    let dataWranglerFactory: IDataWranglerFactory;
    let jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory;
    let ioc: DataScienceIocContainer;
    let notebook: INotebook | undefined;
    const snapshot = takeSnapshot();
    let sandbox = sinon.createSandbox();

    suiteSetup(function () {
        // DataWrangler tests require jupyter to run. Othewrise can't
        // run any of our variable execution code
        const isRollingBuild = process.env ? process.env.VSC_FORCE_REAL_JUPYTER !== undefined : false;
        if (!isRollingBuild) {
            // eslint-disable-next-line no-console
            console.log('Skipping DataWrangler tests. Requires python environment');
            // eslint-disable-next-line no-invalid-this
            this.skip();
        }
    });

    suiteTeardown(() => {
        writeDiffSnapshot(snapshot, 'DataWrangler');
    });

    setup(async () => {
        ioc = new DataScienceIocContainer();
        ioc.registerDataScienceTypes();
        return ioc.activate();
    });

    function mountWebView() {
        // Setup our webview panel
        const mounted = ioc.createWebView(
            () => mount(<MainPanel skipDefault={true} baseTheme={'vscode-light'} testMode={true} />),
            'default'
        );

        // Make sure the data wrangler provider and execution factory in the container is created (the extension does this on startup in the extension)
        dataWranglerFactory = ioc.get<IDataWranglerFactory>(IDataWranglerFactory);
        jupyterVariableDataProviderFactory = ioc.get<IJupyterVariableDataProviderFactory>(
            IJupyterVariableDataProviderFactory
        );

        return mounted;
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
        await ioc.dispose();
        delete (global as any).ascquireVsCodeApi;
        sandbox.restore();
    });

    function createJupyterVariable(variable: string, type: string, shape: string): IJupyterVariable {
        return {
            name: variable,
            value: '',
            supportsDataExplorer: true,
            type,
            size: 0,
            truncated: true,
            shape,
            count: 0
        };
    }

    async function createJupyterVariableDataProvider(
        jupyterVariable: IJupyterVariable
    ): Promise<IDataViewerDataProvider> {
        return jupyterVariableDataProviderFactory.create(jupyterVariable, notebook!);
    }

    async function createDataWrangler(dataProvider: IDataViewerDataProvider, title: string): Promise<IDataWrangler> {
        return dataWranglerFactory.create(dataProvider, title);
    }

    async function createJupyterVariableDataWrangler(
        variable: string,
        type: string,
        shape: string = ''
    ): Promise<IDataWrangler> {
        const jupyterVariable: IJupyterVariable = createJupyterVariable(variable, type, shape);
        const jupyterVariableDataProvider: IDataViewerDataProvider = await createJupyterVariableDataProvider(
            jupyterVariable
        );
        return createDataWrangler(jupyterVariableDataProvider, jupyterVariable.name);
    }

    async function injectCode(code: string): Promise<INotebook | undefined> {
        const notebookProvider = ioc.get<INotebookProvider>(INotebookProvider);
        notebook = await notebookProvider.getOrCreateNotebook({
            identity: getDefaultInteractiveIdentity(),
            resource: undefined
        });
        if (notebook) {
            await executeCode(code, notebook);
            return notebook;
        }
    }

    async function executeCode(code: string, notebook: INotebook) {
        const cells = await notebook.execute(code, Identifiers.EmptyFileName, 0, uuid());
        assert.equal(cells.length, 1, `Wrong number of cells returned`);
        assert.equal(cells[0].data.cell_type, 'code', `Wrong type of cell returned`);
        const cell = cells[0].data as nbformat.ICodeCell;
        if (cell.outputs.length > 0) {
            const error = cell.outputs[0].evalue;
            if (error) {
                assert.fail(`Unexpected error: ${error}`);
            }
        }
    }

    function getCompletedPromise(mountedWebView: IMountedWebView): Promise<void> {
        return mountedWebView.waitForMessage(DataViewerMessages.CompletedData);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function runMountedTest(name: string, testFunc: (mount: IMountedWebView) => Promise<void>) {
        test(name, async () => {
            const wrapper = mountWebView();
            try {
                await testFunc(wrapper);
            } finally {
                // Make sure to unmount the wrapper or it will interfere with other tests
                wrapper.dispose();
            }
        });
    }

    function findGrid(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>) {
        const mainPanelWrapper = wrapper.find(MainPanel);
        assert.ok(mainPanelWrapper && mainPanelWrapper.length > 0, 'Grid not found to sort on');
        const mainPanel = mainPanelWrapper.instance() as MainPanel;
        assert.ok(mainPanel, 'Main panel instance not found');
        const reactGrid = (mainPanel as any).grid.current as DataWranglerReactSlickGrid;
        assert.ok(reactGrid, 'Grid control not found');
        return reactGrid;
    }

    function sortRows(
        wrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
        sortCol: string,
        sortAsc: boolean
    ): void {
        // Cause our sort
        const reactGrid = findGrid(wrapper);
        if (reactGrid.state.grid) {
            const cols = reactGrid.state.grid.getColumns();
            const col = cols.find((c) => c.field === sortCol);
            assert.ok(col, `${sortCol} is not a column of the grid`);
            reactGrid.sort(new Slick.EventData(), {
                sortCol: col,
                sortAsc,
                multiColumnSort: false,
                grid: reactGrid.state.grid
            });
        }
    }

    async function filterRows(
        wrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
        filterCol: string,
        filterText: string
    ): Promise<void> {
        // Cause our sort
        const reactGrid = findGrid(wrapper);
        if (reactGrid.state.grid) {
            const cols = reactGrid.state.grid.getColumns();
            const col = cols.find((c) => c.field === filterCol);
            assert.ok(col, `${filterCol} is not a column of the grid`);
            reactGrid.filterChanged(filterText, col!);
            await sleep(100);
            wrapper.update();
        }
    }

    function verifyRows(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>, rows: (string | number)[]) {
        const root = getRoot(wrapper);
        const cells = root.querySelectorAll('.react-grid-cell') as HTMLElement[];
        assert.ok(cells, 'No cells found');
        assert.ok(cells.length >= rows.length, 'Not enough cells found');
        // Cells should be an array that matches up to the values we expect.
        for (let i = 0; i < rows.length; i += 1) {
            // Span should have our value (based on the CellFormatter's output)
            const span = cells[i].querySelector('div.cell-formatter span') as HTMLSpanElement;
            assert.ok(span, `Span ${i} not found`);
            const val = rows[i].toString();
            assert.equal(span.innerHTML, val, `Row ${i} not matching. ${span.innerHTML} !== ${val}`);
        }
    }

    function verifyColumnHeaders(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>, columns: string[]) {
        const root = getRoot(wrapper);
        const cells = root.querySelectorAll('.react-grid-header-cell') as HTMLElement[];
        assert.ok(cells, 'No cells found');

        // SlickGrid has an index column with no name and data wrangler also created another index column called "index"
        assert.ok(columns.length === cells.length, 'Number of columns does not match');

        // Cells should be an array that matches up to the values we expect.
        for (let i = 0; i < columns.length; i++) {
            const span = cells[i].querySelector('.slick-column-name') as HTMLSpanElement;
            assert.ok(span, `Span ${i} not found`);
            const val = columns[i];
            assert.equal(span.innerHTML, val, `Column header ${i} not matching. ${span.innerHTML} !== ${val}`);
        }
    }

    function getRoot(wrapper: ReactWrapper<any, Readonly<{}>, React.Component>) {
        const mainPanel = wrapper.find('.main-panel');
        assert.ok(mainPanel.length >= 1, "Didn't find any cells being rendered");
        wrapper.update();

        // Force the main panel to actually render.
        const html = mainPanel.html();
        const root = parse(html) as any;
        return root;
    }

    runMountedTest('Data Frame', async (wrapper) => {
        await injectCode('import pandas as pd\r\ndf = pd.DataFrame([0, 1, 2, 3])');
        const gotAllRows = getCompletedPromise(wrapper);
        const dw = await createJupyterVariableDataWrangler('df', 'DataFrame');
        assert.ok(dw, 'DataWrangler not created');
        await gotAllRows;

        verifyRows(wrapper.wrapper, [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
    });

    runMountedTest('Transposed Data Frame', async (wrapper) => {
        await injectCode(
            'import pandas as pd\r\ndata = [["tom", 10], ["nick", 15], ["juli", 14]]\r\ndf = pd.DataFrame(data, columns=["Name", "Age"])\r\ndf = df.transpose()'
        );
        const gotAllRows = getCompletedPromise(wrapper);
        const dw = await createJupyterVariableDataWrangler('df', 'DataFrame');
        assert.ok(dw, 'DataWrangler not created');
        await gotAllRows;

        verifyRows(wrapper.wrapper, [0, 'Name', 'tom', 'nick', 'juli', 1, 'Age', '10', '15', '14']);
    });

    runMountedTest('Failure', async (_wrapper) => {
        await injectCode('import numpy as np\r\nx = np.array([0, 1, 2, 3])');
        try {
            await createJupyterVariableDataWrangler('unknown variable', 'ndarray');
            assert.fail('Exception should have been thrown');
        } catch {
            noop();
        }
    });

    runMountedTest('Sorting', async (wrapper) => {
        await injectCode('import numpy as np\r\nx = np.array([0, 1, 2, 3, np.inf, -np.inf, np.nan])');
        const gotAllRows = getCompletedPromise(wrapper);
        const dw = await createJupyterVariableDataWrangler('x', 'ndarray');
        assert.ok(dw, 'DataWrangler not created');
        await gotAllRows;

        verifyRows(wrapper.wrapper, [0, 0, 1, 1, 2, 2, 3, 3, 4, 'inf', 5, '-inf', 6, 'nan']);
        sortRows(wrapper.wrapper, '0', false);
        verifyRows(wrapper.wrapper, [6, 'nan', 4, 'inf', 3, 3, 2, 2, 1, 1, 0, 0, 5, '-inf']);
        sortRows(wrapper.wrapper, '0', true);
        verifyRows(wrapper.wrapper, [5, '-inf', 0, 0, 1, 1, 2, 2, 3, 3, 4, 'inf', 6, 'nan']);
    });

    runMountedTest('Filter strings with wildcards', async (wrapper) => {
        await injectCode(
            'import pandas as pd\r\ndata = ["stable", "unstable", "able", "barely stable", "st4ble"]\r\ndf = pd.DataFrame(data)'
        );
        const gotAllRows = getCompletedPromise(wrapper);
        const dw = await createJupyterVariableDataWrangler('df', 'DataFrame');
        assert.ok(dw, 'DataWrangler not created');
        await gotAllRows;
        verifyRows(wrapper.wrapper, [
            0,
            0,
            'stable',
            1,
            1,
            'unstable',
            2,
            2,
            'able',
            3,
            3,
            'barely stable',
            4,
            4,
            'st4ble'
        ]);

        const filtersAndExpectedResults = {
            stable: [0, 0, 'stable', 3, 3, 'barely stable'],
            unstable: [1, 1, 'unstable'],
            '*': [0, 0, 'stable', 1, 1, 'unstable', 2, 2, 'able', 3, 3, 'barely stable', 4, 4, 'st4ble'],
            '*stable': [0, 0, 'stable', 1, 1, 'unstable', 3, 3, 'barely stable'],
            '*tab*': [0, 0, 'stable', 1, 1, 'unstable', 3, 3, 'barely stable']
        };

        for (const [filter, expectedResult] of Object.entries(filtersAndExpectedResults)) {
            await filterRows(wrapper.wrapper, '0', filter);
            verifyRows(wrapper.wrapper, expectedResult);
        }
    });

    runMountedTest('Filter numerical', async (wrapper) => {
        await injectCode('import numpy as np\r\nx = np.array([0, 1, 2, 3, np.inf, -np.inf, np.nan])');
        const gotAllRows = getCompletedPromise(wrapper);
        const dw = await createJupyterVariableDataWrangler('x', 'ndarray');
        assert.ok(dw, 'DataWrangler not created');
        await gotAllRows;
        verifyRows(wrapper.wrapper, [0, 0, 1, 1, 2, 2, 3, 3, 4, 'inf', 5, '-inf', 6, 'nan']);

        const filtersAndExpectedResults = {
            '> 1': [2, 2, 3, 3, 4, 'inf'],
            '0': [0, 0],
            // Search for inf, -inf, nan
            inf: [4, 'inf'],
            Inf: [4, 'inf'],
            '-inf': [5, '-inf'],
            '-INF': [5, '-inf'],
            nan: [6, 'nan'],
            NaN: [6, 'nan'],
            // inf comparison
            '> inf': [],
            '>= inf': [4, 'inf'],
            '= inf': [4, 'inf'],
            '== inf': [4, 'inf'],
            '<= inf': [0, 0, 1, 1, 2, 2, 3, 3, 4, 'inf', 5, '-inf'],
            '< inf': [0, 0, 1, 1, 2, 2, 3, 3, 5, '-inf'],
            // -inf comparison
            '> -inf': [0, 0, 1, 1, 2, 2, 3, 3, 4, 'inf'],
            '>= -inf': [0, 0, 1, 1, 2, 2, 3, 3, 4, 'inf', 5, '-inf'],
            '= -inf': [5, '-inf'],
            '== -inf': [5, '-inf'],
            '<= -inf': [5, '-inf'],
            '< -inf': [],
            // nan comparison
            '= nan': [6, 'nan'],
            '== nan': [6, 'nan'],
            '>= nan': [6, 'nan'],
            '<= nan': [6, 'nan'],
            '> nan': [],
            '< nan': []
        };

        for (const [filter, expectedResult] of Object.entries(filtersAndExpectedResults)) {
            await filterRows(wrapper.wrapper, '0', filter);
            verifyRows(wrapper.wrapper, expectedResult);
        }
    });

    runMountedTest('Filter numerical - other column has strings', async (wrapper) => {
        await injectCode(
            'import numpy as np\r\nx = np.array([["Bob", 2], ["Alice", 4], ["Gina", -np.inf], ["John", np.inf], ["Trudy", np.nan]])'
        );
        const gotAllRows = getCompletedPromise(wrapper);
        const dw = await createJupyterVariableDataWrangler('x', 'ndarray');
        assert.ok(dw, 'DataWrangler not created');
        await gotAllRows;
        verifyRows(wrapper.wrapper, [
            0,
            'Bob',
            2,
            1,
            'Alice',
            4,
            2,
            'Gina',
            '-inf',
            3,
            'John',
            'inf',
            4,
            'Trudy',
            'nan'
        ]);

        const filtersAndExpectedResults = {
            '2': [0, 'Bob', 2],
            '4': [1, 'Alice', 4],
            '-inf': [2, 'Gina', '-inf'],
            inf: [3, 'John', 'inf'],
            nan: [4, 'Trudy'],
            '> 2': [1, 'Alice', 4, 3, 'John', 'inf'],
            '>= 2': [0, 'Bob', 2, 1, 'Alice', 4, 3, 'John', 'inf'],
            '< 4': [0, 'Bob', 2, 2, 'Gina', '-inf']
        };

        for (const [filter, expectedResult] of Object.entries(filtersAndExpectedResults)) {
            await filterRows(wrapper.wrapper, '1', filter);
            verifyRows(wrapper.wrapper, expectedResult);
        }
    });

    runMountedTest('Simple refresh', async (wrapper) => {
        // Run some code
        const notebook = await injectCode('import numpy as np\r\na = np.array([0, 1, 2, 3])');
        // Open the data wrangler
        const gotAllRows = getCompletedPromise(wrapper);
        const dw = await createJupyterVariableDataWrangler('a', 'ndarray');
        assert.ok(dw, 'DataWrangler not created');
        await gotAllRows;
        verifyRows(wrapper.wrapper, [0, 0, 1, 1, 2, 2, 3, 3]);

        // Run code that updates the previous variable
        const gotAllRows2 = getCompletedPromise(wrapper);
        await executeCode('a = np.array([[4, 5, 6]])', notebook!);
        // Ideally we'd execute the refresh command but this test doesn't run in vscode,
        // so this test doesn't verify that command execution results in the correct
        // data wrangler being refreshed
        await dw.refreshData();
        await gotAllRows2;
        // Verify that the data wrangler's contents have updated
        verifyRows(wrapper.wrapper, [0, 4, 5, 6]);
    });

    runMountedTest('Open csv in data wrangler', async (wrapper) => {
        // Run some code
        const importAndDfCode = `import pandas as pd
df = pd.read_csv("${escapePath(path.join(srcDirectory(), 'CustomerInfoReport.csv'))}")`;
        await injectCode(importAndDfCode);
        // Open the data wrangler
        const gotAllRows = getCompletedPromise(wrapper);
        const dw = await createJupyterVariableDataWrangler('df', 'DataFrame');
        assert.ok(dw, 'DataWrangler not created');
        await gotAllRows;
        verifyColumnHeaders(wrapper.wrapper, ['', 'index', 'Name', 'Customer Number', 'Age', 'Money', 'Occupation']);
        verifyRows(wrapper.wrapper, [
            0,
            '0',
            'Alice',
            '43',
            '23',
            '12345',
            'Teacher',
            1,
            '1',
            'Bob',
            '32',
            '43',
            '0',
            'Singer',
            2,
            '2',
            'John',
            '21',
            '5',
            '12',
            'Writer',
            3,
            '3',
            'James',
            '5',
            '67',
            '4',
            'Dancer',
            4,
            '4',
            'Jim',
            '3',
            'nan',
            'nan',
            'Engineer',
            5,
            '5',
            'Tom',
            '8',
            'nan',
            '4',
            'Engineer',
            6,
            '6',
            'Tim',
            '8',
            '54',
            'nan',
            'Teacher',
            7,
            '7',
            'Vince',
            '6',
            '65',
            '4321',
            'nan'
        ]);
    });
});
