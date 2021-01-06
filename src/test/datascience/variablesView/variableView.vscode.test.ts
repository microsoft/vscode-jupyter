import { assert, expect } from 'chai';
import { commands } from 'vscode';
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
        // Add one simple cell and execute it
        await insertCodeCell('test = "testing"', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await executeCell(cell);
        
        // Send the command to open the view
        commandManager.executeCommand(Commands.OpenVariableView);
        //commands.executeCommand("workbench.action.openView");

        // IANHU: Remove, just for testing
        await sleep(30_000);

        // Now check to see if we can actually look at the variable view
        const variableView = variableViewProvider.variableView;
        const htmlResult = await variableView?.getElementByIdAsync('variable-view-main-panel');

        expect(false).to.equal(true);
    });

    //test('Can run a widget notebook', async function () {
        //await openNotebook(api.serviceContainer, testWidgetNb.fsPath);
        //const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        //const contentProvider = api.serviceContainer.get<VSCNotebookContentProvider>(
            //INotebookContentProvider
        //) as NotebookContentProvider;

        //// Content provider should have a public member that maps webviews. Listen to messages on this webview
        //const webviews = contentProvider.webviews.get(cell.document.uri.toString());
        //assert.equal(webviews?.length, 1, 'No webviews found in content provider');
        //let loaded = false;
        //if (webviews) {
            //webviews[0].onDidReceiveMessage((e) => {
                //if (e.type === InteractiveWindowMessages.IPyWidgetLoadSuccess) {
                    //loaded = true;
                //}
            //});
        //}

        //// Execute cell. It should load and render the widget
        //await executeCell(cell);

        //// Wait till execution count changes and status is success.
        //await waitForExecutionCompletedSuccessfully(cell);

        //assert.ok(loaded, 'Widget did not load successfully during execution');
    //});
});
