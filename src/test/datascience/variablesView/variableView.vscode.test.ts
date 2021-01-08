// tslint:disable:no-console
// IANHU: remove no-console
import { assert, expect } from 'chai';
import * as sinon from 'sinon';
import { ICommandManager, IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import { Commands, VSCodeNotebookProvider } from '../../../client/datascience/constants';
import { IVariableViewProvider } from '../../../client/datascience/variablesView/types';
import { IExtensionTestApi } from '../../common';
import { sleep } from '../../core';
import { initialize } from '../../initialize';
import {
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    deleteAllCellsAndWait,
    executeCell,
    insertCodeCell,
    startJupyter,
    trustAllNotebooks,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected
} from '../notebook/helper';
import { INotebookEditorProvider } from '../../../client/datascience/types';

suite('DataScience - VariableView', () => {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let commandManager: ICommandManager;
    let variableViewProvider: IVariableViewProvider;
    let editorProvider: INotebookEditorProvider;
    let vscodeNotebook: IVSCodeNotebook;
    suiteSetup(async function () {
        this.timeout(120_000); // IANHU: From other tests? Reduce this?
        console.log('**** Start variableView suiteSetup ****');
        api = await initialize();

        // Don't run if we can't use the native notebook interface
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await trustAllNotebooks();
        await startJupyter(true);
        sinon.restore();
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        variableViewProvider = api.serviceContainer.get<IVariableViewProvider>(IVariableViewProvider);
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(VSCodeNotebookProvider);
    });
    setup(async function () {
        console.log('**** Start variableView setup ****');
        sinon.restore();

        // Create an editor to use for our tests
        await editorProvider.createNew();
        await waitForKernelToGetAutoSelected();
        await deleteAllCellsAndWait();
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
    });
    teardown(async function () {
        await closeNotebooks(disposables);
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    
    // Cleanup after suite is finished
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    // Test showing the variable view
    test('Can show variableView', async function () {
        this.timeout(120_000); // IANHU: Just for testing
        console.log('**** Start variableView test ****');
        // Add one simple cell and execute it
        await insertCodeCell('test = "MYTESTVALUE"', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await executeCell(cell);
        await waitForExecutionCompletedSuccessfully(cell);
        
        console.log('**** Cell execution done ****');
        // Send the command to open the view
        commandManager.executeCommand(Commands.OpenVariableView);

        // IANHU: Remove, just for testing
        await sleep(15_000);

        console.log('**** Sleep finished ****');

        // Now check to see if we can actually look at the variable view
        const variableView = variableViewProvider.variableView;
        
        if (variableView) {
            console.log('**** found variableView');
        }

        const htmlResult = await variableView?.getElementByIdAsync('variable-view-main-panel');
        const rootHtml = await variableView?.getElementByIdAsync('root');

        console.log(`**** rootHTML ${rootHtml}`);
        console.log(`**** htmlResult ${htmlResult} ****`);

        expect(htmlResult).to.contain('MYTESTVALUE');
    });
});
